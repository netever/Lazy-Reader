# Лицензии зависимостей

Здесь перечислены прямые зависимости, которые попадают в сборку приложения. Транзитивные зависимости проверяются автоматически:

- npm: `npm run licenses` (скрипт `scripts/check-npm-licenses.mjs`);
- Rust: `cargo deny --manifest-path src-tauri/Cargo.toml check licenses` (правила в `src-tauri/deny.toml`).

Обе проверки запускаются в CI (`.github/workflows/windows.yml`). Разрешённые лицензии — SPEC, раздел 2; MPL-2.0 — ADR 0003.

## Интерфейс (npm и vendor)

| Зависимость | Версия | Лицензия | Зачем |
| --- | --- | --- | --- |
| foliate-js (git submodule `vendor/foliate-js`) | коммит 78914aef | MIT | Разбор и показ EPUB, FB2, MOBI, AZW3, CBZ |
| └ zip.js (внутри foliate-js) | vendor | BSD-3-Clause | Чтение ZIP (EPUB, CBZ, .fb2.zip) |
| └ fflate (внутри foliate-js) | vendor | MIT | Распаковка шрифтов в KF8 |
| └ PDF.js (внутри foliate-js) | vendor | Apache-2.0 | Не используется, попадает в сборку отдельным чанком (ADR 0002) |
| pdfjs-dist | 6.4.299 | Apache-2.0 | Показ PDF |
| react, react-dom | 19.3.1 | MIT | Интерфейс |
| @tauri-apps/api | 2.12.4 | Apache-2.0 OR MIT | Вызовы ядра на Rust |

`pdfjs-dist` объявляет необязательную зависимость `@napi-rs/canvas` (MIT). Она нужна PDF.js только в Node и в сборку приложения не попадает.

## Ядро (Rust)

| Крейт | Версия | Лицензия | Зачем |
| --- | --- | --- | --- |
| tauri, tauri-build | 2.x | Apache-2.0 OR MIT | Оболочка приложения |
| tauri-plugin-log | 2.x | Apache-2.0 OR MIT | Логи (logcat на Android, файл на компьютере) |
| log | 0.4 | MIT OR Apache-2.0 | Интерфейс логирования |
| serde, serde_json | 1.x | MIT OR Apache-2.0 | JSON-файлы состояния |
| sha2 | 0.11 | MIT OR Apache-2.0 | SHA-256 книг |
| uuid | 1.x | Apache-2.0 OR MIT | Идентификаторы книг и устройства |

Только для тестов, в сборку не попадает: `tempfile` (MIT OR Apache-2.0).

## Шрифты

Пока своих шрифтов нет. Шрифт для дислексии добавляется в фазе 1, только под OFL.

## Тестовые книги

`test-books/` создаёт скрипт `scripts/make-test-books.py` из случайных слов. Текст и картинки свои, без ограничений (CC0).

## Экран «Лицензии» в приложении

MIT, BSD и Apache-2.0 требуют прикладывать тексты лицензий, Apache-2.0 ещё и NOTICE. Автоматический сбор текстов для экрана «О программе → Лицензии» — задача фазы 1.
