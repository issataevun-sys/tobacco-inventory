# Tobacco Inventory — iPhone PWA (prototype)

Standalone GitHub Pages PWA for testing **EAN-13 + Data Matrix** reading and local weight entries on a real iPhone.

## What works in source

- PWA metadata, offline shell (Service Worker), monochrome/yellow icon and iOS standalone mode.
- Camera scan using html5-qrcode, EAN-13 / Data Matrix, extraction and validation of GS1 GTIN, manual entry fallback.
- Local-only IndexedDB records, weight entry, on-device list and JSON export.
- Scanner dependency is loaded from pinned external CDN once and cached for later launches. A first online camera test is necessary.
- The code does **not** call Google Apps Script or Google Sheets. No authentication or access to operational data is included in public-hosted assets.

## GitHub Pages

Workflow: `.github/workflows/pages.yml`, branch `main`, repository root.
To deploy, the owner must enable GitHub Pages **GitHub Actions** under repository Settings → Pages and ensure the repository's plan/visibility supports Pages. If the private repository cannot host Pages, publish **only this static PWA directory** to a separate public repo; never publish the GAS backend or secrets.

Do not assume a functioning public URL until a Pages deployment succeeds. The usual project URL would be `https://issataevun-sys.github.io/tobacco-inventory/` **only if Pages is enabled and deployment completes**.

## Test steps

1. Open the deployed HTTPS URL in Safari on the iPhone; Share → Add to Home Screen.
2. Launch the installed app; allow the camera. Try a real EAN-13 and a GS1 Data Matrix. The Data Matrix should resolve a 14-digit GTIN.
3. Enter a flavor and net/gross measured weight as test data; save. Reload, go offline, confirm previously saved entries remain available.
4. Export JSON before clearing Safari or deleting the PWA; device-local data is otherwise lost.

## NOT IMPLEMENTED / safety boundary

- No server synchronization or catalog lookup: records are **not** reflected in STAFF/MANAGEMENT inventories.
- Full reusable local inventory UX (Service/Склад, stock packs, coal, mouthpieces) from the existing GAS app is not yet integrated into this static client.
- Camera and Code 128 / Data Matrix scanning must be confirmed on an actual iPhone (not proven by source checks).
- Offline decoder after first load depends on successful caching; camera still depends on iOS permissions.
- Current generated SVG is a vector approximation of the approved yellow/black artwork; iPhone raster Apple Touch Icon is still needed for final-quality installation.
- Never use test scanner entries as authoritative inventory.
