# UltraRec — 4K 60FPS Chrome Screen Recorder (Manifest V3)

UltraRec is a production-ready Google Chrome extension engineered for high-performance screen recording with hardware-accelerated 4K resolution (3840×2160) at 60 frames per second, system audio, and microphone audio mixing.

## Architecture (Manifest V3)

- **`manifest.json`**: Configured with MV3 service worker, `storage`, `tabCapture`, `desktopCapture`, `downloads`, and `offscreen` permissions.
- **`popup.html` & `popup.js`**: Dark-mode user interface with resolution options (4K, 1440p, 1080p), FPS selector (60 / 30 FPS), audio toggles, countdown timers, live recording duration stopwatch, and controls.
- **`background.js`**: Service Worker coordinating recording lifecycle, toolbar badge updates (`REC`, `PAUSE`), keyboard shortcuts (`Ctrl+Shift+S`), and triggering automatic downloads via `chrome.downloads`.
- **`offscreen.html` & `offscreen.js`**: Persistent offscreen DOM context that captures display media, performs Web Audio API track mixing (combining tab audio and microphone audio into a single destination), and handles high-bitrate MediaRecorder encoding (VP9, VP8, H.264/MP4) with graceful display fallback.

## Installation Instructions

1. Download or unzip the `ultrarec-extension` folder.
2. In Google Chrome, go to `chrome://extensions/`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the folder containing `manifest.json`.
6. Pin **UltraRec** to your Chrome toolbar and start recording!
