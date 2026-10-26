import { describe, expect, it } from "vitest";
import { summarize } from "../src/reader/frame-meter";
import { metaAuthors, metaText } from "../src/reader/book-loader";
import { toBase64 } from "../src/bytes";

describe("base64 for Android import", () => {
  it("round-trips, including chunks over 32 KB", () => {
    const bytes = new Uint8Array(100_003).map((_, i) => (i * 31) % 256);
    const back = Uint8Array.from(atob(toBase64(bytes)), (c) => c.charCodeAt(0));
    expect(back).toEqual(bytes);
    expect(toBase64(new Uint8Array([0, 255, 128]))).toBe("AP+A");
    expect(toBase64(new Uint8Array())).toBe("");
  });
});

describe("frame meter", () => {
  it("computes fps and the worst frame", () => {
    const times = [0, 16, 33, 50, 120, 136]; // one 70 ms jerk
    expect(summarize(times)).toEqual({ fps: 37, worstFrameMs: 70, frames: 6 });
  });

  it("handles too few frames", () => {
    expect(summarize([5])).toEqual({ fps: 0, worstFrameMs: 0, frames: 1 });
  });
});

describe("foliate-js metadata", () => {
  it("reads strings, language maps and contributors", () => {
    expect(metaText("  Война и мир ")).toBe("Война и мир");
    expect(metaText({ ru: "Название", en: "Title" })).toBe("Название");
    expect(metaText({ name: "Тест Тестов", sortAs: "Тестов, Тест" })).toBe("Тест Тестов");
    expect(metaText(["ru", "en"])).toBe("ru");
    expect(metaText("")).toBeNull();
    expect(metaText(undefined)).toBeNull();
  });

  it("collects authors in any shape", () => {
    expect(metaAuthors([{ name: "А" }, "Б", { name: { ru: "В" } }])).toEqual(["А", "Б", "В"]);
    expect(metaAuthors("Один")).toEqual(["Один"]);
    expect(metaAuthors(undefined)).toEqual([]);
  });
});
