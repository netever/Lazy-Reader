# ADR 0001. Стек приложения

Статус: принято (решение владельца, раздел 2 SPEC). Пересматривается после фазы 0.

## Контекст

Нужна одна кодовая база для Windows и Android, позже iOS и macOS. Книги рисуют веб-движки: foliate-js (EPUB, FB2, MOBI, AZW3, CBZ) и PDF.js (PDF).

## Решение

- Оболочка: Tauri 2. Ядро на Rust отвечает за файлы, хэши, состояние и позже за облака.
- Интерфейс: TypeScript, React, Vite.
- Тесты логики: Vitest (TypeScript) и `cargo test` (Rust).
- Запасной вариант: Flutter. Решение о переходе принимает владелец по итогам фазы 0 (`docs/CHECKS.md`, `docs/PERF.md`).

## Последствия

- Вид книги зависит от системного WebView: WebView2 на Windows, Android System WebView на Android, WKWebView на macOS. Проверять нужно на каждой платформе.
- Владелец лучше знает Python. Структура проекта и термины объяснены в README.
