export type AlertSeverity = "critical" | "high" | "medium" | "low";

export type AlertKind =
  | "intrusion"
  | "human"
  | "vehicle"
  | "face"
  | "anpr"
  | "loitering"
  | "night-movement"
  | "tamper";

export interface AnalyticsAlert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  camera: string;
  sector: string;
  message: string;
  confidence: number;
  timestamp: number;
}

export interface CameraNode {
  id: string;
  name: string;
  sector: string;
  location: string;
  status: "online" | "degraded" | "offline";
  fps: number;
  latencyMs: number;
  analytics: AlertKind[];
  nightMode: boolean;
}

export const KIND_LABEL: Record<AlertKind, string> = {
  intrusion: "Virtual fence breach",
  human: "Human detected",
  vehicle: "Vehicle detected",
  face: "Face detected",
  anpr: "Number plate read",
  loitering: "Loitering / suspicious",
  "night-movement": "Night movement",
  tamper: "Camera tamper",
};

export const SEVERITY_ORDER: AlertSeverity[] = ["critical", "high", "medium", "low"];

export function severityClass(s: AlertSeverity): string {
  switch (s) {
    case "critical":
      return "text-destructive border-destructive/40 bg-destructive/10";
    case "high":
      return "text-warning border-warning/40 bg-warning/10";
    case "medium":
      return "text-accent border-accent/40 bg-accent/10";
    default:
      return "text-muted-foreground border-border bg-secondary";
  }
}

export function formatClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
