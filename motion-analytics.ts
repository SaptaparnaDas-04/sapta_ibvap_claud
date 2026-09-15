/**
 * Browser-side frame analytics used by the live phone-camera page.
 * Implements a classic OpenCV-style pipeline in plain canvas ops:
 *   grayscale -> frame differencing -> threshold -> dilate (block pooling)
 *   -> connected-component blob grouping -> classification + fence test.
 */

export interface Blob {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
  label: "person" | "vehicle" | "object";
  confidence: number;
}

export interface FrameResult {
  blobs: Blob[];
  motionRatio: number;
  brightness: number;
  fenceBreach: boolean;
}

const CELL = 6; // pooling cell size in pixels of the analysis buffer

export interface FenceLine {
  /** normalized 0..1 coordinates */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export class MotionAnalyzer {
  private prev: Uint8ClampedArray | null = null;
  private width = 0;
  private height = 0;

  reset() {
    this.prev = null;
  }

  analyze(
    frame: ImageData,
    opts: { threshold?: number; fence?: FenceLine | null } = {},
  ): FrameResult {
    const { data, width, height } = frame;
    const threshold = opts.threshold ?? 26;

    if (this.width !== width || this.height !== height) {
      this.width = width;
      this.height = height;
      this.prev = null;
    }

    const gray = new Uint8ClampedArray(width * height);
    let sum = 0;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const g = (data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000;
      gray[p] = g;
      sum += g;
    }
    const brightness = sum / (width * height) / 255;

    if (!this.prev) {
      this.prev = gray;
      return { blobs: [], motionRatio: 0, brightness, fenceBreach: false };
    }

    const cols = Math.floor(width / CELL);
    const rows = Math.floor(height / CELL);
    const mask = new Uint8Array(cols * rows);
    let moving = 0;

    for (let ry = 0; ry < rows; ry++) {
      for (let rx = 0; rx < cols; rx++) {
        let hits = 0;
        for (let y = 0; y < CELL; y++) {
          const row = (ry * CELL + y) * width + rx * CELL;
          for (let x = 0; x < CELL; x++) {
            const idx = row + x;
            if (Math.abs(gray[idx]! - this.prev[idx]!) > threshold) hits++;
          }
        }
        if (hits > (CELL * CELL) / 6) {
          mask[ry * cols + rx] = 1;
          moving++;
        }
      }
    }

    this.prev = gray;

    const blobs = groupBlobs(mask, cols, rows, width, height);
    const motionRatio = moving / (cols * rows);

    let fenceBreach = false;
    if (opts.fence) {
      const f = opts.fence;
      for (const b of blobs) {
        if (
          segmentIntersectsRect(
            f.x1 * width,
            f.y1 * height,
            f.x2 * width,
            f.y2 * height,
            b,
          )
        ) {
          fenceBreach = true;
          break;
        }
      }
    }

    return { blobs, motionRatio, brightness, fenceBreach };
  }
}

function groupBlobs(
  mask: Uint8Array,
  cols: number,
  rows: number,
  width: number,
  height: number,
): Blob[] {
  const seen = new Uint8Array(cols * rows);
  const out: Blob[] = [];
  const stack: number[] = [];

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    let minX = cols,
      maxX = -1,
      minY = rows,
      maxY = -1,
      count = 0;

    while (stack.length) {
      const cur = stack.pop()!;
      const cx = cur % cols;
      const cy = (cur - cx) / cols;
      count++;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;

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

    if (count < 3) continue;

    const sx = width / cols;
    const sy = height / rows;
    const w = (maxX - minX + 1) * sx;
    const h = (maxY - minY + 1) * sy;
    const aspect = w / h;
    const fill = count / ((maxX - minX + 1) * (maxY - minY + 1));

    const label: Blob["label"] =
      aspect > 1.5 ? "vehicle" : aspect < 0.95 ? "person" : "object";

    out.push({
      x: minX * sx,
      y: minY * sy,
      w,
      h,
      area: count,
      label,
      confidence: Math.min(0.98, 0.55 + fill * 0.3 + Math.min(count, 60) / 300),
    });
  }

  return out.sort((a, b) => b.area - a.area).slice(0, 8);
}

function segmentIntersectsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: { x: number; y: number; w: number; h: number },
): boolean {
  const edges: [number, number, number, number][] = [
    [r.x, r.y, r.x + r.w, r.y],
    [r.x + r.w, r.y, r.x + r.w, r.y + r.h],
    [r.x + r.w, r.y + r.h, r.x, r.y + r.h],
    [r.x, r.y + r.h, r.x, r.y],
  ];
  if (
    x1 >= r.x &&
    x1 <= r.x + r.w &&
    y1 >= r.y &&
    y1 <= r.y + r.h
  )
    return true;
  return edges.some(([a, b, c, d]) => segIntersect(x1, y1, x2, y2, a, b, c, d));
}

function segIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

function cross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}
