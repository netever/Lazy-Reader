// Library screen: the list of imported books and the "add book" button.
import { useEffect, useRef, useState } from "react";
import { importBook, listBooks, type BookMeta } from "../api";
import { t } from "../i18n";

const ACCEPT = ".epub,.fb2,.fbz,.zip,.cbz,.pdf,.mobi,.azw3";

interface Props {
  onOpen: (book: BookMeta) => void;
}

export function LibraryView({ onOpen }: Props) {
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [importing, setImporting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listBooks().then(setBooks, (e) => setError(String(e)));
  }, []);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    let last: BookMeta | null = null;
    try {
      for (const file of Array.from(files)) {
        setImporting(0);
        last = await importBook(file, setImporting);
      }
      setBooks(await listBooks());
    } catch (e) {
      setError(t("library.importFailed", { error: String(e) }));
    } finally {
      setImporting(null);
      if (inputRef.current) inputRef.current.value = "";
    }
    if (last && files.length === 1) onOpen(last);
  }

  return (
    <div className="library">
      <header className="library-bar">
        <h1>{t("library.title")}</h1>
        <button onClick={() => inputRef.current?.click()} disabled={importing !== null}>
          {importing === null ? t("library.import") : t("library.importing", { percent: Math.round(importing * 100) })}
        </button>
        <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => onFiles(e.target.files)} />
      </header>
      {error && <p className="library-error">{error}</p>}
      {books.length === 0 && !error && <p className="library-empty">{t("library.empty")}</p>}
      <ul className="library-list">
        {books.map((b) => (
          <li key={b.bookId}>
            <button onClick={() => onOpen(b)}>
              <span className="book-format">{b.format.toUpperCase()}</span>
              <span className="book-title">{b.title ?? b.fileName}</span>
              <span className="book-author">{b.authors.join(", ") || t("library.noAuthor")}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
