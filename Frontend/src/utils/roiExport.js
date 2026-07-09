// Export the stack's flake silhouettes as *editable vector ROIs* for the
// transfersystem imaging software (transfersystem_i2a/imaging).
//
// Unlike the PNG exports in stackExport.js this produces geometry, not pixels:
// each flake's mask is traced into one or more closed polygons, transformed
// through the exact on-canvas layer transform (centroid origin → rotation →
// magnification-calibrated width → position), and written out in *micrometres*
// with the origin at the stack-canvas centre. The imaging software rescales
// µm → screen pixels from its own stage calibration, so the ROIs land at the
// correct physical size at any objective, and imports them as movable /
// vertex-editable polygons.
//
// File format ("stack-planning-rois", version 1):
// {
//   format: "stack-planning-rois", version: 1,
//   units: "um", origin: "center",          // +x right, +y down
//   stack: { name, exported_at },
//   rois: [ { name, group, color, points_um: [[x, y], ...] }, ... ]
// }
// Every ROI is a closed polygon. Contours belonging to the same flake share a
// `group`, so the importer can keep multi-part flakes moving as one unit while
// separate flakes stay independently movable.

import {
  MAGNIFICATION_CALIBRATION,
  REFERENCE_FILENAME,
  CANONICAL_DISPLAY_WIDTH,
  getDisplayWidthPx,
} from "./calibration";
import { flakeMaskedUrl, fetchFlakeCentroid } from "./api";
import { layerHasSilhouette } from "./overlap";

const CANVAS_SIZE = 700;
const HALF = CANVAS_SIZE / 2;
const REF_CAL = MAGNIFICATION_CALIBRATION[REFERENCE_FILENAME];
const UM_PER_CANVAS_PX = (REF_CAL.um_per_px * REF_CAL.native_w) / CANONICAL_DISPLAY_WIDTH;

export const ROI_FORMAT = "stack-planning-rois";
export const ROI_VERSION = 1;

// Kept in sync with LayerImage.MATERIAL_OUTLINE_COLORS (and stackExport.js).
const MATERIAL_OUTLINE_COLORS = {
  Graphene: "#000000",
  hBN: "#1976D2",
  CrI3: "#E65100",
  WSe2: "#2E7D32",
  MoS2: "#7B1FA2",
  MoSe2: "#00838F",
  WS2: "#00695C",
};
const FALLBACK_COLORS = ["#ffdd00", "#E91E63", "#FF5722", "#009688", "#9C27B0", "#3F51B5", "#FF9800"];

// Same thresholds as flakePick.js: alpha above which a mask pixel is "inside",
// and the cap on the sampled mask resolution. 900 (vs flakePick's 600) keeps
// traced edges close to what the outline overlay shows.
const ALPHA_HIT = 24;
const SAMPLE_MAX = 900;
// Blobs smaller than this (in sampled px) are mask noise, not flake pieces.
const MIN_BLOB_PX = 24;
// Douglas-Peucker tolerance in sampled px — subpixel-ish, keeps files small
// without visibly changing the contour.
const SIMPLIFY_EPS = 1.25;

// ---------------------------------------------------------------------------
// Mask sampling
// ---------------------------------------------------------------------------

function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Rasterize the masked PNG and return a binary inside/outside grid.
async function loadMaskGrid(url) {
  const img = await loadImage(url);
  if (!img || !img.naturalWidth) return null;
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const scale = Math.min(1, SAMPLE_MAX / Math.max(nw, nh));
  const sw = Math.max(1, Math.round(nw * scale));
  const sh = Math.max(1, Math.round(nh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh).data;

  const inside = new Uint8Array(sw * sh);
  for (let p = 0, a = 3; p < inside.length; p++, a += 4) {
    inside[p] = data[a] >= ALPHA_HIT ? 1 : 0;
  }
  return { inside, sw, sh };
}

// ---------------------------------------------------------------------------
// Contour extraction: connected components + Moore boundary tracing
// ---------------------------------------------------------------------------

// Label 4-connected components; returns [{start, area}] with `start` the first
// (topmost, then leftmost) pixel of each blob — guaranteed to be a boundary pixel.
function findBlobs(grid) {
  const { inside, sw, sh } = grid;
  const labels = new Int32Array(sw * sh); // 0 = unlabelled
  const blobs = [];
  const stack = [];
  let next = 1;
  for (let i = 0; i < inside.length; i++) {
    if (!inside[i] || labels[i]) continue;
    const label = next++;
    let area = 0;
    stack.push(i);
    labels[i] = label;
    while (stack.length) {
      const p = stack.pop();
      area++;
      const x = p % sw;
      const y = (p / sw) | 0;
      if (x > 0 && inside[p - 1] && !labels[p - 1]) { labels[p - 1] = label; stack.push(p - 1); }
      if (x < sw - 1 && inside[p + 1] && !labels[p + 1]) { labels[p + 1] = label; stack.push(p + 1); }
      if (y > 0 && inside[p - sw] && !labels[p - sw]) { labels[p - sw] = label; stack.push(p - sw); }
      if (y < sh - 1 && inside[p + sw] && !labels[p + sw]) { labels[p + sw] = label; stack.push(p + sw); }
    }
    blobs.push({ start: i, area });
  }
  return blobs;
}

// Moore-neighbour tracing (Jacob's stopping criterion) of one blob's outer
// boundary, starting from its topmost-leftmost pixel. Returns [[x, y], ...] in
// sampled-pixel coords.
const MOORE = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function traceBoundary(grid, startIdx) {
  const { inside, sw, sh } = grid;
  const at = (x, y) => x >= 0 && x < sw && y >= 0 && y < sh && inside[y * sw + x];
  const sx = startIdx % sw;
  const sy = (startIdx / sw) | 0;

  const contour = [[sx, sy]];
  // Backtrack starts pointing up-left of the start pixel (came from above, as
  // the start is the topmost-leftmost pixel of the blob).
  let cx = sx, cy = sy;
  let dir = 6; // index into MOORE of the neighbour we came from (up)
  for (let guard = 0; guard < sw * sh * 4; guard++) {
    let found = -1;
    // Scan the 8 neighbours clockwise, starting just past the backtrack direction.
    for (let k = 0; k < 8; k++) {
      const d = (dir + 1 + k) % 8;
      const nx = cx + MOORE[d][0];
      const ny = cy + MOORE[d][1];
      if (at(nx, ny)) { found = d; break; }
    }
    if (found < 0) break; // isolated single pixel
    cx += MOORE[found][0];
    cy += MOORE[found][1];
    if (cx === sx && cy === sy) break; // closed the loop
    contour.push([cx, cy]);
    // New backtrack direction: opposite of the move we just made, minus one so
    // the next scan starts from the outside of the boundary.
    dir = (found + 4) % 8;
  }
  return contour;
}

// Ramer–Douglas–Peucker polyline simplification (closed polygon: keeps first
// point fixed, treats the wrap-around edge like any other).
function simplify(points, eps) {
  if (points.length < 5) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    let maxD = -1;
    let maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * points[i][0] - dx * points[i][1] + bx * ay - by * ax) / len;
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > eps) {
      keep[maxI] = 1;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// ---------------------------------------------------------------------------
// Layer transform: sampled mask px → stack-canvas px → µm (origin at centre)
// ---------------------------------------------------------------------------

// Forward version of flakePick.toLayerUV: the mask image is width-scaled to
// `displayWidth` canvas px, its centroid (origin%, in image coords) is placed
// at (HALF + pos_x, HALF + pos_y), and the whole thing rotates about that point.
function makeLayerTransform(layer, { sw, sh }, originX, originY, displayWidth) {
  const W = displayWidth;
  const H = W * (sh / sw);
  const rot = ((layer.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const cx = HALF + (layer.pos_x || 0);
  const cy = HALF + (layer.pos_y || 0);
  return ([px, py]) => {
    // Sample px → canvas-scale offsets from the centroid. +0.5 samples pixel centres.
    const lx = ((px + 0.5) / sw - originX / 100) * W;
    const ly = ((py + 0.5) / sh - originY / 100) * H;
    const x = cx + lx * cos - ly * sin;
    const y = cy + lx * sin + ly * cos;
    // Canvas px → µm, origin at the canvas centre.
    return [
      round2((x - HALF) * UM_PER_CANVAS_PX),
      round2((y - HALF) * UM_PER_CANVAS_PX),
    ];
  };
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function maskOptsOf(layer) {
  const bf = layer.canvas_base_filename || "raw_img.png";
  const hasUserMask = !!(layer.masks && layer.masks[bf]);
  return hasUserMask ? { layerId: layer.id, imageFilename: bf } : undefined;
}

function layerColor(layer) {
  return (
    MATERIAL_OUTLINE_COLORS[layer.flake_material] ??
    FALLBACK_COLORS[layer.layer_index % FALLBACK_COLORS.length]
  );
}

function layerRoiName(layer) {
  const idx = String(layer.layer_index ?? 0).padStart(2, "0");
  const base = `${layer.flake_material || "flake"}${layer.flake_id ? `_${layer.flake_id}` : ""}`;
  return `${idx}_${base}`.replace(/[^\w.-]+/g, "_");
}

// Trace one flake layer into ROI entries (one per mask blob, largest first).
async function traceFlakeLayer(layer) {
  const opts = maskOptsOf(layer);
  const [grid, centroid] = await Promise.all([
    loadMaskGrid(flakeMaskedUrl(layer.flake_path, opts)),
    fetchFlakeCentroid(layer.flake_path, opts),
  ]);
  if (!grid) return [];

  const toUm = makeLayerTransform(
    layer,
    grid,
    centroid.cx_pct ?? 50,
    centroid.cy_pct ?? 50,
    getDisplayWidthPx(layer.canvas_base_filename || "raw_img.png")
  );

  const blobs = findBlobs(grid)
    .filter((b) => b.area >= MIN_BLOB_PX)
    .sort((a, b) => b.area - a.area);

  const name = layerRoiName(layer);
  const group = `layer-${layer.id}`;
  const color = layerColor(layer);
  const rois = [];
  for (const blob of blobs) {
    const contour = simplify(traceBoundary(grid, blob.start), SIMPLIFY_EPS);
    if (contour.length < 3) continue;
    rois.push({
      name: rois.length === 0 ? name : `${name}_${rois.length + 1}`,
      group,
      color,
      points_um: contour.map(toUm),
    });
  }
  return rois;
}

// Closed drawn shapes (rectangle / polygon) also export as ROIs; geometry
// mirrors stackExport.drawShapeLayer (offset by pos, rotated about the centre).
function shapeToRoi(layer) {
  const data = layer.shape_data || {};
  const dx = layer.pos_x || 0;
  const dy = layer.pos_y || 0;

  let pts;
  if (layer.shape_type === "rect") {
    const { x1, y1, x2, y2 } = data;
    if ([x1, y1, x2, y2].some((v) => typeof v !== "number")) return null;
    const sx1 = Math.min(x1, x2), sy1 = Math.min(y1, y2);
    const sx2 = Math.max(x1, x2), sy2 = Math.max(y1, y2);
    pts = [[sx1, sy1], [sx2, sy1], [sx2, sy2], [sx1, sy2]];
  } else if (layer.shape_type === "polygon") {
    pts = (data.points || []).map((p) => [p[0], p[1]]);
    if (pts.length < 3) return null;
  } else {
    return null; // lines / freehand / text / measurements are not closed ROIs
  }

  const moved = pts.map(([x, y]) => [x + dx, y + dy]);
  const xs = moved.map((p) => p[0]);
  const ys = moved.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const rot = ((layer.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  return {
    name: `${String(layer.layer_index ?? 0).padStart(2, "0")}_${layer.shape_type}`,
    group: `layer-${layer.id}`,
    color: layer.shape_color || "#2196f3",
    points_um: moved.map(([x, y]) => {
      const rx = cx + (x - cx) * cos - (y - cy) * sin;
      const ry = cy + (x - cx) * sin + (y - cy) * cos;
      return [round2((rx - HALF) * UM_PER_CANVAS_PX), round2((ry - HALF) * UM_PER_CANVAS_PX)];
    }),
  };
}

// ---------------------------------------------------------------------------
// Public: build + download the ROI file
// ---------------------------------------------------------------------------

export async function buildStackRois({ layers, hiddenLayers, stackMeta } = {}) {
  const hidden = hiddenLayers || new Set();
  const sorted = [...(layers || [])]
    .filter((l) => !hidden.has(l.id))
    .sort((a, b) => a.layer_index - b.layer_index);

  const rois = [];
  for (const layer of sorted) {
    if (layer.is_shape) {
      const roi = shapeToRoi(layer);
      if (roi) rois.push(roi);
    } else if (!layer.is_local && layerHasSilhouette(layer)) {
      // eslint-disable-next-line no-await-in-loop
      rois.push(...(await traceFlakeLayer(layer)));
    }
    // Local imports and mask-less flakes have no silhouette to trace — skipped,
    // same as the outline PNG export.
  }
  if (!rois.length) {
    throw new Error("No ROIs to export — flakes need a mask (GMM or user-painted).");
  }

  return {
    format: ROI_FORMAT,
    version: ROI_VERSION,
    units: "um",
    origin: "center",
    stack: {
      name: stackMeta?.name || "Untitled stack",
      exported_at: new Date().toISOString(),
    },
    rois,
  };
}

function safeFilename(name) {
  return (name || "stack").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "stack";
}

export async function exportStackRois(opts) {
  const doc = await buildStackRois(opts);
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const ts = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFilename(opts.stackMeta?.name)}_rois_${ts}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
