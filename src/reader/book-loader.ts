// Turns the bytes of a book into a foliate-js book object.
//
// We do not use `makeBook` from foliate-js/view.js: it recognizes FB2, .fb2.zip and CBZ only by
// a lower-case file name, finds CBZ images only by lower-case extensions, and pulls its own copy
// of PDF.js. The format is already known from import (src-tauri/src/library.rs), PDF goes to
// PdfReader. See docs/adr/0002-foliate-js.md.
import type { FoliateBook } from "foliate-js/view.js";
import type { ZipLoader } from "foliate-js/epub.js";
import type { BookMeta } from "../api";

/** foliate-js commit pinned in vendor/foliate-js; stored in locators (docs/SPEC.md, section 4). */
export const FOLIATE_ENGINE = "foliate-js@78914aef";

type ZipLoaderWithEntries = ZipLoader & { entries: { filename: string }[] };

/**
 * Zip loader. With `lowerCaseNames`, entry names are exposed in lower case and mapped back,
 * so CBZ archives with "PAGE01.JPG" work.
 */
async function makeZipLoader(blob: Blob, lowerCaseNames = false): Promise<ZipLoaderWithEntries> {
  const { configure, ZipReader, BlobReader, TextWriter, BlobWriter } = await import("foliate-js/vendor/zip.js");
  configure({ useWebWorkers: false });
  const all = await new ZipReader(new BlobReader(blob)).getEntries();
  const files = all.filter((e) => !e.directory);
  const key = (name: string) => (lowerCaseNames ? name.toLowerCase() : name);
  const map = new Map(files.map((e) => [key(e.filename), e]));
  return {
    entries: files.map((e) => ({ filename: key(e.filename) })),
    loadText: (name) => map.get(name)?.getData<string>(new TextWriter()) ?? null,
    loadBlob: (name, type) => map.get(name)?.getData<Blob>(new BlobWriter(type)) ?? null,
    getSize: (name) => map.get(name)?.uncompressedSize ?? 0,
  };
}

export async function loadFoliateBook(meta: BookMeta, bytes: ArrayBuffer): Promise<FoliateBook> {
  const blob = new Blob([bytes]);
  switch (meta.format) {
    case "epub": {
      const { EPUB } = await import("foliate-js/epub.js");
      return new EPUB(await makeZipLoader(blob)).init();
    }
    case "fb2": {
      const { makeFB2 } = await import("foliate-js/fb2.js");
      return makeFB2(blob);
    }
    case "fbz": {
      const { makeFB2 } = await import("foliate-js/fb2.js");
      const loader = await makeZipLoader(blob, true);
      const entry = loader.entries.find((e) => e.filename.endsWith(".fb2")) ?? loader.entries[0];
      const inner = entry ? await loader.loadBlob(entry.filename) : null;
      if (!inner) throw new Error("no .fb2 file inside the archive");
      return makeFB2(inner);
    }
    case "cbz": {
      const { makeComicBook } = await import("foliate-js/comic-book.js");
      return makeComicBook(await makeZipLoader(blob, true), { name: meta.fileName });
    }
    case "mobi":
    case "azw3": {
      const { MOBI } = await import("foliate-js/mobi.js");
      const { unzlibSync } = await import("foliate-js/vendor/fflate.js");
      return new MOBI({ unzlib: unzlibSync }).open(blob);
    }
    default:
      throw new Error(`format ${meta.format} is not handled by foliate-js`);
  }
}

/** foliate-js metadata values may be strings, language maps or contributor objects. */
export function metaText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return metaText(value[0]);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("name" in obj) return metaText(obj.name);
    const first = Object.values(obj)[0];
    return metaText(first);
  }
  return null;
}

export function metaAuthors(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  return list.map(metaText).filter((x): x is string => !!x);
}
