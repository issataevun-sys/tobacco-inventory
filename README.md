# Cocktail Room · iPhone Inventory PWA v1.2.0

Это **полная оболочка инвентаризации** на основе GAS-приложения `../Index.html` + `../TobaccoView.html`, а не отдельный локальный сканер.

## Реализовано
- Те же инвентаризации, вкладки «Сервис» и «Склад», уголь/мундштуки, закрытые пачки, создание дат ±1 день, кнопки заполнения нулями, ручной ввод.
- В «Сервисе» — сканер Data Matrix / EAN-13, перенесённый из подтверждённого сканера `issataevun-sys/tobacco-inventory` v1.0.2: html5-qrcode 2.3.8, ZXing (без native BarcodeDetector), квадратная рамка, 1080p.
- Казахстанская маркировка 14 GTIN + 7 серийных символов + 8 проверочных символов и GS1 AI 01. GTIN сопоставляется с действующим листом `TobaccoBarcodes` в существующей TOBACCO 2.0; новые справочники не создаются.
- Вес вводится в существующее поле **«Вес с тарой»**, следующим сканированием можно продолжать; итог сохраняется штатной кнопкой «Сохранить».
- IndexedDB и офлайн-очередь из исходного приложения; автоматическая отправка после восстановления связи, если нет конфликта.
- Service Worker для PWA-оболочки и локального кеша html5-qrcode после первой загрузки.

## Установка серверной части (один раз)
1. В **отдельном проекте** Google Apps Script для инвентаризации обновить `Code.gs`, `Tobacco.gs`, `TobaccoView.html`, `Index.html` из `cocktail-room-2/develop/apps/inventory-iphone` (для фактической работы PWA критичны Code.gs с `doPost` и Tobacco.gs с `TobaccoBarcodes`).
2. Script Properties: `CR_TEMP_TOBACCO_DB_ID`, `CR_TEMP_CATALOG_ID`, `CR_TEMP_DEVICE_SECRET` — существующие, никогда не публикуйте ключ. Сохраните новую версию веб-развертывания GAS с URL вида `https://script.google.com/macros/s/.../exec`. Не используйте `/dev`.
3. Создайте Cloudflare Worker с исходником `cocktail-room-2/develop/apps/inventory-iphone/pwa/bridge-worker.js`. Задайте **Worker Variables**:
   - `GAS_WEB_APP_URL` = полный `.../exec` URL проекта GAS
   - `PWA_ORIGIN` = `https://issataevun-sys.github.io`
   Не записывайте запросы/ответы Worker с секретами в журналы.
4. Задеплойте Worker, скопируйте его HTTPS URL `https://...workers.dev`. Сам Worker обрабатывает CORS и не даёт клиенту менять GAS endpoint.
5. На iPhone в Safari откройте статическую PWA `https://issataevun-sys.github.io/tobacco-inventory/` (доступна только после успешного GitHub Pages deployment). Введите URL Worker и имеющийся код активации. Потом «Поделиться» → «На экран Домой».

## Публикация
Статическая PWA копируется в отдельный **публичный** репозиторий `issataevun-sys/tobacco-inventory`. Там должны быть только `index.html`, `app.js`, `sw.js`, `icon.svg`, `manifest.webmanifest` и GitHub Pages workflow. **Код GAS, таблицы и секреты не публиковать.**

В публичном репозитории Settings → Pages → Source: GitHub Actions. Дождитесь успешного Actions → Pages, иначе URL не работает.

## Примечания и ограничения
- Развертывание в GAS, Cloudflare, GitHub Pages и e2e-тест на реальном iPhone требуют проверки и не выполняются самим коммитом.
- Если соответствующий GTIN отсутствует в `TobaccoBarcodes` или вкус отсутствует в активной инвентаризации, приложение не придумывает вкус.
- При конфликте серверной ревизии данные остаются в локальной очереди и требуют сверки, а не принудительного перезаписывания.
- Первый запуск и первая загрузка библиотеки сканера требуют интернет; перед реальной работой проверьте офлайн-загрузку и актуальность кеша на iPhone.
- Текущая восьмисимвольная схема активации предназначена только для ограниченного теста, не для публичного продуктового доступа.
