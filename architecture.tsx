import { createFileRoute } from "@tanstack/react-router";
import { Panel, SiteFooter, SiteHeader, Tag } from "@/components/hud";

export const Route = createFileRoute("/architecture")({
  head: () => ({
    meta: [
      { title: "IBVAP Architecture — React, Node.js, OpenCV, WebRTC" },
      {
        name: "description",
        content:
          "How IBVAP ingests phone and IP CCTV streams over WebRTC/RTSP and runs low-latency OpenCV analytics with a React command console.",
      },
      { property: "og:title", content: "IBVAP Architecture" },
      {
        property: "og:description",
        content:
          "Phone-as-CCTV over WebRTC, Node.js ingest gateway, OpenCV vision workers, Postgres event store, React command console.",
      },
    ],
  }),
  component: Architecture,
});

const STACK = [
  {
    layer: "Capture",
    tech: "Phone browser (WebRTC) · IP CCTV (RTSP/ONVIF) · USB webcam",
    note: "A smartphone becomes a field camera in seconds — pair by QR, no app install. Existing BOP cameras join by stream URL.",
  },
  {
    layer: "Transport",
    tech: "WebRTC (SRTP/DTLS) · SRT fallback · MJPEG for legacy DVRs",
    note: "WebRTC keeps phone-to-console glass-to-glass latency in the 150–300 ms band on LAN and on 4G tethering.",
  },
  {
    layer: "Ingest gateway",
    tech: "Node.js · Express · socket.io signalling · ffmpeg",
    note: "Terminates streams, publishes decoded frames on a bounded ring buffer and drops stale frames so analytics never queue up.",
  },
  {
    layer: "Vision workers",
    tech: "OpenCV · OpenCV.js in-browser · ONNX detectors · Tesseract OCR",
    note: "Per-frame pipeline: background subtraction, person/vehicle detection, face crops, plate localisation plus OCR, tracker association.",
  },
  {
    layer: "Rules & events",
    tech: "Tripwire / polygon geometry · dwell timers · night profiles",
    note: "Detections become severity-scored events: critical fence breach, suspicious vehicle, watchlist face match.",
  },
  {
    layer: "Data & storage",
    tech: "Postgres · object storage for snapshots · row-level security",
    note: "Event log, incident status, camera registry and evidence frames — synced upward when the remote link is available.",
  },
  {
    layer: "Console",
    tech: "React 19 · TanStack Router · Tailwind · Canvas overlays",
    note: "Multi-camera grid, focus view, alert feed, incident log, BOP map, keyboard-driven triage.",
  },
  {
    layer: "Integration",
    tech: "REST + webhooks · MQTT · CAP-style alert payloads",
    note: "Events push into existing command and control, radio dispatch and SMS/siren actuators.",
  },
];

const LATENCY = [
  ["Phone capture + encode", "35 ms"],
  ["WebRTC transport (LAN)", "45 ms"],
  ["Decode + preprocess", "25 ms"],
  ["Detection + tracking", "60 ms"],
  ["Rules + alert render", "20 ms"],
];

function Architecture() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-10">
        <Tag tone="primary">System design</Tag>
        <h1 className="mt-4 font-display text-4xl font-bold">Architecture &amp; signal path</h1>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          IBVAP is software-defined: every intelligent function runs on commodity compute at the
          post, so no camera has to be replaced. The console you are using demonstrates the
          browser-side analytics path with a real camera feed.
        </p>

        <div className="mt-8 overflow-x-auto">
          <pre className="panel p-5 font-mono text-[11px] leading-relaxed text-muted-foreground">
{`  ┌────────────┐   WebRTC    ┌──────────────┐   frames   ┌────────────────┐
  │  Phone cam │────────────▶│              │───────────▶│ Vision workers │
  └────────────┘             │   Node.js    │            │ OpenCV / ONNX  │
  ┌────────────┐   RTSP      │   ingest     │            │ ANPR · FRS     │
  │ BOP CCTV   │────────────▶│   gateway    │◀───────────│ tracker        │
  └────────────┘             └──────┬───────┘   events   └────────┬───────┘
  ┌────────────┐   MJPEG            │                            │
  │ Legacy DVR │────────────────────┘                            ▼
  └────────────┘                                         ┌────────────────┐
                                    alerts (ws)          │ Rules engine   │
  ┌──────────────────┐  ◀──────────────────────────────── │ fence · dwell  │
  │ React console    │                                    └────────┬───────┘
  │ grid · map · log │  ◀── event store (Postgres + snapshots) ◀────┘
  └──────────────────┘  ────▶ existing C2 / radio / SMS`}
          </pre>
        </div>

        <div className="mt-8 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
          <Panel title="Layer by layer">
            <ul className="space-y-3">
              {STACK.map((s) => (
                <li key={s.layer} className="border-b border-border pb-3 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3 className="font-display text-lg font-semibold">{s.layer}</h3>
                    <span className="font-mono text-[11px] text-primary">{s.tech}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{s.note}</p>
                </li>
              ))}
            </ul>
          </Panel>

          <div className="space-y-3">
            <Panel title="Latency budget · target < 300 ms">
              <ul className="space-y-2">
                {LATENCY.map(([k, v]) => (
                  <li key={k} className="flex items-center justify-between gap-3 font-mono text-xs">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="text-primary">{v}</span>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-3 border-t border-border pt-2 font-mono text-xs">
                  <span>Glass to console</span>
                  <span className="text-primary">≈185 ms</span>
                </li>
              </ul>
            </Panel>

            <Panel title="Deployment notes">
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>· One edge node per cluster of posts; runs offline, queues events on link loss.</li>
                <li>· Analytics profiles are per camera, so a road camera does ANPR while a fence camera does intrusion only.</li>
                <li>· Frame drops preferred over queueing — latency is a security requirement, not a comfort.</li>
                <li>· Evidence frames retained with hash + timestamp for audit and prosecution.</li>
                <li>· Operator actions (dispatch, resolve) are logged against the incident record.</li>
              </ul>
            </Panel>

            <Panel title="Privacy & control">
              <p className="text-sm text-muted-foreground">
                Face and plate data stay on the post's node unless an operator escalates an
                incident. Watch-list matching runs against a locally held template store, and every
                match is written to an audit trail with the operator who reviewed it.
              </p>
            </Panel>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
