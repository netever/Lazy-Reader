// Reading screen for PDF, on PDF.js. One page at a time, fitted to the screen.
// PDF.js asks for byte ranges, so a file of hundreds of megabytes is not read whole.
import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { perfMark, readBookRange, updateBookInfo, type BookMeta, type Settings } from "../api";
import { t } from "../i18n";
import { measureFrames, type FrameStats } from "./frame-meter";
import { pdfLocator } from "./locator";
import { PositionStore } from "./position-store";
import { ReaderChrome } from "./ReaderChrome";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const TURN_MS = 280;

class TauriRangeTransport extends pdfjs.PDFDataRangeTransport {
  private bookId: string;
  constructor(bookId: string, length: number) {
    super(length, null);
    this.bookId = bookId;
  }
  requestDataRange(begin: number, end: number): void {
    readBookRange(this.bookId, begin, end - begin).then(
      (buffer) => this.onDataRange(begin, new Uint8Array(buffer)),
      (e) => console.error("range read failed", e),
    );
  }
}

interface Props {
  meta: BookMeta;
  settings: Settings;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onBack: () => void;
}

export function PdfReader({ meta, settings, onSettingsChange, onBack }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const storeRef = useRef<PositionStore | null>(null);
  const pageRef = useRef(1);
  const busyRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [turnStats, setTurnStats] = useState<FrameStats | null>(null);

  const renderPage = useCallback(async (n: number): Promise<HTMLCanvasElement> => {
    const pdfPage = await docRef.current!.getPage(n);
    const stage = stageRef.current!;
    const base = pdfPage.getViewport({ scale: 1 });
    const fit = Math.min(stage.clientWidth / base.width, stage.clientHeight / base.height);
    const dpr = window.devicePixelRatio || 1;
    const viewport = pdfPage.getViewport({ scale: fit * dpr });
    const canvas = document.createElement("canvas");
    canvas.className = "pdf-page";
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
    canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
    await pdfPage.render({ canvas, viewport }).promise;
    pdfPage.cleanup();
    return canvas;
  }, []);

  /** Show page `n`. `dir` is the direction of the slide animation, 0 for none. */
  const show = useCallback(
    async (n: number, dir: 1 | -1 | 0) => {
      const stage = stageRef.current;
      if (!stage || !docRef.current) return;
      const canvas = await renderPage(n);
      const old = stage.querySelector<HTMLCanvasElement>(".pdf-page");
      stage.append(canvas);
      if (old && dir !== 0 && settingsRef.current.animated !== false) {
        const w = stage.clientWidth;
        const options = { duration: TURN_MS, easing: "ease-out" };
        const stats = measureFrames(TURN_MS + 40);
        const a = old.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-dir * w}px)` }], options);
        const b = canvas.animate([{ transform: `translateX(${dir * w}px)` }, { transform: "translateX(0)" }], options);
        await Promise.all([a.finished, b.finished]);
        const s = await stats;
        setTurnStats(s);
        perfMark("page_turn", `engine=pdfjs fps=${s.fps} worst_frame_ms=${s.worstFrameMs}`);
      }
      old?.remove();
      pageRef.current = n;
      setPage(n);
      storeRef.current?.update(pdfLocator(n, docRef.current.numPages));
    },
    [renderPage],
  );

  const turn = useCallback(
    async (dir: 1 | -1) => {
      const doc = docRef.current;
      const target = pageRef.current + dir;
      if (!doc || busyRef.current || target < 1 || target > doc.numPages) return;
      busyRef.current = true;
      try {
        await show(target, dir);
      } finally {
        busyRef.current = false;
      }
    },
    [show],
  );

  useEffect(() => {
    let cancelled = false;
    let loadingTask: pdfjs.PDFDocumentLoadingTask | null = null;
    const started = performance.now();

    (async () => {
      const store = await PositionStore.open(meta.bookId, (e) => setError(t("reader.saveFailed", { error: String(e) })));
      storeRef.current = store;
      loadingTask = pdfjs.getDocument({
        range: new TauriRangeTransport(meta.bookId, meta.size),
        rangeChunkSize: 256 * 1024,
        disableAutoFetch: true,
        disableStream: true,
      });
      const doc = await loadingTask.promise;
      if (cancelled) return;
      docRef.current = doc;
      setPages(doc.numPages);
      perfMark("pdf_open", `pages=${doc.numPages} size=${meta.size} ms=${Math.round(performance.now() - started)}`);

      const savedPage = store.locator?.pdf?.page ?? 1;
      await show(Math.min(Math.max(1, savedPage), doc.numPages), 0);
      if (cancelled) return;
      setLoading(false);
      perfMark("first_page", `format=pdf ms_since_open=${Math.round(performance.now() - started)}`);

      const info = (await doc.getMetadata().catch(() => null))?.info as { Title?: string; Author?: string } | undefined;
      void updateBookInfo(meta.bookId, info?.Title?.trim() || null, info?.Author ? [info.Author] : [], null).catch(
        () => undefined,
      );
    })().catch((e) => {
      if (!cancelled) {
        setError(t("reader.openFailed", { error: String(e) }));
        setLoading(false);
      }
    });

    const onKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "PageDown", " "].includes(e.key)) void turn(1);
      else if (["ArrowLeft", "PageUp"].includes(e.key)) void turn(-1);
    };
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => void show(pageRef.current, 0), 200);
    };
    let lastWheel = 0;
    const onWheel = (e: WheelEvent) => {
      const now = Date.now();
      if (now - lastWheel < 350 || Math.abs(e.deltaY) < 4) return;
      lastWheel = now;
      void turn(e.deltaY > 0 ? 1 : -1);
    };
    const stage = stageRef.current;
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    stage?.addEventListener("wheel", onWheel, { passive: true });

    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      stage?.removeEventListener("wheel", onWheel);
      clearTimeout(resizeTimer);
      void storeRef.current?.dispose();
      storeRef.current = null;
      void loadingTask?.destroy();
      docRef.current = null;
    };
  }, [meta, show, turn]);

  return (
    <ReaderChrome
      title={meta.title ?? meta.fileName}
      status={pages ? t("reader.page", { current: page, total: pages }) : ""}
      loading={loading}
      error={error}
      turnStats={turnStats}
      settings={settings}
      showFontSize={false}
      onSettingsChange={onSettingsChange}
      onBack={onBack}
      onTurn={turn}
    >
      <div ref={stageRef} className="pdf-stage" />
    </ReaderChrome>
  );
}
