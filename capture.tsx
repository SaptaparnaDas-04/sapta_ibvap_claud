import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Panel, SiteFooter, SiteHeader, Tag } from "@/components/hud";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { beep } from "@/lib/beep";
import { formatClock } from "@/lib/ibvap-types";
import {
  BOX_COLOR,
  LABEL_TEXT,
  analyzeSnapshot,
  type SnapshotResult,
  type ThreatLevel,
} from "@/lib/snapshot-analytics";

export const Route = createFileRoute("/capture")({
  head: () => ({
    meta: [
      { title: "Field Capture — Phone Camera Analytics | IBVAP" },
      {
        name: "description",
        content:
          "Open IBVAP on a phone browser, capture a border scene with the rear camera, and analyse it for humans, vehicles, faces and number plates with downloadable evidence.",
      },
      { property: "og:title", content: "IBVAP Field Capture" },
      {
        property: "og:description",
        content:
          "Rear-camera capture with zoom, torch, tap-to-focus, countdown timer, snapshot analytics overlays and capture history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FieldCapture,
});

const HISTORY_KEY = "ibvap.capture.history.v1";
const AN_W = 320;
const AN_H = 180;

interface HistoryItem {
  id: string;
  ts: number;
  image: string;
  threatLevel: ThreatLevel;
  summary: string;
  counts: SnapshotResult["counts"];
  brightness: number;
  tag: string;
}

const THREAT_TONE: Record<ThreatLevel, "danger" | "warning" | "accent" | "muted"> = {
  critical: "danger",
  high: "warning",
  medium: "accent",
  low: "muted",
};

function FieldCapture() {
  const [mode, setMode] = useState<"idle" | "live" | "review" | "analyzed">("idle");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [camError, setCamError] = useState<{ title: string; detail: string } | null>(null);
  const [status, setStatus] = useState("Camera off — press Enable camera to begin");
  const [zoom, setZoom] = useState<{ min: number; max: number; step: number; value: number } | null>(
    null,
  );
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [timerSec, setTimerSec] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [focusPing, setFocusPing] = useState<{ x: number; y: number; k: number } | null>(null);
  const [rawShot, setRawShot] = useState<string | null>(null);
  const [annotated, setAnnotated] = useState<string | null>(null);
  const [result, setResult] = useState<SnapshotResult | null>(null);
  const [shotAt, setShotAt] = useState<number>(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [viewing, setViewing] = useState<HistoryItem | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const countdownRef = useRef<number | null>(null);

  // ---------- history persistence ----------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw) as HistoryItem[]);
    } catch {
      /* ignore malformed history */
    }
  }, []);

  const persist = useCallback((items: HistoryItem[]) => {
    setHistory(items);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
    } catch {
      /* storage full — keep in-memory only */
    }
  }, []);

  // ---------- stream lifecycle ----------
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    trackRef.current = null;
    const v = videoRef.current;
    if (v) v.srcObject = null;
    setTorchOn(false);
    setTorchSupported(false);
    setZoom(null);
  }, []);

  useEffect(() => stopStream, [stopStream]);

  const startCamera = useCallback(
    async (want: "environment" | "user") => {
      const media = navigator.mediaDevices;
      if (!media?.getUserMedia) {
        setCamError({
          title: "This browser cannot open a camera",
          detail:
            "Camera capture needs a secure page (https) in Chrome on Android or Safari on iOS. Open this page there and try again, or upload a photo from your gallery instead.",
        });
        return;
      }
      setCamError(null);
      setStatus("Requesting camera permission…");

      const attempts: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { ideal: want },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
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
          if (name === "NotAllowedError" || name === "SecurityError") break;
        }
      }

      if (!stream) {
        const name = (lastErr as DOMException)?.name ?? "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setCamError({
            title: "Camera permission was blocked",
            detail:
              "Android Chrome: tap the lock icon left of the address bar → Permissions → Camera → Allow. iOS Safari: tap the ⓐA icon → Website Settings → Camera → Allow, then reload and press Enable camera.",
          });
        } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
          setCamError({
            title: "No camera found on this device",
            detail:
              "This device reports no usable camera, or access is blocked by a device/MDM policy. Use Upload from gallery to analyse an existing photo instead.",
          });
        } else if (name === "NotReadableError" || name === "TrackStartError") {
          setCamError({
            title: "The camera is busy",
            detail:
              "Another app or browser tab already holds the camera. Close video calls, the camera app or other tabs, then press Enable camera again.",
          });
        } else {
          setCamError({
            title: "Camera could not be started",
            detail:
              "The browser refused the camera request. Reload the page and press Enable camera, or upload a photo from your gallery.",
          });
        }
        setStatus("Camera unavailable");
        return;
      }

      stopStream();
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0] ?? null;
      trackRef.current = track;

      const v = videoRef.current!;
      v.srcObject = stream;
      v.muted = true;
      try {
        await v.play();
      } catch {
        /* autoplay blocked — user can tap the preview */
      }

      const settings = track?.getSettings() ?? {};
      setFacing((settings.facingMode as "environment" | "user") ?? want);

      // hardware capability probe (zoom / torch are optional and vendor-dependent)
      const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
        zoom?: { min: number; max: number; step?: number };
        torch?: boolean;
      };
      if (caps.zoom && caps.zoom.max > caps.zoom.min) {
        const current = (settings as { zoom?: number }).zoom ?? caps.zoom.min;
        setZoom({
          min: caps.zoom.min,
          max: caps.zoom.max,
          step: caps.zoom.step && caps.zoom.step > 0 ? caps.zoom.step : 0.1,
          value: current,
        });
      }
      setTorchSupported(Boolean(caps.torch));

      setMode("live");
      setStatus(
        `Camera live · ${(settings.facingMode ?? want) === "environment" ? "rear" : "front"} lens · ${
          settings.width ?? 0
        }×${settings.height ?? 0}`,
      );
      beep("info");
    },
    [stopStream],
  );

  const switchCamera = useCallback(() => {
    const next = facing === "environment" ? "user" : "environment";
    void startCamera(next);
  }, [facing, startCamera]);

  const applyZoom = useCallback(async (value: number) => {
    setZoom((z) => (z ? { ...z, value } : z));
    try {
      await trackRef.current?.applyConstraints({ advanced: [{ zoom: value } as never] });
    } catch {
      /* hardware refused the zoom step */
    }
  }, []);

  const toggleTorch = useCallback(async () => {
    const next = !torchOn;
    try {
      await trackRef.current?.applyConstraints({ advanced: [{ torch: next } as never] });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
      setStatus("Torch is not controllable on this device");
    }
  }, [torchOn]);

  const tapToFocus = useCallback(async (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - box.left) / box.width;
    const ny = (e.clientY - box.top) / box.height;
    setFocusPing({ x: nx, y: ny, k: Date.now() });
    try {
      await trackRef.current?.applyConstraints({
        advanced: [
          { pointsOfInterest: [{ x: nx, y: ny }], focusMode: "single-shot" } as never,
        ],
      });
    } catch {
      /* device has fixed focus — the ring is still useful operator feedback */
    }
  }, []);

  // ---------- analysis ----------
  const runAnalysis = useCallback(
    async (dataUrl: string) => {
      setStatus("Running IBVAP snapshot analytics…");
      const img = new Image();
      img.src = dataUrl;
      await img.decode().catch(() => undefined);

      const an = document.createElement("canvas");
      an.width = AN_W;
      an.height = AN_H;
      const actx = an.getContext("2d")!;
      actx.drawImage(img, 0, 0, AN_W, AN_H);
      const res = analyzeSnapshot(actx.getImageData(0, 0, AN_W, AN_H));

      // annotated evidence frame
      const outW = Math.min(1280, img.naturalWidth || 1280);
      const outH = Math.round((outW * (img.naturalHeight || 720)) / (img.naturalWidth || 1280));
      const out = document.createElement("canvas");
      out.width = outW;
      out.height = outH;
      const ctx = out.getContext("2d")!;
      ctx.drawImage(img, 0, 0, outW, outH);

      ctx.lineWidth = Math.max(2, outW / 480);
      ctx.font = `600 ${Math.max(11, Math.round(outW / 70))}px "IBM Plex Mono", monospace`;
      res.detections.forEach((d) => {
        const x = d.x * outW;
        const y = d.y * outH;
        const w = d.w * outW;
        const h = d.h * outH;
        const color = BOX_COLOR[d.label];
        ctx.strokeStyle = color;
        ctx.strokeRect(x, y, w, h);
        const text = `${LABEL_TEXT[d.label]} ${Math.round(d.confidence * 100)}%${
          d.label === "plate" && d.note ? ` · ${d.note}` : ""
        }`;
        const tw = ctx.measureText(text).width + 10;
        const th = Math.max(16, outW / 55);
        ctx.fillStyle = "rgba(6,10,15,0.82)";
        ctx.fillRect(x, Math.max(0, y - th), tw, th);
        ctx.fillStyle = color;
        ctx.fillText(text, x + 5, Math.max(th - 5, y - 5));
      });

      const stamp = `IBVAP · FIELD-CAM · ${new Date().toISOString().replace("T", " ").slice(0, 19)}Z`;
      ctx.fillStyle = "rgba(6,10,15,0.8)";
      ctx.fillRect(0, outH - 26, ctx.measureText(stamp).width + 16, 26);
      ctx.fillStyle = "#7ee7a4";
      ctx.fillText(stamp, 8, outH - 8);

      const annotatedUrl = out.toDataURL("image/jpeg", 0.85);
      setAnnotated(annotatedUrl);
      setResult(res);
      const ts = Date.now();
      setShotAt(ts);
      setMode("analyzed");
      setStatus(`Analysis complete · ${res.summary}`);
      beep(res.threatLevel === "critical" ? "critical" : res.threatLevel === "high" ? "warn" : "info");

      // history thumbnail (kept small so localStorage survives)
      const thumb = document.createElement("canvas");
      thumb.width = 480;
      thumb.height = Math.round((480 * outH) / outW);
      thumb.getContext("2d")?.drawImage(out, 0, 0, thumb.width, thumb.height);
      const item: HistoryItem = {
        id: `cap-${ts}`,
        ts,
        image: thumb.toDataURL("image/jpeg", 0.6),
        threatLevel: res.threatLevel,
        summary: res.summary,
        counts: res.counts,
        brightness: res.brightness,
        tag: "FIELD-CAM-01 · Sector 4 / fence line",
      };
      persist([item, ...history].slice(0, 12));
    },
    [history, persist],
  );

  // ---------- capture ----------
  const grabFrame = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) {
      setStatus("Preview not ready yet — wait a moment and capture again");
      return;
    }
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d")!;
    if (facing === "user") {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", 0.92);
    setRawShot(url);
    setAnnotated(null);
    setResult(null);
    setMode("review");
    setStatus("Snapshot captured — retake or confirm to run analytics");
    stopStream();
  }, [facing, stopStream]);

  const capture = useCallback(() => {
    if (countdownRef.current) return;
    if (timerSec <= 0) {
      grabFrame();
      return;
    }
    let left = timerSec;
    setCountdown(left);
    beep("info");
    countdownRef.current = window.setInterval(() => {
      left -= 1;
      setCountdown(left);
      if (left <= 0) {
        window.clearInterval(countdownRef.current!);
        countdownRef.current = null;
        setCountdown(0);
        grabFrame();
      } else {
        beep("info");
      }
    }, 1000);
  }, [grabFrame, timerSec]);

  useEffect(
    () => () => {
      if (countdownRef.current) window.clearInterval(countdownRef.current);
    },
    [],
  );

  const retake = useCallback(() => {
    setRawShot(null);
    setAnnotated(null);
    setResult(null);
    void startCamera(facing);
  }, [facing, startCamera]);

  const onFile = useCallback((file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      stopStream();
      setRawShot(String(reader.result));
      setAnnotated(null);
      setResult(null);
      setMode("review");
      setStatus(`${file.name} loaded — confirm to run analytics`);
    };
    reader.readAsDataURL(file);
  }, [stopStream]);

  const download = useCallback(() => {
    if (!annotated) return;
    const a = document.createElement("a");
    a.href = annotated;
    a.download = `ibvap-capture-${shotAt || Date.now()}.jpg`;
    a.click();
  }, [annotated, shotAt]);

  const shown = viewing?.image ?? annotated ?? rawShot;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-5">
          <p className="label-hud">Field capture</p>
          <h1 className="font-display text-3xl font-bold tracking-wide sm:text-4xl">
            Phone-as-CCTV snapshot analytics
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Open this page in Chrome or Safari on the phone. The phone uses its own rear camera
            through the web page — no cable, no drivers and no pairing with the laptop. Capture a
            frame and IBVAP marks humans, vehicles, face regions and number plates, then stores the
            evidence frame in the capture history.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* ---------------- stage ---------------- */}
          <div className="space-y-3">
            <div
              className="relative overflow-hidden rounded-sm border border-border bg-black"
              onPointerDown={mode === "live" ? tapToFocus : undefined}
            >
              <div className="relative aspect-video w-full">
                <video
                  ref={videoRef}
                  playsInline
                  autoPlay
                  muted
                  className={`absolute inset-0 h-full w-full object-contain ${
                    mode === "live" ? "" : "hidden"
                  } ${facing === "user" ? "scale-x-[-1]" : ""}`}
                />
                {mode !== "live" && shown && (
                  <img
                    src={shown}
                    alt="Captured border scene with IBVAP detection overlays"
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                )}
                {mode === "idle" && !shown && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
                    <p className="font-mono text-[11px] uppercase tracking-widest text-primary/70">
                      Camera standby
                    </p>
                    <p className="max-w-xs text-sm text-muted-foreground">
                      Press Enable camera, or upload a photo from the phone gallery.
                    </p>
                  </div>
                )}

                {countdown > 0 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/40">
                    <span className="font-display text-7xl font-bold text-primary">{countdown}</span>
                  </div>
                )}

                {focusPing && mode === "live" && (
                  <span
                    key={focusPing.k}
                    className="pointer-events-none absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary/80"
                    style={{ left: `${focusPing.x * 100}%`, top: `${focusPing.y * 100}%` }}
                  />
                )}

                <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2">
                  <Tag tone={mode === "live" ? "primary" : "muted"}>
                    {mode === "live" ? "Camera live" : mode === "analyzed" ? "Analysed" : mode === "review" ? "Review" : "Standby"}
                  </Tag>
                  {result && mode === "analyzed" && (
                    <Tag tone={THREAT_TONE[result.threatLevel]}>Threat: {result.threatLevel}</Tag>
                  )}
                  {torchOn && <Tag tone="warning">Torch on</Tag>}
                </div>
              </div>
            </div>

            {/* ---------------- controls ---------------- */}
            <div className="flex flex-wrap items-center gap-2">
              {mode === "live" ? (
                <>
                  <button
                    onClick={capture}
                    className="rounded-sm bg-primary px-5 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-widest text-primary-foreground"
                  >
                    {timerSec ? `Capture in ${timerSec}s` : "Capture"}
                  </button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={switchCamera}
                        className="rounded-sm border border-border px-3 py-2.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:bg-secondary"
                      >
                        Switch to {facing === "environment" ? "front" : "rear"}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Swap between the {facing === "environment" ? "selfie" : "rear"} lens
                    </TooltipContent>
                  </Tooltip>
                  <button
                    onClick={() => {
                      stopStream();
                      setMode("idle");
                      setStatus("Camera released");
                    }}
                    className="rounded-sm border border-border px-3 py-2.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:bg-secondary"
                  >
                    Stop camera
                  </button>
                  {torchSupported && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => void toggleTorch()}
                          className={`rounded-sm px-3 py-2.5 font-mono text-[11px] uppercase tracking-widest ${
                            torchOn
                              ? "border border-warning/50 bg-warning/15 text-warning"
                              : "border border-border text-muted-foreground hover:bg-secondary"
                          }`}
                        >
                          Torch
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Toggle the camera flash for low light</TooltipContent>
                    </Tooltip>
                  )}
                </>
              ) : (
                <button
                  onClick={() => void startCamera(facing)}
                  className="rounded-sm bg-primary px-5 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-widest text-primary-foreground"
                >
                  Enable camera
                </button>
              )}

              <button
                onClick={() => fileRef.current?.click()}
                className="rounded-sm border border-primary/50 bg-primary/10 px-3 py-2.5 font-mono text-[11px] uppercase tracking-widest text-primary"
              >
                Upload from gallery
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  onFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />

              <Tooltip>
                <TooltipTrigger asChild>
              <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Timer
                <select
                  value={timerSec}
                  onChange={(e) => setTimerSec(Number(e.target.value))}
                  className="rounded-sm border border-input bg-secondary px-2 py-1.5 font-mono text-[11px] text-foreground outline-none focus:border-primary/60"
                >
                  <option value={0}>Off</option>
                  <option value={3}>3s</option>
                  <option value={5}>5s</option>
                  <option value={10}>10s</option>
                </select>
              </label>
                </TooltipTrigger>
                <TooltipContent>Delay the shutter so you can get in frame</TooltipContent>
              </Tooltip>
            </div>

            {mode === "live" && zoom && (
              <label className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Zoom ×{zoom.value.toFixed(1)}
                <input
                  type="range"
                  min={zoom.min}
                  max={zoom.max}
                  step={zoom.step}
                  value={zoom.value}
                  onChange={(e) => void applyZoom(Number(e.target.value))}
                  className="max-w-xs flex-1 accent-[oklch(0.79_0.18_148)]"
                />
              </label>
            )}
            {mode === "live" && !zoom && (
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Tap the preview to focus · optical zoom and torch are not exposed by this device
              </p>
            )}

            {mode === "review" && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => rawShot && void runAnalysis(rawShot)}
                  className="rounded-sm bg-primary px-5 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-widest text-primary-foreground"
                >
                  Confirm · run analytics
                </button>
                <button
                  onClick={retake}
                  className="rounded-sm border border-border px-4 py-2.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:bg-secondary"
                >
                  Retake
                </button>
              </div>
            )}

            {mode === "analyzed" && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={download}
                  className="rounded-sm bg-primary px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-widest text-primary-foreground"
                >
                  Download snapshot
                </button>
                <button
                  onClick={retake}
                  className="rounded-sm border border-border px-4 py-2.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:bg-secondary"
                >
                  New capture
                </button>
              </div>
            )}

            <p className="font-mono text-[11px] text-muted-foreground">{status}</p>

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
                    Try again
                  </button>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="rounded-sm border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:bg-secondary"
                  >
                    Upload a photo instead
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ---------------- side rail ---------------- */}
          <div className="space-y-3">
            <Panel
              title="Analysis breakdown"
              right={
                result ? <Tag tone={THREAT_TONE[result.threatLevel]}>{result.threatLevel}</Tag> : undefined
              }
            >
              {!result ? (
                <p className="text-sm text-muted-foreground">
                  Capture or upload a frame to see detected contacts, confidence scores and the
                  threat assessment.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 font-mono text-[11px] uppercase tracking-widest">
                    <div className="rounded-sm border border-border bg-secondary px-2 py-1.5">
                      Humans <span className="text-primary">{result.counts.person}</span>
                    </div>
                    <div className="rounded-sm border border-border bg-secondary px-2 py-1.5">
                      Vehicles <span className="text-primary">{result.counts.vehicle}</span>
                    </div>
                    <div className="rounded-sm border border-border bg-secondary px-2 py-1.5">
                      Faces <span className="text-primary">{result.counts.face}</span>
                    </div>
                    <div className="rounded-sm border border-border bg-secondary px-2 py-1.5">
                      Plates <span className="text-primary">{result.counts.plate}</span>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">{result.summary}</p>
                  <ul className="space-y-1.5">
                    {result.detections.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between gap-2 rounded-sm border border-border bg-secondary px-2 py-1.5 font-mono text-[11px]"
                      >
                        <span style={{ color: BOX_COLOR[d.label] }}>{LABEL_TEXT[d.label]}</span>
                        <span className="flex-1 truncate text-muted-foreground">{d.note ?? ""}</span>
                        <span className="text-foreground">{Math.round(d.confidence * 100)}%</span>
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-border pt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <p>FIELD-CAM-01 · Sector 4 / fence line</p>
                    <p>
                      {formatClock(shotAt)} · lux {Math.round(result.brightness * 100)}%
                      {result.lowLight ? " · low light" : ""}
                    </p>
                  </div>
                </div>
              )}
            </Panel>

            <Panel
              title="Capture history"
              right={
                history.length ? (
                  <button
                    onClick={() => {
                      persist([]);
                      setViewing(null);
                    }}
                    className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-destructive"
                  >
                    Clear all
                  </button>
                ) : undefined
              }
            >
              {!history.length ? (
                <p className="text-sm text-muted-foreground">
                  Analysed captures are stored on this device and listed here.
                </p>
              ) : (
                <ul className="space-y-2">
                  {history.map((h) => (
                    <li
                      key={h.id}
                      className={`flex gap-2 rounded-sm border p-2 ${
                        viewing?.id === h.id ? "border-primary/50 bg-primary/5" : "border-border"
                      }`}
                    >
                      <button onClick={() => setViewing(h)} className="shrink-0">
                        <img
                          src={h.image}
                          alt={`Capture from ${formatClock(h.ts)}: ${h.summary}`}
                          className="h-14 w-24 rounded-sm border border-border object-cover"
                        />
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <Tag tone={THREAT_TONE[h.threatLevel]}>{h.threatLevel}</Tag>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {formatClock(h.ts)}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{h.summary}</p>
                        <div className="mt-1 flex gap-3 font-mono text-[10px] uppercase tracking-widest">
                          <button
                            onClick={() => setViewing(h)}
                            className="text-primary hover:underline"
                          >
                            View
                          </button>
                          <button
                            onClick={() => {
                              persist(history.filter((x) => x.id !== h.id));
                              if (viewing?.id === h.id) setViewing(null);
                            }}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {viewing && (
                <button
                  onClick={() => setViewing(null)}
                  className="mt-3 w-full rounded-sm border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:bg-secondary"
                >
                  Back to current capture
                </button>
              )}
            </Panel>

            <Panel title="Phone setup">
              <ol className="space-y-2 text-sm text-muted-foreground">
                <li>1. Open this page's URL in Chrome (Android) or Safari (iOS).</li>
                <li>2. Press Enable camera and allow access when prompted.</li>
                <li>3. Tap the preview to focus, use zoom or torch if the device exposes them.</li>
                <li>4. Capture, confirm, then download the annotated evidence frame.</li>
              </ol>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Detections are heuristic demonstration analytics, not verified records
              </p>
            </Panel>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
