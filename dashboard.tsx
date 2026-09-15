import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Panel, SiteFooter, SiteHeader, Stat, Tag } from "@/components/hud";
import { beep } from "@/lib/beep";
import { CAMERAS, PLATE_POOL, SUSPICIOUS_MESSAGES } from "@/lib/ibvap-data";
import {
  KIND_LABEL,
  formatClock,
  severityClass,
  type AlertKind,
  type AlertSeverity,
  type AnalyticsAlert,
  type CameraNode,
} from "@/lib/ibvap-types";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Command Grid — IBVAP Border Surveillance Console" },
      {
        name: "description",
        content:
          "Multi-camera command grid with real-time alert feed, incident management log, export reports and a live Border Out Post deployment map.",
      },
      { property: "og:title", content: "IBVAP Command Grid" },
      {
        property: "og:description",
        content:
          "Monitor every BOP camera node, triage critical intrusions, dispatch force and export incident reports.",
      },
    ],
  }),
  component: Dashboard,
});

type IncidentStatus = "Under Review" | "Force Dispatched" | "Resolved";

const KIND_POOL: AlertKind[] = [
  "intrusion",
  "human",
  "vehicle",
  "anpr",
  "face",
  "loitering",
  "night-movement",
  "tamper",
];

const SEVERITY_BY_KIND: Record<AlertKind, AlertSeverity> = {
  intrusion: "critical",
  face: "critical",
  anpr: "high",
  human: "high",
  "night-movement": "high",
  vehicle: "medium",
  loitering: "medium",
  tamper: "low",
};

function messageFor(kind: AlertKind): string {
  switch (kind) {
    case "intrusion":
      return "Virtual fence breached — single entity moving inward";
    case "human":
      return "Human detected and tracked along the fence line";
    case "vehicle":
      return "Unlisted vehicle approaching the barrier lane";
    case "anpr":
      return `ANPR readout ${PLATE_POOL[Math.floor(Math.random() * PLATE_POOL.length)]} — no clearance on record`;
    case "face":
      return "Watchlist face match, score 0.88 — hold for verification";
    case "loitering":
      return SUSPICIOUS_MESSAGES[Math.floor(Math.random() * SUSPICIOUS_MESSAGES.length)]!;
    case "night-movement":
      return "Thermal-contrast movement in near-dark sector";
    default:
      return "Camera view obstruction / possible tamper";
  }
}

function Dashboard() {
  const [alerts, setAlerts] = useState<AnalyticsAlert[]>(() => seedAlerts());
  const [statuses, setStatuses] = useState<Record<string, IncidentStatus>>({});
  const [focus, setFocus] = useState<CameraNode>(CAMERAS[0]!);
  const [sevFilter, setSevFilter] = useState<AlertSeverity | "all">("all");
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | "all">("all");
  const [muted, setMuted] = useState(true);

  // live event stream
  useEffect(() => {
    const id = setInterval(() => {
      const online = CAMERAS.filter((c) => c.status !== "offline");
      const cam = online[Math.floor(Math.random() * online.length)]!;
      const kind =
        cam.analytics[Math.floor(Math.random() * cam.analytics.length)] ??
        KIND_POOL[Math.floor(Math.random() * KIND_POOL.length)]!;
      const severity = SEVERITY_BY_KIND[kind];
      const alert: AnalyticsAlert = {
        id: `${cam.id}-${Date.now()}`,
        kind,
        severity,
        camera: cam.id,
        sector: cam.sector,
        message: messageFor(kind),
        confidence: 0.62 + Math.random() * 0.35,
        timestamp: Date.now(),
      };
      setAlerts((prev) => [alert, ...prev].slice(0, 60));
      if (!muted && severity === "critical") beep("critical");
    }, 5200);
    return () => clearInterval(id);
  }, [muted]);

  const counts = useMemo(() => {
    const online = CAMERAS.filter((c) => c.status === "online").length;
    const critical = alerts.filter((a) => a.severity === "critical").length;
    const open = alerts.filter((a) => (statuses[a.id] ?? "Under Review") !== "Resolved").length;
    const avgLatency = Math.round(
      CAMERAS.filter((c) => c.status !== "offline").reduce((s, c) => s + c.latencyMs, 0) /
        CAMERAS.filter((c) => c.status !== "offline").length,
    );
    return { online, critical, open, avgLatency };
  }, [alerts, statuses]);

  const incidents = useMemo(
    () =>
      alerts.filter((a) => {
        const st = statuses[a.id] ?? "Under Review";
        return (
          (sevFilter === "all" || a.severity === sevFilter) &&
          (statusFilter === "all" || st === statusFilter)
        );
      }),
    [alerts, statuses, sevFilter, statusFilter],
  );

  const exportReport = () => {
    const rows = [
      ["incident_id", "time", "camera", "sector", "type", "severity", "status", "confidence", "detail"],
      ...incidents.map((a) => [
        a.id,
        new Date(a.timestamp).toISOString(),
        a.camera,
        a.sector,
        KIND_LABEL[a.kind],
        a.severity,
        statuses[a.id] ?? "Under Review",
        (a.confidence * 100).toFixed(0) + "%",
        a.message.replaceAll(",", ";"),
      ]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ibvap-incident-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Tag tone="primary">
              <span className="live-dot">●</span> Sector command · live
            </Tag>
            <h1 className="mt-3 font-display text-4xl font-bold">Command &amp; control grid</h1>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setMuted((m) => !m)}
              className="rounded-sm border border-border px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:bg-secondary"
            >
              {muted ? "Siren muted" : "Siren armed"}
            </button>
            <Link
              to="/live"
              className="rounded-sm bg-primary px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-widest text-primary-foreground"
            >
              Live analytics
            </Link>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Nodes online" value={`${counts.online}/${CAMERAS.length}`} hint="camera health" />
          <Stat label="Critical alerts" value={String(counts.critical)} hint="last 60 events" />
          <Stat label="Open incidents" value={String(counts.open)} hint="awaiting closure" />
          <Stat label="Avg latency" value={`${counts.avgLatency}ms`} hint="capture to console" />
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]">
          <div className="space-y-3">
            <Panel
              title={`Focus view · ${focus.id}`}
              right={<Tag tone={focus.status === "online" ? "primary" : focus.status === "degraded" ? "warning" : "danger"}>{focus.status}</Tag>}
            >
              <div className="relative overflow-hidden rounded-sm border border-border">
                <SimFeed camera={focus} height={340} detailed />
                <div className="pointer-events-none absolute inset-0 scanlines opacity-40" />
                <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[10px] text-primary/80">
                  {focus.name} · {focus.location} · {focus.fps} FPS · {focus.latencyMs} MS
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {focus.analytics.map((a) => (
                  <Tag key={a} tone="accent">
                    {KIND_LABEL[a]}
                  </Tag>
                ))}
                {focus.nightMode && <Tag tone="primary">IR night profile</Tag>}
              </div>
            </Panel>

            <Panel title="Camera grid · click to focus">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {CAMERAS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setFocus(c)}
                    className={`group overflow-hidden rounded-sm border text-left transition-colors ${
                      focus.id === c.id ? "border-primary/60" : "border-border hover:border-accent/50"
                    }`}
                  >
                    <div className="relative">
                      <SimFeed camera={c} height={104} />
                      <span className="absolute left-1.5 top-1.5 font-mono text-[9px] uppercase tracking-widest text-primary">
                        {c.id}
                      </span>
                      {c.status === "offline" && (
                        <span className="absolute inset-0 flex items-center justify-center bg-background/80 font-mono text-[10px] uppercase tracking-widest text-destructive">
                          signal lost
                        </span>
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="truncate font-display text-sm font-semibold">{c.name}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{c.sector}</p>
                    </div>
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title="BOP deployment map" right={<span className="label-hud">sector 1–6</span>}>
              <BopMap cameras={CAMERAS} focusId={focus.id} onSelect={setFocus} />
            </Panel>
          </div>

          <div className="space-y-3">
            <Panel title="Real-time alert feed">
              <div className="max-h-[24rem] space-y-2 overflow-y-auto pr-1">
                {alerts.slice(0, 24).map((a) => (
                  <article key={a.id} className={`rounded-sm border p-2 ${severityClass(a.severity)}`}>
                    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
                      <span>{a.severity}</span>
                      <span className="text-muted-foreground">{formatClock(a.timestamp)}</span>
                      <span className="ml-auto text-muted-foreground">{a.camera}</span>
                    </div>
                    <p className="font-display text-sm font-semibold text-foreground">
                      {KIND_LABEL[a.kind]}
                    </p>
                    <p className="text-xs text-muted-foreground">{a.message}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {a.sector} · conf {(a.confidence * 100).toFixed(0)}%
                    </p>
                  </article>
                ))}
              </div>
            </Panel>

            <Panel title="Node health">
              <ul className="space-y-2">
                {CAMERAS.map((c, i) => {
                  const battery = c.status === "offline" ? 0 : 42 + ((i * 13) % 55);
                  return (
                    <li key={c.id} className="font-mono text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{c.id}</span>
                        <span
                          className={
                            c.status === "online"
                              ? "text-primary"
                              : c.status === "degraded"
                                ? "text-warning"
                                : "text-destructive"
                          }
                        >
                          {battery}% · {c.latencyMs}ms
                        </span>
                      </div>
                      <div className="mt-1 h-1 w-full rounded-full bg-secondary">
                        <div
                          className={`h-1 rounded-full ${
                            battery > 50 ? "bg-primary" : battery > 20 ? "bg-warning" : "bg-destructive"
                          }`}
                          style={{ width: `${battery}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </div>
        </div>

        <Panel
          className="mt-3"
          title="Incident management log"
          right={
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={sevFilter}
                onChange={(e) => setSevFilter(e.target.value as AlertSeverity | "all")}
                className="rounded-sm border border-input bg-secondary px-2 py-1 font-mono text-[10px] uppercase tracking-widest"
              >
                {["all", "critical", "high", "medium", "low"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as IncidentStatus | "all")}
                className="rounded-sm border border-input bg-secondary px-2 py-1 font-mono text-[10px] uppercase tracking-widest"
              >
                {["all", "Under Review", "Force Dispatched", "Resolved"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                onClick={exportReport}
                className="rounded-sm bg-primary px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-primary-foreground"
              >
                Export report
              </button>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[54rem] text-left">
              <thead>
                <tr className="label-hud">
                  <th className="pb-2 pr-3">Time</th>
                  <th className="pb-2 pr-3">Camera / BOP</th>
                  <th className="pb-2 pr-3">Event</th>
                  <th className="pb-2 pr-3">Severity</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {incidents.slice(0, 20).map((a) => {
                  const st = statuses[a.id] ?? "Under Review";
                  return (
                    <tr key={a.id} className="border-t border-border align-top">
                      <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground">
                        {formatClock(a.timestamp)}
                      </td>
                      <td className="py-2 pr-3">
                        <p className="font-mono text-[11px]">{a.camera}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">{a.sector}</p>
                      </td>
                      <td className="py-2 pr-3">
                        <p className="text-sm">{KIND_LABEL[a.kind]}</p>
                        <p className="text-xs text-muted-foreground">{a.message}</p>
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase ${severityClass(a.severity)}`}
                        >
                          {a.severity}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono text-[11px]">{st}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {(["Under Review", "Force Dispatched", "Resolved"] as IncidentStatus[]).map(
                            (s) => (
                              <button
                                key={s}
                                onClick={() => setStatuses((prev) => ({ ...prev, [a.id]: s }))}
                                className={`rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${
                                  st === s
                                    ? "border-primary/60 bg-primary/15 text-primary"
                                    : "border-border text-muted-foreground hover:bg-secondary"
                                }`}
                              >
                                {s === "Under Review" ? "Review" : s === "Force Dispatched" ? "Dispatch" : "Resolve"}
                              </button>
                            ),
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {incidents.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 font-mono text-xs text-muted-foreground">
                      No incidents match the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </main>
      <SiteFooter />
    </div>
  );
}

function seedAlerts(): AnalyticsAlert[] {
  const base = Date.now();
  return KIND_POOL.map((kind, i) => {
    const cam = CAMERAS[i % CAMERAS.length]!;
    return {
      id: `seed-${kind}-${i}`,
      kind,
      severity: SEVERITY_BY_KIND[kind],
      camera: cam.id,
      sector: cam.sector,
      message: messageFor(kind),
      confidence: 0.68 + (i % 4) * 0.07,
      timestamp: base - (i + 1) * 47000,
    };
  });
}

/** Lightweight animated stand-in for a decoded camera stream. */
function SimFeed({
  camera,
  height,
  detailed = false,
}: {
  camera: CameraNode;
  height: number;
  detailed?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let t = Math.random() * 400;
    let alive = true;
    const seed = camera.id.length * 37;

    const tick = () => {
      if (!alive) return;
      const w = canvas.width;
      const h = canvas.height;
      if (camera.status === "offline") {
        ctx.fillStyle = "#0f151d";
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 400; i++) {
          ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`;
          ctx.fillRect(Math.random() * w, Math.random() * h, 2, 1);
        }
        setTimeout(tick, 120);
        return;
      }
      t += camera.status === "degraded" ? 0.7 : 1.6;

      const g = ctx.createLinearGradient(0, 0, 0, h);
      if (camera.nightMode) {
        g.addColorStop(0, "#0d1a14");
        g.addColorStop(1, "#16281d");
      } else {
        g.addColorStop(0, "#16202c");
        g.addColorStop(1, "#2a3340");
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = camera.nightMode ? "#0a130d" : "#131a22";
      ctx.beginPath();
      ctx.moveTo(0, h * 0.45);
      for (let x = 0; x <= w; x += 20) {
        ctx.lineTo(x, h * 0.45 - Math.sin((x + seed) / 60) * (h * 0.05));
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = camera.nightMode ? "#1f3a2a" : "#3c4756";
      ctx.lineWidth = Math.max(2, h * 0.05);
      ctx.beginPath();
      ctx.moveTo(-10, h * 0.82);
      ctx.lineTo(w + 10, h * 0.66);
      ctx.stroke();

      // moving targets + detection boxes
      const targets: { x: number; y: number; w: number; h: number; label: string }[] = [];
      if (camera.analytics.includes("human") || camera.analytics.includes("intrusion")) {
        const x = (t * 1.4 + seed) % (w + 60) - 30;
        const bh = h * 0.3;
        targets.push({ x, y: h * 0.55, w: bh * 0.4, h: bh, label: "PERSON" });
      }
      if (camera.analytics.includes("vehicle")) {
        const x = w - ((t * 2.1 + seed) % (w + 200));
        targets.push({ x, y: h * 0.6, w: w * 0.22, h: h * 0.16, label: "VEHICLE" });
      }

      for (const tg of targets) {
        ctx.fillStyle = "#0b1016";
        ctx.fillRect(tg.x, tg.y, tg.w, tg.h);
        ctx.strokeStyle = tg.label === "PERSON" ? "#7ee7a4" : "#6fc4f5";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(tg.x - 3, tg.y - 4, tg.w + 6, tg.h + 8);
        if (detailed) {
          ctx.fillStyle = ctx.strokeStyle;
          ctx.font = "10px 'IBM Plex Mono', monospace";
          ctx.fillText(`${tg.label} 0.9${Math.floor(Math.random() * 9)}`, tg.x - 3, tg.y - 8);
        }
      }

      // fence line
      ctx.strokeStyle = "#f2c14b";
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(w * 0.05, h * 0.74);
      ctx.lineTo(w * 0.95, h * 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      setTimeout(tick, camera.status === "degraded" ? 90 : 55);
    };
    tick();
    return () => {
      alive = false;
    };
  }, [camera, detailed]);

  return (
    <canvas
      ref={ref}
      width={detailed ? 900 : 320}
      height={detailed ? Math.round(900 * 0.5) : 104}
      className="block w-full"
      style={{ height: `${height}px`, objectFit: "cover" }}
    />
  );
}

function BopMap({
  cameras,
  focusId,
  onSelect,
}: {
  cameras: CameraNode[];
  focusId: string;
  onSelect: (c: CameraNode) => void;
}) {
  const pos = [
    { x: 90, y: 70 },
    { x: 240, y: 130 },
    { x: 400, y: 90 },
    { x: 545, y: 160 },
    { x: 690, y: 100 },
    { x: 330, y: 220 },
  ];
  return (
    <svg viewBox="0 0 780 280" className="w-full">
      <defs>
        <linearGradient id="terrain" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.25 0.03 200)" />
          <stop offset="100%" stopColor="oklch(0.2 0.02 250)" />
        </linearGradient>
      </defs>
      <rect width="780" height="280" fill="url(#terrain)" rx="6" />
      {Array.from({ length: 13 }).map((_, i) => (
        <line key={i} x1={i * 60} y1="0" x2={i * 60} y2="280" stroke="oklch(1 0 0 / 5%)" />
      ))}
      <path
        d="M10 210 C 140 140, 260 260, 390 180 S 640 90, 770 140"
        fill="none"
        stroke="oklch(0.79 0.16 78 / 60%)"
        strokeWidth="2.5"
        strokeDasharray="10 7"
      />
      <text x="16" y="26" className="font-mono" fontSize="11" fill="oklch(0.79 0.16 78 / 80%)">
        INTERNATIONAL BORDER — VIRTUAL FENCE ACTIVE
      </text>
      {cameras.map((c, i) => {
        const p = pos[i]!;
        const color =
          c.status === "online"
            ? "oklch(0.79 0.18 148)"
            : c.status === "degraded"
              ? "oklch(0.79 0.16 78)"
              : "oklch(0.62 0.23 21)";
        return (
          <g key={c.id} onClick={() => onSelect(c)} style={{ cursor: "pointer" }}>
            {focusId === c.id && (
              <circle cx={p.x} cy={p.y} r="20" fill="none" stroke={color} strokeWidth="1" opacity="0.7" />
            )}
            <circle cx={p.x} cy={p.y} r="7" fill={color} opacity={c.status === "offline" ? 0.5 : 1} />
            <circle cx={p.x} cy={p.y} r="13" fill="none" stroke={color} strokeWidth="1" opacity="0.4" />
            <text x={p.x + 16} y={p.y - 2} fontSize="11" fill="oklch(0.95 0.008 240)" className="font-mono">
              {c.id}
            </text>
            <text x={p.x + 16} y={p.y + 11} fontSize="9.5" fill="oklch(0.69 0.022 245)" className="font-mono">
              {c.sector}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
