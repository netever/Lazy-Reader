// Text around a point in a section document, and the way back from a text offset to the DOM.
// Used for the `quote` part of the locator.
import { findQuote, makeQuote, normalizeWithMap, type Quote } from "./locator";

const CONTEXT = 200;

function bodyRange(doc: Document): Range {
  const range = doc.createRange();
  range.selectNodeContents(doc.body ?? doc.documentElement);
  return range;
}

export function quoteAt(doc: Document, node: Node, offset: number): Quote | undefined {
  const all = bodyRange(doc);
  const before = doc.createRange();
  before.setStart(all.startContainer, all.startOffset);
  before.setEnd(node, offset);
  const after = doc.createRange();
  after.setStart(node, offset);
  after.setEnd(all.endContainer, all.endOffset);
  return makeQuote(before.toString().slice(-CONTEXT), after.toString().slice(0, CONTEXT));
}

/** Text from a point to the end of the section, for checking a restored position. */
export function textFrom(doc: Document, node: Node, offset: number): string {
  const all = bodyRange(doc);
  const after = doc.createRange();
  after.setStart(node, offset);
  after.setEnd(all.endContainer, all.endOffset);
  return after.toString().slice(0, CONTEXT);
}

/** Find a quote in the section and return a collapsed range at its start. */
export function rangeOfQuote(doc: Document, quote: Quote): Range | null {
  const raw = bodyRange(doc).toString();
  const { text, map } = normalizeWithMap(raw);
  const index = findQuote(text, quote);
  if (index < 0) return null;
  let rawOffset = map[index];
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = (node as Text).data.length;
    if (rawOffset <= length) {
      const range = doc.createRange();
      range.setStart(node, rawOffset);
      range.collapse(true);
      return range;
    }
    rawOffset -= length;
  }
  return null;
}
