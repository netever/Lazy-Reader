// Reading screen for formats rendered by foliate-js: EPUB, FB2, MOBI, AZW3, CBZ.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RelocateDetail, View } from "foliate-js/view.js";
import { perfMark, readBook, updateBookInfo, type BookMeta, type Settings } from "../api";
import { t } from "../i18n";
import { FOLIATE_ENGINE, loadFoliateBook, metaAuthors, metaText } from "./book-loader";
import { quoteAt, rangeOfQuote, textFrom } from "./dom-text";
import { measureFrames, type FrameStats } from "./frame-meter";
import { normalizeText, quoteMatches, type Locator } from "./locator";
import { PositionStore } from "./position-store";
import { ReaderChrome } from "./ReaderChrome";

interface Props {
  meta: BookMeta;
  settings: Settings;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onBack: () => void;
}

// Light page until themes arrive in phase 1; otherwise a dark system theme gives black on dark.
function bookCss(fontSize: number): string {
  return `
    html { font-size: ${fontSize}px; color-scheme: light; background: #fbfaf7; color: #1f1d1a; }
    p, li, blockquote, dd { line-height: 1.5; hyphens: auto; }
  `;
}

function applyLayout(view: View, settings: Settings) {
  const r = view.renderer;
  r.setAttribute("flow", "paginated");
  r.setAttribute("gap", "6%");
  r.setAttribute("max-inline-size", "720px");
  r.setAttribute("max-column-count", "2");
  if (settings.animated !== false) r.setAttribute("animated", "");
  else r.removeAttribute("animated");
  r.setStyles?.(bookCss(settings.fontSize ?? 18));
}

function locatorFrom(meta: BookMeta, d: RelocateDetail): Locator {
  const start = d.range;
  return {
    format: meta.format,
    engine: FOLIATE_ENGINE,
    cfi: d.cfi,
    section: d.section?.current,
    totalProgression: d.fraction,
    quote: start ? quoteAt(start.startContainer.ownerDocument!, start.startContainer, start.startOffset) : undefined,
  };
}

/**
 * Check that the restored CFI shows the saved text. If not (the book or the engine changed),
 * search the quote in the saved section, then fall back to the fraction of the book.
 */
async function repairPosition(view: View, saved: Locator, d: RelocateDetail): Promise<void> {
  const r = d.range;
  if (r && quoteMatches(textFrom(r.startContainer.ownerDocument!, r.startContainer, r.startOffset), saved.quote)) return;
  if (saved.quote && saved.section !== undefined) {
    if (d.section?.current !== saved.section) await view.goTo(saved.section);
    const content = view.renderer.getContents().find((c) => c.index === saved.section);
    const range = content && rangeOfQuote(content.doc, saved.quote);
    if (range) {
      await view.goTo(view.getCFI(saved.section, range));
      return;
    }
  }
  if (saved.totalProgression !== undefined) await view.goToFraction(saved.totalProgression);
}

export function FoliateReader({ meta, settings, onSettingsChange, onBack }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<{ fraction: number; label?: string }>({ fraction: 0 });
  const [turnStats, setTurnStats] = useState<FrameStats | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [title, setTitle] = useState(meta.title ?? meta.fileName);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const turn = useCallback(async (dir: 1 | -1) => {
    const view = viewRef.current;
    if (!view) return;
    const animated = settingsRef.current.animated !== false;
    const stats = animated ? measureFrames(450) : null;
    await (dir > 0 ? view.next() : view.prev());
    if (stats) {
      const s = await stats;
      setTurnStats(s);
      perfMark("page_turn", `engine=foliate fps=${s.fps} worst_frame_ms=${s.worstFrameMs}`);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let store: PositionStore | null = null;
    let view: View | null = null;
    let lastWheel = 0;

    const onKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "PageDown", " "].includes(e.key)) void turn(1);
      else if (["ArrowLeft", "PageUp"].includes(e.key)) void turn(-1);
      else return;
      e.preventDefault();
    };
    const onWheel = (e: WheelEvent) => {
      const now = Date.now();
      if (now - lastWheel < 350 || Math.abs(e.deltaY) < 4) return;
      lastWheel = now;
      void turn(e.deltaY > 0 ? 1 : -1);
    };

    (async () => {
      await import("foliate-js/view.js"); // registers <foliate-view>
      store = await PositionStore.open(meta.bookId, (e) => setSaveError(String(e)));
      const book = await loadFoliateBook(meta, await readBook(meta.bookId));
      if (cancelled) return;

      view = document.createElement("foliate-view") as View;
      view.className = "foliate-view";
      hostRef.current!.append(view);
      viewRef.current = view;
      await view.open(book);
      if (cancelled) return;
      applyLayout(view, settingsRef.current);

      const bookTitle = metaText(book.metadata?.title);
      if (bookTitle) setTitle(bookTitle);
      void updateBookInfo(
        meta.bookId,
        bookTitle,
        metaAuthors(book.metadata?.author),
        metaText(book.metadata?.language),
      ).catch(() => undefined);

      const saved = store.locator;
      let first = true;
      view.addEventListener("load", (e) => {
        const doc = (e as CustomEvent<{ doc: Document }>).detail.doc;
        // Development builds expose section documents for checks over DevTools (docs/CHECKS.md).
        if (import.meta.env.DEV) ((window as unknown as { __readerDocs: Document[] }).__readerDocs ??= []).push(doc);
        doc.addEventListener("keydown", onKey);
        doc.addEventListener("wheel", onWheel, { passive: true });
      });
      view.addEventListener("relocate", (e) => {
        const d = (e as CustomEvent<RelocateDetail>).detail;
        setProgress({ fraction: d.fraction, label: d.tocItem?.label });
        if (first) {
          first = false;
          setLoading(false);
          perfMark("first_page", `format=${meta.format}`);
          if (saved?.cfi) void repairPosition(view!, saved, d);
        }
        // Keep the exact reading point while it is still on screen. Otherwise every reflow
        // (restart, font size, window size) would move it back to the start of a new page.
        const current = store!.locator;
        if (current?.quote && current.section === d.section?.current && d.range &&
            normalizeText(d.range.toString()).includes(current.quote.exact)) return;
        store!.update(locatorFrom(meta, d));
      });

      await view.init({ lastLocation: saved?.cfi ?? null, showTextStart: false });
      if (!saved?.cfi && saved?.totalProgression) await view.goToFraction(saved.totalProgression);
    })().catch((e) => {
      if (!cancelled) {
        setError(t("reader.openFailed", { error: String(e) }));
        setLoading(false);
      }
    });

    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      void store?.dispose();
      // Normally the layout effect below has closed the view already and cleared the ref.
      if (view && viewRef.current === view) {
        view.close();
        view.remove();
        viewRef.current = null;
      }
    };
  }, [meta, turn]);

  // Close the book while its DOM is still attached. useEffect cleanups run after React has
  // removed the DOM, and then foliate-js cannot unobserve the section's <body> (its iframe has
  // no document any more): the stale ResizeObserver errors every frame in Android WebView.
  useLayoutEffect(
    () => () => {
      viewRef.current?.close();
      viewRef.current?.remove();
      viewRef.current = null;
    },
    [meta],
  );

  useEffect(() => {
    if (viewRef.current?.renderer) applyLayout(viewRef.current, settings);
  }, [settings]);

  return (
    <ReaderChrome
      title={title}
      status={[progress.label, t("reader.progress", { percent: Math.round(progress.fraction * 100) })]
        .filter(Boolean)
        .join(" · ")}
      loading={loading}
      error={error ?? (saveError && t("reader.saveFailed", { error: saveError }))}
      turnStats={turnStats}
      settings={settings}
      onSettingsChange={onSettingsChange}
      onBack={onBack}
      onTurn={turn}
    >
      <div ref={hostRef} className="reader-host" />
    </ReaderChrome>
  );
}
