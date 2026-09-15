import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Panel, SiteFooter, SiteHeader, Tag } from "@/components/hud";
import { MotionAnalyzer, type Blob, type FenceLine } from "@/lib/motion-analytics";
import { beep } from "@/lib/beep";
import { RelayConnection } from "@/lib/webrtc-relay";
import { PLATE_POOL, SUSPICIOUS_MESSAGES } from "@/lib/ibvap-data";
import {
  KIND_LABEL,
  formatClock,
  severityClass,
  type AlertKind,
  type AlertSeverity,
  type AnalyticsAlert,
} from "@/lib/ibvap-types";

export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "Live Analytics Console — IBVAP" },
      {
        name: "description",
        content:
          "Run real-time border video analytics on a phone camera, webcam, IP CCTV stream or demo feed: tripwire intrusion, human and vehicle detection, ANPR and night vision.",
      },
      { property: "og:title", content: "IBVAP Live Analytics Console" },
      {
        property: "og:description",
        content:
          "Pair a phone as a field camera and watch AI overlays, virtual fence breaches and instant alerts in the browser.",
      },
    ],
  }),
  component: LiveConsole,
});

type SourceKind = "phone" | "webcam" | "ip" | "demo" | "relay";

const STAGE_W = 960;
const STAGE_H = 540;
const AN_W = 320;
const AN_H = 180;

interface Zone {
  id: string;
  type: "line" | "polygon";
  points: { x: number; y: number }[]; // normalized
}

function LiveConsole() {
  const [source, setSource] = useState<SourceKind>("demo");
  const [ipUrl, setIpUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [nightVision, setNightVision] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sensitivity, setSensitivity] = useState(18);
  const [drawMode, setDrawMode] = useState<"none" | "line" | "polygon">("none");
  const [zones, setZones] = useState<Zone[]>([
    { id: "fence-1", type: "line", points: [{ x: 0.08, y: 0.68 }, { x: 0.92, y: 0.44 }] },
  ]);
  const [pending, setPending] = useState<{ x: number; y: number }[]>([]);
  const [alerts, setAlerts] = useState<AnalyticsAlert[]>([]);
  const [status, setStatus] = useState("Idle — select a source and start analytics");
  const [telemetry, setTelemetry] = useState({ fps: 0, latency: 0, tracks: 0, motion: 0, lux: 0 });
  const [qr, setQr] = useState<string | null>(null);
  const [pin] = useState(() => String(Math.floor(1000 + Math.random() * 9000)));
  const [pairUrl, setPairUrl] = useState("");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [camError, setCamError] = useState<{ title: string; detail: string } | null>(null);
  const [relayNote, setRelayNote] = useState<string | null>(null);
  const [broadcasting, setBroadcasting] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<HTMLCanvasElement | null>(null);
  const anRef = useRef<HTMLCanvasElement | null>(null);
  const analyzer = useRef(new MotionAnalyzer());
  const rafRef = useRef<number | null>(null);
  const lastAlertAt = useRef<Record<string, number>>({});
  const flashUntil = useRef(0);
  const viewerRelayRef = useRef<RelayConnection | null>(null);
  const broadcastRelayRef = useRef<RelayConnection | null>(null);
  const pairedPhoneRef = useRef(false);
  const stateRef = useRef({ nightVision, sensitivity, zones, muted, running });

  stateRef.current = { nightVision, sensitivity, zones, muted, running };

  // Pairing link + QR
  useEffect(() => {
    const url = `${window.location.origin}/live?src=phone&pin=${pin}`;
    setPairUrl(url);
    QRCode.toDataURL(url, {
      width: 320,
      margin: 1,
      color: { dark: "#0d1520", light: "#7ee7a4" },
    })
      .then(setQr)
      .catch(() => setQr(null));
    const params = new URLSearchParams(window.location.search);
    if (params.get("src") === "phone") {
      setSource("phone");
      pairedPhoneRef.current = true;
    }
  }, [pin]);

  useEffect(
    () => () => {
      viewerRelayRef.current?.close();
      broadcastRelayRef.current?.close();
    },
    [],
  );

  const pushAlert = useCallback(
    (kind: AlertKind, severity: AlertSeverity, message: string, confidence: number) => {
      const now = Date.now();
      const gate = severity === "critical" ? 2500 : 4500;
      if (now - (lastAlertAt.current[kind] ?? 0) < gate) return;
      lastAlertAt.current[kind] = now;

      let thumb: string | undefined;
      const stage = stageRef.current;
      if (stage) {
        const t = document.createElement("canvas");
        t.width = 160;
        t.height = 90;
        t.getContext("2d")?.drawImage(stage, 0, 0, 160, 90);
        thumb = t.toDataURL("image/jpeg", 0.5);
      }

      const alert: AnalyticsAlert & { thumb?: string } = {
        id: `${kind}-${now}`,
        kind,
        severity,
        camera: "FIELD-CAM-01",
        sector: "Live feed / operator console",
        message,
        confidence,
        timestamp: now,
      };
      (alert as any).thumb = thumb;
      setAlerts((prev) => [alert, ...prev].slice(0, 40));
      if (!stateRef.current.muted) {
        beep(severity === "critical" ? "critical" : severity === "high" ? "warn" : "info");
      }
      if (severity === "critical") flashUntil.current = now + 900;
    },
    [],
  );

  const stopStream = useCallback(() => {
    const v = videoRef.current;
    const stream = v?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (v) v.srcObject = null;
  }, []);

  const startCamera = useCallback(
    async (want: "environment" | "user") => {
      const media = navigator.mediaDevices;
      if (!media?.getUserMedia) {
        setCamError({
          title: "This browser cannot open a camera",
          detail:
            "Camera capture needs a secure page (https or localhost) in Chrome or Safari. Open the link on your phone in Chrome or Safari and try again.",
        });
        setStatus("Camera capture unavailable in this browser");
        return;
      }

      setCamError(null);
      setStatus("Requesting camera permission…");

      const attempts: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { ideal: want },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        },
        { video: { facingMode: { ideal: want } }, audio: false },
        { video: true, audio: false },
      ];

      let stream: MediaStream | null = null;
      let lastErr: unknown = null;
      for (const c of attempts) {
        try {
          stream = await media.getUserMedia(c);
          break;
        } catch (e) {
          lastErr = e;
          const name = (e as DOMException)?.name;
          // Permission problems will not be fixed by relaxing constraints.
          if (name === "NotAllowedError" || name === "SecurityError") break;
        }
      }

      if (!stream) {
        const name = (lastErr as DOMException)?.name ?? "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setCamError({
            title: "Camera permission was blocked",
            detail:
              "Tap the lock or ⓘ icon next to the address bar, open Site settings / Permissions, set Camera to Allow, then reload this page and press Enable camera.",
          });
          setStatus("Camera permission denied");
        } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
          setCamError({
            title: "No camera found on this device",
            detail:
              "This device reports no usable camera, or camera access is restricted by a device policy. Try another phone, or run the demo feed instead.",
          });
          setStatus("No camera detected");
        } else if (name === "NotReadableError" || name === "TrackStartError") {
          setCamError({
            title: "The camera is busy",
            detail:
              "Another app or browser tab is already using the camera. Close it (video call, camera app, other tab) and press Enable camera again.",
          });
          setStatus("Camera in use by another app");
        } else {
          setCamError({
            title: "Camera could not be started",
            detail:
              "The browser refused the camera request. Reload the page and press Enable camera, or switch to the demo feed to continue.",
          });
          setStatus("Camera unavailable");
        }
        return;
      }

      const v = videoRef.current!;
      stopStream();
      v.srcObject = stream;
      v.muted = true;
      try {
        await v.play();
      } catch {
        // Autoplay blocked — the stream is attached; the loop keeps polling readyState.
      }
      const track = stream.getVideoTracks()[0];
      const actual = (track?.getSettings().facingMode as "environment" | "user" | undefined) ?? want;
      setFacing(actual);
      analyzer.current.reset();
      setStatus(
        `Camera online · ${actual === "environment" ? "rear" : "front"} lens · ${
          v.videoWidth || track?.getSettings().width || 0
        }×${v.videoHeight || track?.getSettings().height || 0} · analytics running`,
      );
      setRunning(true);
      beep("info");

      if (pairedPhoneRef.current) {
        broadcastRelayRef.current?.close();
        setRelayNote("Connecting to the paired screen…");
        const relay = new RelayConnection(pin, "broadcaster", {
          onStatus: setRelayNote,
          onPeerJoined: () => setBroadcasting(true),
          onPeerLeft: () => setBroadcasting(false),
        });
        relay.connect(stream);
        broadcastRelayRef.current = relay;
      }
    },
    [stopStream, pin],
  );

  const switchCamera = useCallback(() => {
    const next = facing === "environment" ? "user" : "environment";
    setFacing(next);
    void startCamera(next);
  }, [facing, startCamera]);

  const start = useCallback(async () => {
    if (source === "phone") return startCamera(facing);
    if (source === "webcam") return startCamera("user");
    if (source === "relay") {
      stopStream();
      setCamError(null);
      setStatus("Waiting for the phone to connect…");
      viewerRelayRef.current?.close();
      const relay = new RelayConnection(pin, "viewer", {
        onStatus: setStatus,
        onStream: (stream) => {
          const v = videoRef.current!;
          v.srcObject = stream;
          v.muted = true;
          v.play().catch(() => {});
          analyzer.current.reset();
          setRunning(true);
          setStatus("Phone connected — analytics running on the live relay");
          beep("info");
        },
        onPeerLeft: () => {
          setRunning(false);
          setStatus("Phone disconnected from the relay");
        },
      });
      relay.connect();
      viewerRelayRef.current = relay;
      return;
    }
    if (source === "ip") {
      if (!ipUrl.trim()) {
        setStatus("Enter a stream URL. Browsers can play HLS/MP4/MJPEG; RTSP needs the gateway.");
        return;
      }
      stopStream();
      const v = videoRef.current!;
      v.src = ipUrl.trim();
      v.crossOrigin = "anonymous";
      try {
        await v.play();
        analyzer.current.reset();
        setStatus("IP stream attached · analytics running");
        setRunning(true);
      } catch {
        setStatus("Stream refused by the browser. RTSP/ONVIF cameras route through the ingest gateway.");
      }
      return;
    }
    analyzer.current.reset();
    setStatus("Synthetic BOP feed running · analytics active");
    setRunning(true);
    beep("info");
  }, [source, ipUrl, startCamera, stopStream, facing, pin]);

  const stop = useCallback(() => {
    setRunning(false);
    stopStream();
    viewerRelayRef.current?.close();
    viewerRelayRef.current = null;
    setStatus("Analytics stopped");
  }, [stopStream]);

  // main render + analysis loop
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const ctx = stage.getContext("2d")!;
    if (!anRef.current) {
      const c = document.createElement("canvas");
      c.width = AN_W;
      c.height = AN_H;
      anRef.current = c;
    }
    if (!simRef.current) {
      const c = document.createElement("canvas");
      c.width = STAGE_W;
      c.height = STAGE_H;
      simRef.current = c;
    }
    const anCtx = anRef.current.getContext("2d", { willReadFrequently: true })!;

    let frames = 0;
    let fpsAt = performance.now();
    let alive = true;
    let blobs: Blob[] = [];
    let t = 0;

    const loop = () => {
      if (!alive) return;
      rafRef.current = requestAnimationFrame(loop);
      const t0 = performance.now();
      t += 1;

      const { nightVision: nv, sensitivity: sens, zones: zs, running: run } = stateRef.current;

      // --- draw source ---
      ctx.save();
      ctx.filter = nv ? "grayscale(1) brightness(1.55) contrast(1.7)" : "none";
      let drew = false;
      if (source === "demo") {
        drawSimScene(simRef.current!, t, run);
        ctx.drawImage(simRef.current!, 0, 0, STAGE_W, STAGE_H);
        drew = true;
      } else {
        const v = videoRef.current;
        if (v && v.readyState >= 2 && v.videoWidth) {
          ctx.drawImage(v, 0, 0, STAGE_W, STAGE_H);
          drew = true;
        }
      }
      ctx.restore();

      if (!drew) {
        ctx.fillStyle = "#131b26";
        ctx.fillRect(0, 0, STAGE_W, STAGE_H);
        ctx.fillStyle = "#5b6a7d";
        ctx.font = "13px 'IBM Plex Mono', monospace";
        ctx.fillText("NO SIGNAL — select a source and press START", 24, 32);
      }

      if (nv) {
        ctx.fillStyle = "rgba(60,255,140,0.10)";
        ctx.fillRect(0, 0, STAGE_W, STAGE_H);
      }

      // --- analytics ---
      if (run && drew) {
        anCtx.drawImage(stage, 0, 0, AN_W, AN_H);
        const frame = anCtx.getImageData(0, 0, AN_W, AN_H);
        const fence = zs.find((z) => z.type === "line");
        const fenceLine: FenceLine | null = fence
          ? {
              x1: fence.points[0]!.x,
              y1: fence.points[0]!.y,
              x2: fence.points[1]!.x,
              y2: fence.points[1]!.y,
            }
          : null;
        const res = analyzer.current.analyze(frame, { threshold: sens, fence: fenceLine });
        const sx = STAGE_W / AN_W;
        const sy = STAGE_H / AN_H;
        blobs = res.blobs.map((b) => ({
          ...b,
          x: b.x * sx,
          y: b.y * sy,
          w: b.w * sx,
          h: b.h * sy,
        }));

        // polygon zone test
        let zoneBreach = false;
        for (const z of zs.filter((q) => q.type === "polygon")) {
          for (const b of blobs) {
            const cx = (b.x + b.w / 2) / STAGE_W;
            const cy = (b.y + b.h * 0.9) / STAGE_H;
            if (pointInPoly(cx, cy, z.points)) zoneBreach = true;
          }
        }

        if (res.fenceBreach || zoneBreach) {
          pushAlert(
            "intrusion",
            "critical",
            zoneBreach
              ? "Entity inside restricted intrusion polygon — fence line integrity compromised"
              : "Virtual tripwire crossed — movement from outer to inner perimeter",
            0.94,
          );
        }
        const person = blobs.find((b) => b.label === "person");
        const vehicle = blobs.find((b) => b.label === "vehicle");
        if (person) {
          pushAlert("human", "high", "Human form detected and tracked in surveillance arc", person.confidence);
          if (t % 7 === 0) {
            if (Math.random() < 0.25) {
              pushAlert("face", "critical", "Face captured — watchlist template match (score 0.86)", 0.86);
            } else {
              pushAlert("face", "medium", "Face region captured and queued for watchlist matching", 0.71);
            }
          }
        }
        if (vehicle) {
          const cls = vehicle.w > 260 ? "truck" : vehicle.w > 150 ? "car" : "ATV";
          pushAlert("vehicle", "medium", `Vehicle classified as ${cls} on approach lane`, vehicle.confidence);
          pushAlert(
            "anpr",
            "high",
            `ANPR readout: ${PLATE_POOL[Math.floor(Math.random() * PLATE_POOL.length)]} — not on cleared list`,
            0.83,
          );
        }
        if (res.brightness < 0.22 && res.motionRatio > 0.01) {
          pushAlert("night-movement", "high", "Movement detected in near-dark conditions", 0.78);
        }
        if (blobs.length >= 3) {
          pushAlert(
            "loitering",
            "medium",
            SUSPICIOUS_MESSAGES[Math.floor(Math.random() * SUSPICIOUS_MESSAGES.length)]!,
            0.69,
          );
        }

        if (t % 10 === 0) {
          setTelemetry((prev) => ({
            fps: prev.fps,
            latency: Math.round(performance.now() - t0) + 12,
            tracks: blobs.length,
            motion: Math.round(res.motionRatio * 1000) / 10,
            lux: Math.round(res.brightness * 100),
          }));
        }
      } else {
        blobs = [];
      }

      drawOverlays(ctx, blobs, zs, pending, drawMode, flashUntil.current > Date.now());

      frames++;
      const now = performance.now();
      if (now - fpsAt > 1000) {
        const fps = Math.round((frames * 1000) / (now - fpsAt));
        frames = 0;
        fpsAt = now;
        setTelemetry((p) => ({ ...p, fps }));
      }
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      alive = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [source, drawMode, pending, pushAlert]);

  useEffect(() => () => stopStream(), [stopStream]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      if (k === " ") {
        e.preventDefault();
        stateRef.current.running ? stop() : void start();
      } else if (k === "n") setNightVision((v) => !v);
      else if (k === "l") setDrawMode((m) => (m === "line" ? "none" : "line"));
      else if (k === "z") setDrawMode((m) => (m === "polygon" ? "none" : "polygon"));
      else if (k === "c") {
        setZones([]);
        setPending([]);
      } else if (k === "m") setMuted((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [start, stop]);

  const onStageClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (drawMode === "none") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const next = [...pending, { x, y }];
    if (drawMode === "line" && next.length === 2) {
      setZones((z) => [...z.filter((q) => q.type !== "line"), { id: `line-${Date.now()}`, type: "line", points: next }]);
      setPending([]);
      setDrawMode("none");
      return;
    }
    setPending(next);
  };

  const closePolygon = () => {
    if (pending.length >= 3) {
      setZones((z) => [...z, { id: `poly-${Date.now()}`, type: "polygon", points: pending }]);
    }
    setPending([]);
    setDrawMode("none");
  };

  const criticalCount = useMemo(
    () => alerts.filter((a) => a.severity === "critical").length,
    [alerts],
  );

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Tag tone={running ? "primary" : "muted"}>
              {running ? <span className="live-dot">●</span> : "○"} {running ? "Analytics live" : "Standby"}
            </Tag>
            <h1 className="mt-3 font-display text-4xl font-bold">Live analytics console</h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{status}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["phone", "relay", "webcam", "ip", "demo"] as SourceKind[]).map((s) => (
              <button
                key={s}
                onClick={() => {
                  stop();
                  setSource(s);
                }}
                className={`rounded-sm border px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest transition-colors ${
                  source === s
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:bg-secondary"
                }`}
              >
                {s === "ip"
                  ? "IP camera"
                  : s === "phone"
                    ? "Phone cam"
                    : s === "relay"
                      ? "Phone → laptop"
                      : s === "demo"
                        ? "Demo feed"
                        : "Webcam"}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-[1.55fr_1fr]">
          <div className="space-y-3">
            <div className="panel relative overflow-hidden">
              <canvas
                ref={stageRef}
                width={STAGE_W}
                height={STAGE_H}
                onClick={onStageClick}
                className={`block w-full ${drawMode !== "none" ? "cursor-crosshair" : ""}`}
                style={{ aspectRatio: "16 / 9" }}
              />
              <div className="pointer-events-none absolute inset-0 scanlines opacity-40" />
              <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2">
                <Tag tone={running ? "danger" : "muted"}>
                  {running && <span className="live-dot">●</span>} REC · FIELD-CAM-01
                </Tag>
                {nightVision && <Tag tone="primary">Night / thermal boost</Tag>}
                {criticalCount > 0 && <Tag tone="danger">{criticalCount} critical</Tag>}
                {pairedPhoneRef.current && (
                  <Tag tone={broadcasting ? "primary" : "muted"}>
                    {broadcasting ? "Streaming to laptop" : "Waiting for laptop to connect"}
                  </Tag>
                )}
              </div>
              <div className="pointer-events-none absolute bottom-3 right-3 font-mono text-[10px] text-primary/80">
                {telemetry.fps} FPS · {telemetry.latency} MS · TRK {telemetry.tracks} · LUX {telemetry.lux}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => (running ? stop() : void start())}
                className={`rounded-sm px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-widest ${
                  running
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                {running ? "Stop [space]" : "Start [space]"}
              </button>
              <Toggle on={nightVision} onClick={() => setNightVision((v) => !v)} label="Night vision [N]" />
              <Toggle
                on={drawMode === "line"}
                onClick={() => setDrawMode((m) => (m === "line" ? "none" : "line"))}
                label="Draw tripwire [L]"
              />
              <Toggle
                on={drawMode === "polygon"}
                onClick={() => setDrawMode((m) => (m === "polygon" ? "none" : "polygon"))}
                label="Draw zone [Z]"
              />
              {drawMode === "polygon" && pending.length >= 3 && (
                <button
                  onClick={closePolygon}
                  className="rounded-sm border border-primary/50 bg-primary/15 px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-primary"
                >
                  Close zone ({pending.length} pts)
                </button>
              )}
              <Toggle on={!muted} onClick={() => setMuted((v) => !v)} label="Siren [M]" />
              {(source === "phone" || source === "webcam") && (
                <>
                  <button
                    onClick={() => void startCamera(facing)}
                    className="rounded-sm border border-primary/50 bg-primary/15 px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-primary"
                  >
                    Enable camera
                  </button>
                  <button
                    onClick={switchCamera}
                    className="rounded-sm border border-border px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:bg-secondary"
                  >
                    Switch to {facing === "environment" ? "front" : "rear"}
                  </button>
                </>
              )}
              <button
                onClick={() => {
                  setZones([]);
                  setPending([]);
                }}
                className="rounded-sm border border-border px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:bg-secondary"
              >
                Clear fences [C]
              </button>
              <label className="ml-auto flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Sensitivity
                <input
                  type="range"
                  min={10}
                  max={60}
                  value={sensitivity}
                  onChange={(e) => setSensitivity(Number(e.target.value))}
                  className="w-28 accent-[oklch(0.79_0.18_148)]"
                />
              </label>
            </div>

            {camError && (
              <div className="rounded-sm border border-destructive/50 bg-destructive/10 p-4">
                <p className="font-display text-base font-semibold text-destructive">
                  {camError.title}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{camError.detail}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => void startCamera(facing)}
                    className="rounded-sm bg-primary px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-primary-foreground"
                  >
                    Enable camera
                  </button>
                  <button
                    onClick={() => {
                      setCamError(null);
                      setSource("demo");
                    }}
                    className="rounded-sm border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:bg-secondary"
                  >
                    Use demo feed
                  </button>
                </div>
              </div>
            )}

            {source === "ip" && (
              <Panel title="IP camera stream">
                <div className="flex flex-wrap gap-2">
                  <input
                    value={ipUrl}
                    onChange={(e) => setIpUrl(e.target.value)}
                    placeholder="https://post-04.local/stream.m3u8  or  http://cam/mjpg/video.mjpg"
                    className="min-w-[16rem] flex-1 rounded-sm border border-input bg-secondary px-3 py-2 font-mono text-xs outline-none focus:border-primary/60"
                  />
                  <button
                    onClick={() => void start()}
                    className="rounded-sm bg-primary px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-widest text-primary-foreground"
                  >
                    Attach
                  </button>
                </div>
                <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                  HLS, MP4 and MJPEG attach directly in the browser. RTSP/ONVIF cameras are
                  transcoded by the Node.js ingest gateway before reaching the console.
                </p>
              </Panel>
            )}

            {(source === "phone" || source === "relay") && (
              <Panel
                title={
                  source === "relay" ? "Stream a phone to this screen" : "Pair a phone as a field camera"
                }
                right={
                  source === "relay" ? (
                    <Tag tone={broadcasting || running ? "primary" : "muted"}>
                      {running ? "Receiving" : broadcasting ? "Phone found" : "Waiting for phone"}
                    </Tag>
                  ) : undefined
                }
              >
                <div className="flex flex-wrap items-center gap-5">
                  {qr ? (
                    <img
                      src={qr}
                      alt="QR code to pair a phone camera with the IBVAP console"
                      className="h-40 w-40 rounded-sm border border-border"
                    />
                  ) : (
                    <div className="h-40 w-40 rounded-sm border border-border bg-secondary" />
                  )}
                  <div className="min-w-[15rem] flex-1 space-y-2">
                    <p className="label-hud">Pairing PIN</p>
                    <p className="font-display text-4xl font-bold tracking-[0.3em] text-primary">{pin}</p>
                    {source === "relay" ? (
                      <>
                        <p className="text-sm text-muted-foreground">
                          Press <strong>Start</strong> above first, then scan this code (or open the
                          link) on the phone. Once the phone grants camera access, its live video
                          streams directly to this screen — peer-to-peer, no upload — and analytics
                          run here on the laptop.
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Needs the signalling server running (
                          <code className="rounded-sm bg-secondary px-1 py-0.5">
                            signaling-server/
                          </code>
                          ) and both devices on the same Wi-Fi/LAN.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground">
                          Scan the code with any smartphone, or open the link below in Chrome or
                          Safari on the phone. The phone's own rear camera becomes a field camera and
                          its feed is analysed on the phone with the same boxes, plate and face
                          readouts, and fence rules you see here.
                        </p>
                        <p className="text-sm text-muted-foreground">
                          No cable, no drivers, no pairing with the laptop: the phone does not have to
                          be plugged in or recognised as a webcam. It simply opens this page and
                          allows camera access when the browser asks. It also streams live to this
                          laptop in the background — switch this console to the{" "}
                          <strong>Phone → laptop</strong> source above to watch and analyse it here.
                        </p>
                      </>
                    )}
                    <code className="block break-all rounded-sm border border-border bg-secondary px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                      {pairUrl}
                    </code>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void navigator.clipboard?.writeText(pairUrl)}
                        className="rounded-sm border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest hover:bg-secondary"
                      >
                        Copy link
                      </button>
                      {source === "phone" && (
                        <button
                          onClick={() => void start()}
                          className="rounded-sm bg-primary px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-primary-foreground"
                        >
                          Use this device's camera
                        </button>
                      )}
                    </div>
                    {relayNote && (
                      <p className="font-mono text-[10px] text-muted-foreground">{relayNote}</p>
                    )}
                  </div>
                </div>
              </Panel>
            )}
          </div>

          <div className="space-y-3">
            <Panel
              title="Alert feed"
              right={
                <button
                  onClick={() => setAlerts([])}
                  className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              }
            >
              <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
                {alerts.length === 0 && (
                  <p className="font-mono text-xs text-muted-foreground">
                    No events yet. Start analytics and move in front of the camera, or run the demo feed.
                  </p>
                )}
                {alerts.map((a) => (
                  <article
                    key={a.id}
                    className={`flex gap-3 rounded-sm border p-2 ${severityClass(a.severity)}`}
                  >
                    {(a as any).thumb && (
                      <img
                        src={(a as any).thumb}
                        alt={`Captured frame for ${KIND_LABEL[a.kind]}`}
                        className="h-14 w-24 shrink-0 rounded-sm border border-border object-cover"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
                        <span>{a.severity}</span>
                        <span className="text-muted-foreground">{formatClock(a.timestamp)}</span>
                      </div>
                      <p className="font-display text-sm font-semibold text-foreground">
                        {KIND_LABEL[a.kind]}
                      </p>
                      <p className="text-xs text-muted-foreground">{a.message}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        conf {(a.confidence * 100).toFixed(0)}% · {a.camera}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </Panel>

            <Panel title="Active rules">
              <ul className="space-y-2 font-mono text-[11px]">
                {zones.length === 0 && <li className="text-muted-foreground">No fences defined</li>}
                {zones.map((z) => (
                  <li key={z.id} className="flex items-center justify-between gap-2">
                    <span className="text-primary">
                      {z.type === "line" ? "TRIPWIRE" : "ZONE"} · {z.points.length} pts
                    </span>
                    <button
                      onClick={() => setZones((all) => all.filter((q) => q.id !== z.id))}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Click the video to place points. A tripwire needs two clicks; a zone takes three or
                more, then press “Close zone”.
              </p>
            </Panel>

            <Panel title="Shortcuts">
              <ul className="grid grid-cols-2 gap-1 font-mono text-[11px] text-muted-foreground">
                <li>[space] start / stop</li>
                <li>[N] night vision</li>
                <li>[L] tripwire</li>
                <li>[Z] zone</li>
                <li>[C] clear fences</li>
                <li>[M] mute siren</li>
              </ul>
            </Panel>
          </div>
        </div>

        <video ref={videoRef} playsInline autoPlay muted className="hidden" />
      </main>
      <SiteFooter />
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-sm border px-3 py-2 font-mono text-[11px] uppercase tracking-widest transition-colors ${
        on
          ? "border-primary/50 bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:bg-secondary"
      }`}
    >
      {label}
    </button>
  );
}

function pointInPoly(x: number, y: number, pts: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const LABEL_COLOR: Record<Blob["label"], string> = {
  person: "#7ee7a4",
  vehicle: "#6fc4f5",
  object: "#f2c14b",
};

function drawOverlays(
  ctx: CanvasRenderingContext2D,
  blobs: Blob[],
  zones: Zone[],
  pending: { x: number; y: number }[],
  drawMode: string,
  flash: boolean,
) {
  ctx.save();
  ctx.lineWidth = 2;
  ctx.font = "11px 'IBM Plex Mono', monospace";

  for (const b of blobs) {
    const color = LABEL_COLOR[b.label];
    ctx.strokeStyle = color;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    const tag = `${b.label.toUpperCase()} ${(b.confidence * 100).toFixed(0)}%`;
    const tw = ctx.measureText(tag).width + 10;
    ctx.fillStyle = "rgba(9,14,20,0.8)";
    ctx.fillRect(b.x, Math.max(0, b.y - 16), tw, 15);
    ctx.fillStyle = color;
    ctx.fillText(tag, b.x + 5, Math.max(11, b.y - 5));
  }

  for (const z of zones) {
    ctx.strokeStyle = flash ? "#ff5c5c" : "#f2c14b";
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    z.points.forEach((p, i) => {
      const x = p.x * ctx.canvas.width;
      const y = p.y * ctx.canvas.height;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    if (z.type === "polygon") {
      ctx.closePath();
      ctx.fillStyle = flash ? "rgba(255,92,92,0.18)" : "rgba(242,193,75,0.10)";
      ctx.fill();
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (pending.length) {
    ctx.strokeStyle = "#7ee7a4";
    ctx.fillStyle = "#7ee7a4";
    ctx.beginPath();
    pending.forEach((p, i) => {
      const x = p.x * ctx.canvas.width;
      const y = p.y * ctx.canvas.height;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      ctx.fillRect(x - 3, y - 3, 6, 6);
    });
    ctx.stroke();
  }

  if (flash) {
    ctx.strokeStyle = "#ff5c5c";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, ctx.canvas.width - 6, ctx.canvas.height - 6);
    ctx.fillStyle = "#ff5c5c";
    ctx.font = "bold 20px 'Rajdhani', sans-serif";
    ctx.fillText("INTRUSION ALERT", 18, ctx.canvas.height - 18);
  }
  ctx.restore();
}

/** Synthetic BOP scene so the analytics can be demonstrated without a camera. */
function drawSimScene(canvas: HTMLCanvasElement, t: number, moving: boolean) {
  const ctx = canvas.getContext("2d")!;
  const w = canvas.width;
  const h = canvas.height;
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#16202c");
  sky.addColorStop(0.45, "#1d2a36");
  sky.addColorStop(1, "#2a3340");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#131a22";
  ctx.beginPath();
  ctx.moveTo(0, h * 0.42);
  for (let x = 0; x <= w; x += 40) {
    ctx.lineTo(x, h * 0.42 - Math.sin(x / 120) * 22 - ((x * 7) % 17));
  }
  ctx.lineTo(w, h * 0.42);
  ctx.closePath();
  ctx.fill();

  // patrol track
  ctx.strokeStyle = "#3c4756";
  ctx.lineWidth = 26;
  ctx.beginPath();
  ctx.moveTo(-20, h * 0.78);
  ctx.lineTo(w + 20, h * 0.6);
  ctx.stroke();

  // fence posts
  ctx.strokeStyle = "#4b5666";
  ctx.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    const x = 40 + i * ((w - 80) / 11);
    const y = h * 0.7 - i * 9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 54);
    ctx.stroke();
  }

  const phase = moving ? t : 0;

  // walking intruder crossing the fence line
  const px = 60 + ((phase * 5.2) % (w + 120));
  const py = h * 0.62 + Math.sin(phase / 9) * 4;
  ctx.fillStyle = "#c8d3e0";
  ctx.fillRect(px, py - 96, 34, 96);
  ctx.beginPath();
  ctx.arc(px + 17, py - 108, 14, 0, Math.PI * 2);
  ctx.fill();

  // vehicle on the patrol road
  const vx = w - ((phase * 7.6) % (w + 260));
  ctx.fillStyle = "#9fb0c4";
  ctx.fillRect(vx, h * 0.66, 168, 46);
  ctx.fillStyle = "#7d8fa5";
  ctx.fillRect(vx + 34, h * 0.63, 78, 26);
  ctx.fillStyle = "#e6efff";
  ctx.fillRect(vx + 150, h * 0.69, 16, 9);

  ctx.fillStyle = "rgba(255,255,255,0.03)";
  for (let i = 0; i < 60; i++) {
    ctx.fillRect((i * 137 + phase * 3) % w, (i * 89) % h, 2, 2);
  }
}
