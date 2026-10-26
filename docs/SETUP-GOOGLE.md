# Настройка Google Cloud для читалки

Эти шаги делает владелец один раз. Нужен **отдельный тестовый Google-аккаунт**, не основной. Интерфейс консоли Google меняется, поэтому названия пунктов меню могут немного отличаться.

Все клиенты создаются **в одном проекте**: доступ `drive.file` принадлежит проекту, и только так клиенты Windows и Android видят файлы друг друга (SPEC, раздел 5).

## 1. Проект и Drive API

1. Откройте <https://console.cloud.google.com/> под тестовым аккаунтом.
2. Создайте проект, например «Lazy Reader».
3. «APIs & Services» → «Library» → **Google Drive API** → «Enable».
4. Google Picker API пока не включайте, он понадобится, только если вы попросите выбор книг из Drive.

## 2. Экран согласия

Раздел «Google Auth platform».

1. «Branding»: название приложения и почта поддержки. Логотип не загружайте: он требует проверки бренда.
2. «Audience»: тип **External**.
3. «Data access» → «Add or remove scopes»: добавьте две строки:
   - `https://www.googleapis.com/auth/drive.file`
   - `https://www.googleapis.com/auth/drive.appdata`

   Обе в группе «non-sensitive». Если консоль пометит их как sensitive или restricted, остановитесь и сообщите Claude Code.
4. «Audience» → **Publish app**, статус должен стать **In production**. В статусе «Testing» токены живут 7 дней. С нечувствительными правами проверка Google не нужна и лимита пользователей нет.

## 3. Клиент для Windows и macOS

«Clients» → «Create client».

1. Тип **Desktop app**, имя «Reader Desktop».
2. Скопируйте **Client ID** и **Client secret** в `config/local.json` (см. ниже). Секрет для настольного клиента Google не считает настоящим секретом, но в git его не кладём.

## 4. Клиенты для Android

Для Android клиент привязывается к имени пакета и отпечатку подписи. Имя пакета читалки: `com.lazyreader.app`.

1. Отпечаток отладочной подписи (ей подписываются сборки для разработки):

   ```bash
   keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android | grep SHA1
   ```

   Файл `~/.android/debug.keystore` появляется после первой сборки Android-версии. Команда `keytool` входит в JDK 17 (см. README).
2. «Clients» → «Create client» → тип **Android**, имя «Reader Android debug», имя пакета `com.lazyreader.app`, отпечаток SHA-1 из шага 1.
3. Для релизной сборки позже создадим свой ключ и второй клиент «Reader Android release» с его отпечатком. Если приложение будет в Google Play с App Signing, отпечаток берётся из Play Console.

Идентификатор Android-клиента в код не вписывается: Google находит его сам по имени пакета и подписи.

## 5. Локальная конфигурация

Скопируйте `config/local.example.json` в `config/local.json` и заполните:

```json
{
  "google": {
    "desktopClientId": "…apps.googleusercontent.com",
    "desktopClientSecret": "…"
  },
  "dropbox": {
    "appKey": ""
  }
}
```

Файл `config/local.json` указан в `.gitignore` и в репозиторий не попадает.

## Что сообщить Claude Code

- Что проект создан и статус «In production».
- Что `config/local.json` заполнен.
- Создан ли Android-клиент с отладочным отпечатком.
