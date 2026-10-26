// Minimal types for the parts of foliate-js this app uses. The library itself is plain JS.

declare module "foliate-js/view.js" {
  export interface FoliateTocItem {
    label: string;
    href: string;
    subitems?: FoliateTocItem[];
  }

  export interface FoliateSection {
    id: string | number;
    size: number;
    linear?: string;
    cfi?: string;
    createDocument?: () => Promise<Document>;
  }

  export interface FoliateBook {
    metadata?: {
      title?: string | Record<string, string>;
      author?: unknown;
      language?: string | string[];
    };
    sections: FoliateSection[];
    toc?: FoliateTocItem[];
    rendition?: { layout?: string };
    getCover?: () => Promise<Blob | null>;
    destroy?: () => void;
  }

  export interface RelocateDetail {
    fraction: number;
    section: { current: number; total: number };
    location: { current: number; next: number; total: number };
    tocItem?: { label: string; href: string };
    cfi: string;
    range?: Range;
  }

  export interface FoliateRenderer extends HTMLElement {
    setStyles?(css: string | [string, string]): void;
    next(): Promise<void>;
    prev(): Promise<void>;
    getContents(): { index: number; doc: Document }[];
  }

  export class View extends HTMLElement {
    book: FoliateBook;
    renderer: FoliateRenderer;
    lastLocation: RelocateDetail | null;
    open(book: FoliateBook | File | Blob): Promise<void>;
    close(): void;
    init(options: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>;
    goTo(target: string | number): Promise<unknown>;
    goToFraction(fraction: number): Promise<void>;
    getCFI(index: number, range?: Range): string;
    next(distance?: number): Promise<void>;
    prev(distance?: number): Promise<void>;
  }
}

declare module "foliate-js/epub.js" {
  import type { FoliateBook } from "foliate-js/view.js";
  export interface ZipLoader {
    entries?: { filename: string }[];
    loadText(name: string): Promise<string | null> | null;
    loadBlob(name: string, type?: string): Promise<Blob | null> | null;
    getSize(name: string): number;
  }
  export class EPUB {
    constructor(loader: ZipLoader);
    init(): Promise<FoliateBook>;
  }
}

declare module "foliate-js/fb2.js" {
  import type { FoliateBook } from "foliate-js/view.js";
  export function makeFB2(blob: Blob): Promise<FoliateBook>;
}

declare module "foliate-js/comic-book.js" {
  import type { FoliateBook } from "foliate-js/view.js";
  import type { ZipLoader } from "foliate-js/epub.js";
  export function makeComicBook(loader: ZipLoader & { entries: { filename: string }[] }, file: { name: string }): FoliateBook;
}

declare module "foliate-js/mobi.js" {
  import type { FoliateBook } from "foliate-js/view.js";
  export class MOBI {
    constructor(options: { unzlib: (data: Uint8Array) => Uint8Array });
    open(file: Blob): Promise<FoliateBook>;
  }
}

declare module "foliate-js/vendor/zip.js" {
  export function configure(options: { useWebWorkers: boolean }): void;
  export class BlobReader {
    constructor(blob: Blob);
  }
  export class TextWriter {}
  export class BlobWriter {
    constructor(type?: string);
  }
  export interface Entry {
    filename: string;
    uncompressedSize: number;
    directory: boolean;
    getData<T>(writer: unknown): Promise<T>;
  }
  export class ZipReader {
    constructor(reader: BlobReader);
    getEntries(): Promise<Entry[]>;
  }
}

declare module "foliate-js/vendor/fflate.js" {
  export function unzlibSync(data: Uint8Array): Uint8Array;
}
