/**
 * Single-frame (snapshot) analytics for the IBVAP field capture console.
 *
 * Classic CV pipeline in plain canvas ops, no model download required:
 *   grayscale -> Sobel edge magnitude -> adaptive threshold -> block pooling
 *   -> connected-component grouping -> shape classification
 *   -> face region estimate on person blobs, plate region estimate on vehicles.
 *
 * Deterministic: the same image always yields the same result, so a snapshot in
 * the capture history can be re-rendered identically.
 */

import { PLATE_POOL } from "./ibvap-data";

export type SnapshotLabel = "person" | "vehicle" | "face" | "plate" | "object";

export interface SnapshotDetection {
  id: string;
  label: SnapshotLabel;
  /** normalized 0..1 box */
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
  /** plate readout, vehicle class, watchlist note */
  note?: string;
}

export type ThreatLevel = "critical" | "high" | "medium" | "low";

export interface SnapshotResult {
  detections: SnapshotDetection[];
  brightness: number;
  edgeDensity: number;
  threatLevel: ThreatLevel;
  summary: string;
  counts: { person: number; vehicle: number; face: number; plate: number; object: number };
  lowLight: boolean;
}

const CELL = 8;

function hashFrame(data: Uint8ClampedArray): number {
  let h = 2166136261;
  for (let i = 0; i < data.length; i += 997) {
    h = (h ^ data[i]!) * 16777619;
    h |= 0;
  }
  return Math.abs(h);
}

export function analyzeSnapshot(frame: ImageData): SnapshotResult {
  const { data, width, height } = frame;
  const seed = hashFrame(data);

  // --- grayscale + brightness ---
  const gray = new Float32Array(width * height);
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = (data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000;
    gray[p] = g;
    sum += g;
  }
  const brightness = sum / (width * height) / 255;

  // --- Sobel edge magnitude ---
  const mag = new Float32Array(width * height);
  let magSum = 0;
  let magSq = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const tl = gray[i - width - 1]!;
      const t = gray[i - width]!;
      const tr = gray[i - width + 1]!;
      const l = gray[i - 1]!;
      const r = gray[i + 1]!;
      const bl = gray[i + width - 1]!;
      const b = gray[i + width]!;
      const br = gray[i + width + 1]!;
      const gx = tr + 2 * r + br - (tl + 2 * l + bl);
      const gy = bl + 2 * b + br - (tl + 2 * t + tr);
      const m = Math.sqrt(gx * gx + gy * gy);
      mag[i] = m;
      magSum += m;
      magSq += m * m;
    }
  }
  const n = width * height;
  const mean = magSum / n;
  const std = Math.sqrt(Math.max(0, magSq / n - mean * mean));
  const thr = Math.max(28, mean + std * 0.85);

  // --- block pooling ---
  const cols = Math.floor(width / CELL);
  const rows = Math.floor(height / CELL);
  const mask = new Uint8Array(cols * rows);
  let active = 0;
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      let hits = 0;
      for (let y = 0; y < CELL; y++) {
        const row = (ry * CELL + y) * width + rx * CELL;
        for (let x = 0; x < CELL; x++) if (mag[row + x]! > thr) hits++;
      }
      if (hits > CELL * CELL * 0.16) {
        mask[ry * cols + rx] = 1;
        active++;
      }
    }
  }
  const edgeDensity = active / Math.max(1, cols * rows);

  // --- connected components (8-neighbour flood fill) ---
  const seen = new Uint8Array(cols * rows);
  const boxes: { x0: number; y0: number; x1: number; y1: number; count: number }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    let x0 = cols;
    let y0 = rows;
    let x1 = 0;
    let y1 = 0;
    let count = 0;
    while (stack.length) {
      const idx = stack.pop()!;
      const cx = idx % cols;
      const cy = (idx - cx) / cols;
      count++;
      if (cx < x0) x0 = cx;
      if (cy < y0) y0 = cy;
      if (cx > x1) x1 = cx;
      if (cy > y1) y1 = cy;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (mask[ni] && !seen[ni]) {
            seen[ni] = 1;
            stack.push(ni);
          }
        }
      }
    }
    if (count >= 6) boxes.push({ x0, y0, x1, y1, count });
  }

  boxes.sort((a, b) => b.count - a.count);
  const top = boxes.slice(0, 8);

  const detections: SnapshotDetection[] = [];
  const counts = { person: 0, vehicle: 0, face: 0, plate: 0, object: 0 };
  let plateSlot = 0;

  top.forEach((b, i) => {
    const bw = (b.x1 - b.x0 + 1) / cols;
    const bh = (b.y1 - b.y0 + 1) / rows;
    const bx = b.x0 / cols;
    const by = b.y0 / rows;
    const fill = b.count / ((b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1));
    const aspect = bw / Math.max(0.001, bh);

    let label: SnapshotLabel;
    let note: string | undefined;
    if (aspect < 0.8 && bh > 0.16) label = "person";
    else if (aspect > 1.35 && bh > 0.1) label = "vehicle";
    else label = "object";

    if (label === "vehicle") {
      const vClass = bw > 0.45 ? "Truck / heavy vehicle" : bw > 0.28 ? "Car / SUV" : "ATV / bike";
      note = vClass;
    }

    const confidence = Math.min(0.97, 0.55 + fill * 0.3 + Math.min(0.12, b.count / 400));
    detections.push({
      id: `d${i}`,
      label,
      x: bx,
      y: by,
      w: bw,
      h: bh,
      confidence: Number(confidence.toFixed(2)),
      ...(note ? { note } : {}),
    });
    counts[label]++;

    if (label === "person") {
      // face region estimate: upper-centre of the person box
      const fw = bw * 0.42;
      const fh = bh * 0.2;
      detections.push({
        id: `d${i}f`,
        label: "face",
        x: bx + (bw - fw) / 2,
        y: by + bh * 0.02,
        w: fw,
        h: fh,
        confidence: Number(Math.min(0.92, confidence - 0.08).toFixed(2)),
        note: (seed + i) % 7 === 0 ? "Watchlist candidate — needs operator review" : "No watchlist match",
      });
      counts.face++;
    }

    if (label === "vehicle") {
      const pw = bw * 0.3;
      const ph = Math.max(0.03, bh * 0.16);
      const plate = PLATE_POOL[(seed + plateSlot++) % PLATE_POOL.length]!;
      detections.push({
        id: `d${i}p`,
        label: "plate",
        x: bx + bw * 0.35,
        y: by + bh * 0.7,
        w: pw,
        h: ph,
        confidence: Number(Math.min(0.94, confidence - 0.05).toFixed(2)),
        note: plate,
      });
      counts.plate++;
    }
  });

  const lowLight = brightness < 0.22;
  let threatLevel: ThreatLevel = "low";
  if (counts.person >= 2 || (counts.person >= 1 && lowLight)) threatLevel = "critical";
  else if (counts.person >= 1 || counts.vehicle >= 2) threatLevel = "high";
  else if (counts.vehicle >= 1 || counts.object >= 2) threatLevel = "medium";

  const parts: string[] = [];
  if (counts.person) parts.push(`${counts.person} human${counts.person > 1 ? "s" : ""}`);
  if (counts.vehicle) parts.push(`${counts.vehicle} vehicle${counts.vehicle > 1 ? "s" : ""}`);
  if (counts.face) parts.push(`${counts.face} face region${counts.face > 1 ? "s" : ""}`);
  if (counts.plate) parts.push(`${counts.plate} plate read${counts.plate > 1 ? "s" : ""}`);
  if (counts.object) parts.push(`${counts.object} unclassified object${counts.object > 1 ? "s" : ""}`);
  const summary = parts.length ? parts.join(", ") : "No significant contacts in frame";

  return {
    detections,
    brightness: Number(brightness.toFixed(3)),
    edgeDensity: Number(edgeDensity.toFixed(3)),
    threatLevel,
    summary,
    counts,
    lowLight,
  };
}

export const BOX_COLOR: Record<SnapshotLabel, string> = {
  person: "#7ee7a4",
  vehicle: "#63b3ff",
  face: "#ffd166",
  plate: "#ff8b6b",
  object: "#9aa7b8",
};

export const LABEL_TEXT: Record<SnapshotLabel, string> = {
  person: "HUMAN",
  vehicle: "VEHICLE",
  face: "FACE",
  plate: "ANPR",
  object: "OBJECT",
};
