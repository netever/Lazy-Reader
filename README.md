# Читалка (Lazy Reader)

Кроссплатформенная читалка книг: сначала Windows и Android, позже iOS и macOS. Синхронизация через Google Drive или Dropbox читателя, без своего сервера. Полное ТЗ — [docs/SPEC.md](docs/SPEC.md).

**Статус: фаза 0 (прототип).** Приложение открывает EPUB, FB2, `.fb2.zip`, CBZ, MOBI/AZW3 и PDF, листает с анимацией и запоминает позицию. Синхронизации, заметок и тем пока нет. Что проверено и что нет — [docs/CHECKS.md](docs/CHECKS.md), замеры — [docs/PERF.md](docs/PERF.md).

## Как устроен проект

Если сравнивать с Python: интерфейс — это «фронтенд» на TypeScript, который работает внутри системного браузерного движка (WebView). Всё, что требует доступа к файлам, работает в «ядре» на Rust. Интерфейс вызывает функции ядра по имени через `invoke(...)`, это похоже на вызов функций по RPC.

```text
src/                     интерфейс (TypeScript + React)
  api.ts                 все вызовы ядра в одном месте
  App.tsx                корень: библиотека или читалка
  library/               экран библиотеки, импорт книг
  reader/                читалки: FoliateReader (EPUB, FB2, CBZ, MOBI), PdfReader (PDF)
    locator.ts           позиция в книге (CFI, цитата, доля) — чистые функции с тестами
    book-loader.ts       байты книги → объект foliate-js
  i18n/                  тексты интерфейса (ru.json)
  dev/mock-backend.ts    заглушка ядра для проверки интерфейса в обычном браузере
src-tauri/               ядро (Rust)
  src/library.rs         импорт книг, чтение файла целиком и по диапазонам
  src/state.rs           файлы состояния и настроек
  src/storage.rs         каталог данных, атомарная запись, device-id
  src/perf.rs            метки времени запуска
  tauri.conf.json        окно, CSP (запрет скриптов из книг)
  gen/android/           Android-проект (создан `tauri android init`)
vendor/foliate-js/       движок книг, git submodule (ADR 0002)
docs/                    ТЗ, решения (adr/), проверки, замеры, лицензии, настройка облаков
scripts/                 окружение, генератор тестовых книг, замеры, проверка лицензий
test-books/              свободные тестовые книги (генерируются скриптом)
tests/                   тесты логики интерфейса (Vitest)
```

### Термины

- **Tauri** — оболочка: окно приложения с системным WebView и ядром на Rust.
- **WebView** — встроенный браузерный движок системы: WebView2 на Windows, Android System WebView, WKWebView на macOS.
- **foliate-js** — библиотека, которая рисует EPUB, FB2, MOBI и CBZ в WebView.
- **PDF.js** — библиотека Mozilla для показа PDF.
- **CFI** — стандартный адрес места в EPUB, вида `epubcfi(/6/4!/4/2/1:0)`. Для FB2 и CBZ foliate-js строит такой же адрес по своей HTML-версии книги.
- **Локатор** — позиция в книге, записанная несколькими способами сразу: CFI, цитата вокруг, доля книги. Страницы зависят от шрифта, локатор — нет.
- **State-файл** — `state/<book-id>/<device-id>.json`: позиция, заметки, закладки одного устройства.
- **ADR** — короткая запись о решении в `docs/adr/`.

### Где приложение хранит данные

| Система | Каталог |
| --- | --- |
| macOS | `~/Library/Application Support/com.lazyreader.app/` |
| Windows | `%APPDATA%\com.lazyreader.app\` |
| Android | `/data/user/0/com.lazyreader.app/` (доступ через `adb shell run-as com.lazyreader.app`) |

Внутри: `books/` (копии книг), `meta/`, `state/`, `settings.json`, `device.json`, `perf.log`.

## Установка инструментов (macOS)

Всё ставится в домашнюю папку, без `sudo`. Нужны Homebrew и Xcode Command Line Tools (`xcode-select --install`).

```bash
brew install rustup node@24 openjdk@17
```

```bash
source scripts/env.sh && rustup set profile minimal && rustup default stable && rustup target add aarch64-linux-android
```

Android SDK без Android Studio: скачать command-line tools (<https://developer.android.com/studio#command-line-tools-only>) и распаковать в `~/Library/Android/sdk/cmdline-tools/latest`, затем:

```bash
source scripts/env.sh && sdkmanager --licenses && sdkmanager "platform-tools" "platforms;android-36" "build-tools;37.0.0" "ndk;30.0.16248370" "emulator" "system-images;android-36;google_apis_playstore;arm64-v8a"
```

`scripts/env.sh` настраивает `PATH`, `JAVA_HOME`, `ANDROID_HOME` и `NDK_HOME` только для текущего терминала. Выполняйте `source scripts/env.sh` в каждом новом терминале перед командами ниже.

## Первый запуск

```bash
git submodule update --init
```

```bash
source scripts/env.sh && npm ci && python3 scripts/make-test-books.py
```

## Команды

| Что | Команда |
| --- | --- |
| Запустить на macOS в режиме разработки | `npm run tauri dev` |
| Тесты логики интерфейса | `npm test` |
| Проверка типов TypeScript | `npm run typecheck` |
| Тесты ядра | `cargo test --manifest-path src-tauri/Cargo.toml` |
| Лицензии npm | `npm run licenses` |
| Лицензии Rust | `cargo deny --manifest-path src-tauri/Cargo.toml check licenses` (один раз: `cargo install cargo-deny --locked`) |
| Тестовые книги | `python3 scripts/make-test-books.py` (с `--large` — ещё два PDF по 300 МБ, в git не попадают) |
| Интерфейс в обычном браузере | `npm run dev`, затем открыть <http://localhost:1420>. Ядро заменено заглушкой, книги берутся из `test-books/` |

## Android

Эмулятор (образ с Google Play нужен для будущего входа в Google):

```bash
avdmanager create avd -n reader-api36 -k "system-images;android-36;google_apis_playstore;arm64-v8a" -d pixel_6
```

```bash
emulator -avd reader-api36
```

Сборка отладочного APK и установка на эмулятор или телефон с включённой отладкой по USB:

```bash
npm run tauri android build -- --debug --apk --target aarch64
```

```bash
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

Для живой разработки вместо сборки: `npm run tauri android dev`.

Полезное для проверок:

- `adb logcat | grep PERF` — метки запуска и перелистывания.
- `node scripts/webview-eval.mjs "document.title"` — выполнить JavaScript в WebView приложения (только отладочная сборка).
- `scripts/measure-start-android.sh` — замер холодного старта, инструкция в [docs/PERF.md](docs/PERF.md).

## Windows

Разработка идёт на macOS, поэтому Windows-версия собирается в GitHub Actions (`.github/workflows/windows.yml`): типы, тесты, лицензии и установщик NSIS. Чтобы это заработало, репозиторий нужно выложить на GitHub (можно приватным). Установщик лежит в разделе «Artifacts» каждого запуска.

Замер запуска на Windows: `scripts/measure-start-windows.ps1`, инструкция в [docs/PERF.md](docs/PERF.md).

## Облака

Синхронизация — фаза 2. Подготовка проекта Google Cloud и приложения Dropbox: [docs/SETUP-GOOGLE.md](docs/SETUP-GOOGLE.md), [docs/SETUP-DROPBOX.md](docs/SETUP-DROPBOX.md). Идентификаторы клиентов хранятся в `config/local.json`, который не попадает в git (пример: `config/local.example.json`).
