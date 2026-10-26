// Root of the interface. On start it opens the last book right away (fast start rule 1,
// docs/SPEC.md section 8); the library is shown only when there is no last book.
import { useCallback, useEffect, useState } from "react";
import { getBook, loadSettings, perfMark, saveSettings, type BookMeta, type Settings } from "./api";
import { LibraryView } from "./library/LibraryView";
import { FoliateReader } from "./reader/FoliateReader";
import { PdfReader } from "./reader/PdfReader";

const DEFAULT_SETTINGS: Settings = { schema: 1, fontSize: 18, animated: true, lastBookId: null };

type Screen = { kind: "starting" } | { kind: "library" } | { kind: "reader"; book: BookMeta };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "starting" });
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    (async () => {
      const saved = { ...DEFAULT_SETTINGS, ...((await loadSettings().catch(() => null)) ?? {}) };
      setSettings(saved);
      const book = saved.lastBookId ? await getBook(saved.lastBookId).catch(() => null) : null;
      setScreen(book ? { kind: "reader", book } : { kind: "library" });
      perfMark("app_ready", book ? "opening_last_book" : "library");
    })();
  }, []);

  const changeSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      void saveSettings(next).catch(() => undefined);
      return next;
    });
  }, []);

  const open = useCallback((book: BookMeta) => {
    changeSettings({ lastBookId: book.bookId });
    setScreen({ kind: "reader", book });
  }, [changeSettings]);

  const back = useCallback(() => {
    changeSettings({ lastBookId: null });
    setScreen({ kind: "library" });
  }, [changeSettings]);

  if (screen.kind === "starting") return null;
  if (screen.kind === "library") return <LibraryView onOpen={open} />;
  const Reader = screen.book.format === "pdf" ? PdfReader : FoliateReader;
  return (
    <Reader
      key={screen.book.bookId}
      meta={screen.book}
      settings={settings}
      onSettingsChange={changeSettings}
      onBack={back}
    />
  );
}
