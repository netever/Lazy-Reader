# Настройка приложения Dropbox

Эти шаги делает владелец один раз. Нужен **отдельный тестовый аккаунт Dropbox**, не основной.

## 1. Создать приложение

1. Откройте <https://www.dropbox.com/developers/apps> → «Create app».
2. API: **Scoped access**.
3. Тип доступа: **App folder**. Приложение будет видеть только папку `Apps/<имя приложения>`.
4. Имя приложения, например `Lazy Reader Test`. Оно станет именем папки, поменять потом нельзя.

## 2. Права (вкладка Permissions)

Отметьте и нажмите «Submit»:

- `files.metadata.read`
- `files.metadata.write`
- `files.content.read`
- `files.content.write`

`account_info.read` включён по умолчанию. Права группы `team_*` не включайте: с ними вход через Google зацикливается.

## 3. Вход (вкладка Settings)

1. «Allow public clients (Implicit Grant & PKCE)»: **Allow**. Так вход работает без секрета приложения.
2. «Redirect URIs» — добавьте оба адреса точно так:
   - `http://localhost:47823/dropbox` — для Windows и macOS.
   - `com.lazyreader.app://oauth/dropbox` — для Android.

   Если Dropbox не примет второй адрес, сообщите Claude Code: для Android есть запасной вариант с вводом кода вручную.
3. Скопируйте **App key** в `config/local.json` в поле `dropbox.appKey`. **App secret** не нужен, не копируйте его.

## Лимиты

Приложение в режиме разработки могут подключить до 500 аккаунтов. После 50-го даётся две недели на получение статуса production. Для личного использования production не нужен.

## Что сообщить Claude Code

- Что приложение создано, права отмечены, оба redirect URI приняты.
- Что `config/local.json` заполнен.
