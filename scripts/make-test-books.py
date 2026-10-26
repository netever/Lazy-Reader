#!/usr/bin/env python3
"""Generate small test books for the reader. All content is synthetic and free (CC0).

Usage (from the repository root):
    python3 scripts/make-test-books.py            # small books into test-books/
    python3 scripts/make-test-books.py --large    # also test-books/large/big.pdf (~300 MB, not in git)

Books:
    sample.epub              EPUB 3, 3 chapters, cover
    sample-cp1251.fb2        FB2 in windows-1251, 3 sections, cover
    sample.fb2.zip           the same FB2 inside a zip
    SAMPLE-UPPER.CBZ         comic, page images named PAGE01.PNG… (upper case on purpose)
    sample.pdf               20 pages of text
    large/big.pdf            600 pages with uncompressed images, for the large PDF check
"""

import argparse
import base64
import random
import struct
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "test-books"

WORDS = (
    "дом лес река дорога утро вечер город окно письмо книга свет тень ветер поле сад мост "
    "старый новый тихий быстрый далёкий светлый тёплый холодный зелёный долгий "
    "шёл смотрел думал читал писал ждал слушал вспоминал говорил видел"
).split()


def paragraph(rng: random.Random, number: int) -> str:
    words = [rng.choice(WORDS) for _ in range(rng.randint(40, 90))]
    words[0] = words[0].capitalize()
    text = " ".join(words)
    return f"§{number}. {text}."


def chapters(count=3, paragraphs=40, seed=1):
    rng = random.Random(seed)
    n = 0
    result = []
    for c in range(1, count + 1):
        paras = []
        for _ in range(paragraphs):
            n += 1
            paras.append(paragraph(rng, n))
        result.append((f"Глава {c}", paras))
    return result


# --- PNG with large block digits -------------------------------------------------------------

DIGITS = {
    "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "001", "001", "001"],
    "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"],
}


def gray_image(width: int, height: int, label: str, background=230):
    """Rows of 8-bit gray pixels with `label` (digits) drawn in the middle."""
    scale = max(4, min(width // (len(label) * 4 + 1), height // 7))
    text_w, text_h = (len(label) * 4 - 1) * scale, 5 * scale
    x0, y0 = (width - text_w) // 2, (height - text_h) // 2
    rows = []
    for y in range(height):
        row = bytearray([background]) * width
        ty = (y - y0) // scale
        if 0 <= y - y0 < text_h:
            for i, ch in enumerate(label):
                pattern = DIGITS[ch][ty]
                for px, bit in enumerate(pattern):
                    if bit == "1":
                        start = x0 + (i * 4 + px) * scale
                        row[start:start + scale] = bytes([40]) * scale
        rows.append(bytes(row))
    return rows


def png(width: int, height: int, label: str) -> bytes:
    raw = b"".join(b"\x00" + row for row in gray_image(width, height, label))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


# --- EPUB --------------------------------------------------------------------------------------

def make_epub(path: Path):
    chs = chapters(seed=1)
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>""", compress_type=zipfile.ZIP_DEFLATED)
        items, spine, nav = [], [], []
        for i, (title, paras) in enumerate(chs, 1):
            body = "\n".join(f"<p>{p}</p>" for p in paras)
            z.writestr(f"OEBPS/ch{i}.xhtml", f"""<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ru"><head><title>{title}</title>
<link rel="stylesheet" href="style.css"/></head><body><h1>{title}</h1>
{body}
<script>document.body.dataset.scriptRan = "yes"</script>
</body></html>""", compress_type=zipfile.ZIP_DEFLATED)
            items.append(f'<item id="ch{i}" href="ch{i}.xhtml" media-type="application/xhtml+xml"/>')
            spine.append(f'<itemref idref="ch{i}"/>')
            nav.append(f'<li><a href="ch{i}.xhtml">{title}</a></li>')
        z.writestr("OEBPS/nav.xhtml", f"""<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Оглавление</title></head>
<body><nav epub:type="toc"><ol>{"".join(nav)}</ol></nav></body></html>""", compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/style.css", "h1 { text-align: center; } p { text-indent: 1.5em; margin: 0; }",
                   compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/cover.png", png(300, 450, "1"), compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/content.opf", f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" xml:lang="ru">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:7d5b4f2e-5d1c-4c47-9f0a-000000000001</dc:identifier>
    <dc:title>Проверочная книга EPUB</dc:title>
    <dc:creator>Тест Тестов</dc:creator>
    <dc:language>ru</dc:language>
    <meta property="dcterms:modified">2026-10-26T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>
    {"".join(items)}
  </manifest>
  <spine>{"".join(spine)}</spine>
</package>""", compress_type=zipfile.ZIP_DEFLATED)


# --- FB2 ---------------------------------------------------------------------------------------

def fb2_text() -> str:
    sections = []
    for title, paras in chapters(seed=2):
        body = "".join(f"<p>{p}</p>" for p in paras)
        sections.append(f"<section><title><p>{title}</p></title>{body}</section>")
    cover = base64.b64encode(png(300, 450, "2")).decode()
    return f"""<?xml version="1.0" encoding="windows-1251"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
 <title-info>
  <genre>prose</genre>
  <author><first-name>Тест</first-name><last-name>Тестов</last-name></author>
  <book-title>Проверочная книга FB2 — «ёлки»</book-title>
  <coverpage><image l:href="#cover.png"/></coverpage>
  <lang>ru</lang>
 </title-info>
 <document-info><author><nickname>generator</nickname></author><date>2026</date><id>test-fb2-0001</id><version>1.0</version></document-info>
</description>
<body>{"".join(sections)}</body>
<binary id="cover.png" content-type="image/png">{cover}</binary>
</FictionBook>
"""


# --- CBZ ---------------------------------------------------------------------------------------

def make_cbz(path: Path, pages=6):
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for n in range(1, pages + 1):
            z.writestr(f"PAGE{n:02d}.PNG", png(600, 900, str(n)))


# --- PDF ---------------------------------------------------------------------------------------

def write_pdf(path: Path, pages: int, image_size=0):
    """Minimal PDF. With `image_size`, each page carries an uncompressed gray image."""
    offsets = []

    with open(path, "wb") as f:
        def obj(num: int, body: bytes):
            offsets.append((num, f.tell()))
            f.write(f"{num} 0 obj\n".encode() + body + b"\nendobj\n")

        f.write(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
        # 1 catalog, 2 pages, 3 font; per page: page, content, [image]
        per_page = 3 if image_size else 2
        kids = " ".join(f"{4 + i * per_page} 0 R" for i in range(pages))
        obj(1, b"<< /Type /Catalog /Pages 2 0 R >>")
        obj(2, f"<< /Type /Pages /Kids [{kids}] /Count {pages} >>".encode())
        obj(3, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
        for i in range(pages):
            page_num, content_num, image_num = 4 + i * per_page, 5 + i * per_page, 6 + i * per_page
            resources = "/Font << /F1 3 0 R >>"
            if image_size:
                resources += f" /XObject << /Im1 {image_num} 0 R >>"
            obj(page_num, f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                          f"/Resources << {resources} >> /Contents {content_num} 0 R >>".encode())
            lines = [f"BT /F1 28 Tf 72 720 Td (Page {i + 1} of {pages}) Tj ET"]
            for k in range(20):
                lines.append(f"BT /F1 12 Tf 72 {680 - k * 18} Td (Line {k + 1} of page {i + 1}: "
                             f"the quick brown fox jumps over the lazy dog.) Tj ET")
            if image_size:
                lines.append(f"q 400 0 0 400 106 120 cm /Im1 Do Q")
            content = "\n".join(lines).encode()
            obj(content_num, f"<< /Length {len(content)} >>\nstream\n".encode() + content + b"\nendstream")
            if image_size:
                pixels = b"".join(gray_image(image_size, image_size, str(i + 1), background=200 + i % 40))
                obj(image_num, f"<< /Type /XObject /Subtype /Image /Width {image_size} /Height {image_size} "
                               f"/ColorSpace /DeviceGray /BitsPerComponent 8 /Length {len(pixels)} >>\nstream\n".encode()
                    + pixels + b"\nendstream")
        xref = f.tell()
        count = max(n for n, _ in offsets) + 1
        f.write(f"xref\n0 {count}\n0000000000 65535 f \n".encode())
        for _, off in sorted(offsets):
            f.write(f"{off:010d} 00000 n \n".encode())
        f.write(f"trailer\n<< /Size {count} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--large", action="store_true", help="also generate large/big.pdf (~300 MB)")
    args = parser.parse_args()

    ROOT.mkdir(exist_ok=True)
    make_epub(ROOT / "sample.epub")
    fb2 = fb2_text().encode("cp1251")
    (ROOT / "sample-cp1251.fb2").write_bytes(fb2)
    with zipfile.ZipFile(ROOT / "sample.fb2.zip", "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("sample-cp1251.fb2", fb2)
    make_cbz(ROOT / "SAMPLE-UPPER.CBZ")
    write_pdf(ROOT / "sample.pdf", pages=20)
    if args.large:
        (ROOT / "large").mkdir(exist_ok=True)
        write_pdf(ROOT / "large" / "big.pdf", pages=600, image_size=700)
    for p in sorted(ROOT.rglob("*")):
        if p.is_file():
            print(f"{p.relative_to(ROOT)}  {p.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
