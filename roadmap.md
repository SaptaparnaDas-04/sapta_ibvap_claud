# IBVAP roadmap

- [x] Tactical dark design system
- [x] Overview / problem-statement page
- [x] Live analytics page: phone camera + webcam + IP URL + demo feed
- [x] QR / PIN phone pairing panel
- [x] Canvas analytics overlays: human, vehicle, face, ANPR readout
- [x] Night-vision / thermal contrast toggle
- [x] Interactive tripwire + polygon drawing with audio + visual alerts
- [x] Command grid: multi-camera + single focus view
- [x] Alert feed with severity, thumbnails, BOP tags
- [x] Incident log: filters, status tracking, CSV export
- [x] BOP deployment map with node health
- [x] Architecture page (React / Node / OpenCV / WebRTC)
- [x] Keyboard shortcuts + sound notifications

## Open (needs backend)
- Cross-device WebRTC relay: phone streaming to a second screen needs the
  signalling service — enable the backend to add true phone-to-laptop pairing
  and a shared, stored incident log across operators.

## Field capture (phone browser)
- [x] Rear/front getUserMedia with fallbacks and permission error guidance
- [x] Tap-to-focus, digital zoom, torch (where the device exposes them)
- [x] Countdown timer, retake/confirm review, gallery upload
- [x] Snapshot analytics overlays + threat breakdown card
- [x] Download annotated snapshot, persistent capture history with delete/clear
- [x] Dark/light mode toggle
- [x] PWA app-shell caching (offline-tolerant load, analysis still needs network)
- [x] Helpful tooltips on capture controls

## Live phone → laptop relay
- [x] Real peer-to-peer WebRTC video: phone camera streams directly to the
      laptop's browser (not through any server) once paired via the same
      QR/PIN used for local phone capture
- [x] Minimal signaling-server/ (WebSocket) to exchange connection info only
      — never touches video frames
- [x] "Phone → laptop" source on /live: laptop waits, phone auto-broadcasts
      once its camera starts (if opened via the pairing link)
- Needs both devices on the same Wi-Fi/LAN (no TURN server configured) and
  `signaling-server` running alongside the app
