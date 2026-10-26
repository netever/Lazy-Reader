import { describe, expect, it } from "vitest";
import {
  emptyState,
  findQuote,
  makeQuote,
  nextTimestamp,
  normalizeWithMap,
  pdfLocator,
  quoteMatches,
  withPosition,
} from "../src/reader/locator";

describe("timestamps", () => {
  it("grow strictly even if the clock goes back", () => {
    expect(nextTimestamp(1000, undefined)).toBe(1000);
    expect(nextTimestamp(1000, 2000)).toBe(2001);
    expect(nextTimestamp(3000, 2000)).toBe(3000);
  });

  it("withPosition keeps other fields and grows updatedAt", () => {
    const s0 = { ...emptyState("b", "d"), futureField: 1 };
    const s1 = withPosition(s0, { format: "epub", cfi: "epubcfi(/6/2!/4)" }, 500);
    const s2 = withPosition(s1, { format: "epub", cfi: "epubcfi(/6/4!/4)" }, 400);
    expect(s2.futureField).toBe(1);
    expect(s2.position?.updatedAt).toBe(501);
  });
});

describe("text normalization", () => {
  it("collapses whitespace and maps back to raw offsets", () => {
    const raw = "  Глава\n\n  первая.\tТекст";
    const { text, map } = normalizeWithMap(raw);
    expect(text).toBe("Глава первая. Текст");
    expect(raw[map[text.indexOf("первая")]]).toBe("п");
  });
});

describe("quotes", () => {
  it("are built from the text around a point", () => {
    const q = makeQuote("…начало абзаца ", "Здесь читатель остановился,   и дальше текст", 10);
    expect(q).toEqual({ prefix: "ло абзаца ", exact: "Здесь чита", suffix: "тель остан" });
  });

  it("are found in text, prefix and suffix pick the right repeat", () => {
    const text = "Раз. Он сказал: да. Два. Он сказал: да. Три.";
    const second = text.lastIndexOf("Он сказал");
    const q = { prefix: "Два. ", exact: "Он сказал", suffix: ": да. Три" };
    expect(findQuote(text, q)).toBe(second);
    expect(findQuote(text, { prefix: "", exact: "нет такого", suffix: "" })).toBe(-1);
  });

  it("match the restored position", () => {
    const q = { prefix: "", exact: "Здесь читатель", suffix: "" };
    expect(quoteMatches("Здесь  читатель остановился", q)).toBe(true);
    expect(quoteMatches("Другая страница", q)).toBe(false);
    expect(quoteMatches("что угодно", undefined)).toBe(true);
  });
});

describe("pdf locator", () => {
  it("stores the page and a fraction of the book", () => {
    expect(pdfLocator(1, 11).totalProgression).toBe(0);
    expect(pdfLocator(11, 11).totalProgression).toBe(1);
    expect(pdfLocator(6, 11)).toMatchObject({ format: "pdf", pdf: { page: 6 }, totalProgression: 0.5 });
  });
});
