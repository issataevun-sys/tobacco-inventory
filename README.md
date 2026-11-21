# Cocktail Room · Инвентаризация PWA v1.2.2

Публичная PWA: `https://issataevun-sys.github.io/tobacco-inventory/`.

Основа — существующее приложение `apps/inventory-iphone` (Сервис, Склад, закрытые пачки, уголь, мундштуки, ручной ввод, IndexedDB, очередь операций). Сканер Data Matrix использует проверенный вариант из Tobacco Inventory v1.0.2. GTIN сопоставляется с `TobaccoBarcodes` в действующей базе TOBACCO.

## Без Cloudflare и дополнительных серверов

1. В **существующем отдельном проекте инвентаризации GAS** обновить только `Code.gs` и `Tobacco.gs` из ветки `cocktail-room-2/develop/apps/inventory-iphone`. Не трогать GAS STAFF и MANAGEMENT.
2. Сохранить Script Properties как раньше: `CR_TEMP_DEVICE_SECRET`, `CR_TEMP_TOBACCO_DB_ID`, `CR_TEMP_CATALOG_ID`.
3. Развернуть новую версию GAS Web App с запуском от владельца, URL `https://script.google.com/macros/s/.../exec`. Для iframe-доступа вне домена Google Web App должен разрешать загрузку без интерактивного Google-входа; **публичное развертывание с одним 8-символьным ключом — временный тестовый риск**, поэтому не передавайте адрес и ключ посторонним.
4. Открыть PWA, ввести URL GAS `.../exec` и код активации. PWA использует iframe и `google.script.run`, не применяет сторонний Worker. Если Chrome/Safari блокирует iframe или сторонние cookies, прямое соединение может не работать; проверить на iPhone.
5. Подтвердить: загрузка активной инвентаризации → сканирование → определение вкуса → вес с тарой → «Сохранить» → синхронизация с TOBACCO.

Код не отправляет GTIN в сторонние сервисы. Декодер сканера загружается с CDN при первом запуске и затем кешируется. Весь GAS и ключи остаются только в приватном проекте.

PWA оболочка — статические `index.html`, `app.js`, `sw.js`, `manifest.webmanifest`, `icon.svg`. GitHub Pages публикуется из репозитория `issataevun-sys/tobacco-inventory`. Изменения основной системы выполняются только в ветке `develop`.
