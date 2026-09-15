import { createFileRoute, Link } from "@tanstack/react-router";
import { Panel, SiteFooter, SiteHeader, Stat, Tag } from "@/components/hud";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "IBVAP — Intelligent Border Video Analytics Platform" },
      {
        name: "description",
        content:
          "Turn existing border CCTV cameras into an AI surveillance network: intrusion detection, ANPR, human and vehicle tracking, real-time alerts.",
      },
      { property: "og:title", content: "IBVAP — Intelligent Border Video Analytics Platform" },
      {
        property: "og:description",
        content:
          "AI video analytics over standard IP CCTV: virtual fence breach, ANPR, face detection, night movement and instant alerts.",
      },
    ],
  }),
  component: Overview,
});

const CAPABILITIES = [
  {
    title: "Human detection & tracking",
    body: "Persistent IDs across frames with dwell time, direction of movement and crowd formation cues.",
  },
  {
    title: "Vehicle detection & classification",
    body: "Two-wheeler, LMV, truck and tractor classes with lane-wise counting at check posts.",
  },
  {
    title: "Face detection",
    body: "Face crops captured at gates and queued for watch-list matching, no dedicated FRS box required.",
  },
  {
    title: "Automatic Number Plate Recognition",
    body: "Plate localisation plus OCR on the same stream that already feeds the recorder.",
  },
  {
    title: "Virtual fence intrusion",
    body: "Operator-drawn lines and zones; a crossing raises a critical alert within one frame interval.",
  },
  {
    title: "Suspicious activity",
    body: "Loitering, abandoned objects, wrong-direction motion and sudden group formation.",
  },
  {
    title: "Night-time movement",
    body: "Low-light differencing with adaptive thresholds for IR and near-dark scenes.",
  },
  {
    title: "Alerts & event log",
    body: "Every detection is logged with camera, sector, confidence and snapshot for later audit.",
  },
];

function Overview() {
  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="mx-auto max-w-7xl px-4">
        <section className="grid gap-8 py-14 lg:grid-cols-[1.15fr_1fr] lg:py-20">
          <div>
            <Tag tone="primary">
              <span className="live-dot">●</span> Problem statement · border surveillance
            </Tag>
            <h1 className="mt-5 font-display text-5xl font-bold leading-[1.05] sm:text-6xl">
              Existing CCTV.
              <br />
              <span className="text-primary">Intelligent border</span> surveillance.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
              IBVAP ingests live streams from the standard IP cameras already installed at
              Border Out Posts, check posts and border roads, and runs AI video analytics on
              them in real time. No smart cameras, no proprietary FRS or ANPR appliances, no
              rewiring of remote posts.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/live"
                className="inline-flex items-center rounded-sm bg-primary px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-widest text-primary-foreground transition-opacity hover:opacity-90"
              >
                Start live analytics
              </Link>
              <Link
                to="/dashboard"
                className="inline-flex items-center rounded-sm border border-border px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-widest transition-colors hover:bg-secondary"
              >
                Open command grid
              </Link>
            </div>
            <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Cameras / node" value="16" hint="single edge laptop" />
              <Stat label="Alert latency" value="<300ms" hint="capture to console" />
              <Stat label="Extra hardware" value="0" hint="software defined" />
              <Stat label="Analytics" value="8" hint="run per stream" />
            </div>
          </div>

          <Panel title="Signal path" className="self-start">
            <ol className="space-y-3">
              {[
                ["01", "Camera / phone", "RTSP, ONVIF or WebRTC from any IP camera — a phone becomes a field camera instantly."],
                ["02", "Ingest gateway", "Node.js service normalises streams, drops stale frames to protect latency."],
                ["03", "Vision workers", "OpenCV + detection models score each frame: people, vehicles, plates, faces, motion."],
                ["04", "Rules engine", "Virtual fences, dwell timers and night profiles convert detections into alerts."],
                ["05", "Console & C2", "Operators triage on the grid; events push to existing command and control."],
              ].map(([n, t, d]) => (
                <li key={n} className="flex gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                  <span className="font-mono text-xs text-primary">{n}</span>
                  <div>
                    <p className="font-display text-base font-semibold">{t}</p>
                    <p className="text-sm text-muted-foreground">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </section>

        <section className="py-6">
          <h2 className="label-hud">Capabilities</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {CAPABILITIES.map((c) => (
              <article key={c.title} className="panel p-4">
                <h3 className="font-display text-lg font-semibold">{c.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{c.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-3 py-12 md:grid-cols-3">
          {[
            ["Cost effective", "Reuses installed cameras and one commodity GPU/CPU node per cluster of posts."],
            ["Scalable", "Add a camera by adding a stream URL; workers scale horizontally per sector."],
            ["Remote ready", "Runs offline at the post, syncing events upward when the link is available."],
          ].map(([t, d]) => (
            <div key={t} className="panel p-5">
              <h3 className="font-display text-xl font-semibold text-primary">{t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
