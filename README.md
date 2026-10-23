# QR Scanner — complete source package

## Files
- `index.html` — original scanner UI and camera/scanning logic, preserved from the supplied file.
- `js/app.js` — history/settings/import-export enhancements and corrected QR creator live preview.
- `manifest.webmanifest` — PWA metadata.
- `sw.js` — app-shell service worker.
- `assets/icons/` — local PWA icons.

## QR creator behavior
- QR preview appears above the text field.
- Preview refreshes automatically while typing, with a short debounce.
- There is no Generate button and no QR-type selector; the creator generates a single text/URL payload.
- Download PNG and Share are enabled only after a successful preview.
- QR generator loading tries multiple CDN sources and reports an actionable status if unavailable.

## Preserved scanner features
- Camera scan starts automatically when the Scanner view initializes; camera switching, torch control, scan boundary overlay, and image-gallery scanning remain available.
- Native `BarcodeDetector` is used as a fast path where the browser supports it. The existing `html5-qrcode` scanner remains active as a fallback. Native detection checks more frequently, and the existing duplicate guard prevents double-opening the same scan result.
- The camera stream remains active while the scan-result sheet is visible; detection callbacks are gated until the result is dismissed.
- Existing result actions, history, scan filtering/search, favorites, notes, record deletion, JSON/CSV export and JSON import.
- User settings for vibration, duplicate suppression, and history retention.

## Run / deploy
1. Upload the contents of this folder so `index.html`, `manifest.webmanifest`, `sw.js`, and `js/app.js` keep these paths.
2. Serve over HTTPS (or localhost for development). Camera access requires a secure context.
3. The current package still loads `html5-qrcode`, QR generation, and Font Awesome from CDNs. Therefore this build is **not fully offline-capable for first-time loads** and does not yet bundle ZXing or jsQR locally. Native `BarcodeDetector` support varies by browser and format. The service worker caches the same-origin app shell, not those CDN libraries.

## Data and privacy
Scan history and settings are stored in the browser's local storage on the device. Clearing browser/site data can remove them; export a backup first.

## Final navigation and scanner positioning update
- Scan results now use a full-page result view above the persistent Scanner/Generator bottom tabs.
- Switching the bottom tab dismisses the result view before showing the selected tab.
- Scanner frame and scan-line animation are shifted slightly upward together.
- Added a Settings toggle for the browser's native leave-page confirmation. Browser wording and availability are controlled by the browser; it cannot be customized by the app.
- Existing camera auto-start behavior and the existing generator/history/settings code are retained.

## Latest camera UI refinements
- Replaced the camera status pill with a small status dot near the top edge; screen-reader status text remains available.
- Changed Gallery, Torch, and Flip controls to translucent backgrounds. Torch-on state uses a subtle translucent accent instead of a solid fill.
- Reworked camera zoom into a horizontal, draggable ruler with a fixed orange center marker and minus/plus step controls at the sides. Tick marks move as zoom changes.
- Camera zoom remains dependent on browser/device `MediaTrackCapabilities.zoom` support.
