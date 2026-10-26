// Locator: a reading position described in several ways at once (docs/SPEC.md, section 4).
// Pure functions only, so they run in unit tests without a browser.

export interface Quote {
  prefix: string;
  exact: string;
  suffix: string;
}

export interface Locator {
  format: string;
  /** Engine version for formats whose CFI depends on foliate-js (FB2, MOBI, CBZ). */
  engine?: string;
  cfi?: string;
  section?: number;
  progression?: number;
  /** Fraction of the whole book. Phase 0: approximate, see docs/adr/0004. */
  totalProgression?: number;
  quote?: Quote;
  pdf?: { page: number; x?: number; y?: number };
}

export interface Position {
  locator: Locator;
  updatedAt: number;
}

/** `state/<book-id>/<device-id>.json`. Unknown fields are kept by the Rust side on save. */
export interface StateFile {
  schema: number;
  deviceId: string;
  bookId: string;
  position: Position | null;
  annotations: unknown[];
  readingSessions: unknown[];
  [key: string]: unknown;
}

export const STATE_SCHEMA = 1;
export const QUOTE_LENGTH = 32;

/** `updatedAt` of one device must strictly grow even if the clock goes back. */
export function nextTimestamp(now: number, last: number | undefined): number {
  return last === undefined ? now : Math.max(now, last + 1);
}

export function emptyState(bookId: string, deviceId: string): StateFile {
  return { schema: STATE_SCHEMA, deviceId, bookId, position: null, annotations: [], readingSessions: [] };
}

export function withPosition(state: StateFile, locator: Locator, now: number): StateFile {
  return {
    ...state,
    position: { locator, updatedAt: nextTimestamp(now, state.position?.updatedAt) },
  };
}

/** Collapse runs of whitespace to one space and remember where each character came from. */
export function normalizeWithMap(raw: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let lastWasSpace = true; // drops leading whitespace
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        text += " ";
        map.push(i);
      }
      lastWasSpace = true;
    } else {
      text += ch;
      map.push(i);
      lastWasSpace = false;
    }
  }
  return { text, map };
}

export function normalizeText(raw: string): string {
  return normalizeWithMap(raw).text;
}

/** Quote around a point: `before` is the text up to the point, `after` the text from it. */
export function makeQuote(before: string, after: string, length = QUOTE_LENGTH): Quote | undefined {
  const b = normalizeText(before);
  const a = normalizeText(after);
  if (!a) return undefined;
  const exact = a.slice(0, length);
  return {
    prefix: b.slice(-length),
    exact,
    suffix: a.slice(exact.length, exact.length + length),
  };
}

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Find a quote in normalized text. Several matches of `exact` are ranked by how much
 * of `prefix` and `suffix` agrees. Returns the index of `exact` or -1.
 */
export function findQuote(text: string, quote: Quote): number {
  if (!quote.exact) return -1;
  let best = -1;
  let bestScore = -1;
  for (let i = text.indexOf(quote.exact); i !== -1; i = text.indexOf(quote.exact, i + 1)) {
    const score =
      commonSuffixLength(text.slice(0, i), quote.prefix) +
      commonPrefixLength(text.slice(i + quote.exact.length), quote.suffix);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

/** True if the text at the restored position starts with the saved quote. */
export function quoteMatches(textFromPoint: string, quote: Quote | undefined): boolean {
  if (!quote) return true;
  return normalizeText(textFromPoint).startsWith(quote.exact);
}

export function pdfLocator(page: number, pages: number): Locator {
  return {
    format: "pdf",
    pdf: { page },
    totalProgression: pages > 1 ? (page - 1) / (pages - 1) : 0,
  };
}
