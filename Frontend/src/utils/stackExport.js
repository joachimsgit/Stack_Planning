// Offscreen re-render of a stack to a <canvas>, used for PNG export and the
// printable stack report. This mirrors the on-screen rendering math in
// StackCanvas / LayerImage / ShapeLayer so the export matches what the user
// sees — without scraping the DOM (which mishandles mix-blend-mode + CSS
// filters and taints the canvas on cross-origin images).
//
// Key geometry (see LayerImage): a flake layer's transform origin (its
// centroid) lands at canvas point (CANVAS_SIZE/2 + pos_x, CANVAS_SIZE/2 + pos_y),
// the image is rotated about that point and scaled so its width equals
// getDisplayWidthPx(baseFilename). Non-bottom layers composite with `multiply`.

import {
  MAGNIFICATION_CALIBRATION,
  REFERENCE_FILENAME,
  CANONICAL_DISPLAY_WIDTH,
  getDisplayWidthPx,
  baseSupportsRemoteOverlay,
} from "./calibration";
import {
  flakeImageUrl,
  flakeMaskedUrl,
  flakeOutlineUrl,
  fetchFlakeCentroid,
  resolveLocalImageUrl,
} from "./api";
import { buildZip } from "./zip";

const CANVAS_SIZE = 700;
const HALF = CANVAS_SIZE / 2;

const REF_CAL = MAGNIFICATION_CALIBRATION[REFERENCE_FILENAME];
const UM_PER_CANVAS_PX = (REF_CAL.um_per_px * REF_CAL.native_w) / CANONICAL_DISPLAY_WIDTH;
const NICE_UM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

// Kept in sync with LayerImage.MATERIAL_OUTLINE_COLORS.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Load an image with CORS enabled so the resulting canvas is not tainted.
// Resolves to null (rather than rejecting) on error so one missing image never
// aborts the whole export.
function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function hexToRgba(hex, alpha) {
  let h = (hex || "#000000").replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

const DEFAULT_DISPLAY_MODES = { background: false, flake: true, outline: false };

// ---------------------------------------------------------------------------
// Per-layer rendering
// ---------------------------------------------------------------------------

async function drawImageLayer(ctx, layer, { scale, isBottom, modes }) {
  const isLocal = !!layer.is_local;
  const baseFilename = layer.canvas_base_filename || "raw_img.png";

  let originX = 50;
  let originY = 50;
  let displayWidth = 900;
  const urls = [];

  if (isLocal) {
    urls.push(resolveLocalImageUrl(layer.local_image_url));
  } else {
    if (!layer.flake_path) return;
    const hasUserMask = !!(layer.masks && layer.masks[baseFilename]);
    const overlaysAvailable = hasUserMask || baseSupportsRemoteOverlay(baseFilename);
    const maskOpts = hasUserMask ? { layerId: layer.id, imageFilename: baseFilename } : undefined;

    const centroid = await fetchFlakeCentroid(layer.flake_path, maskOpts);
    originX = centroid.cx_pct ?? 50;
    originY = centroid.cy_pct ?? 50;
    displayWidth = getDisplayWidthPx(baseFilename);

    const outlineColor =
      MATERIAL_OUTLINE_COLORS[layer.flake_material] ??
      FALLBACK_COLORS[layer.layer_index % FALLBACK_COLORS.length];

    // Draw order matches LayerImage: base, then flake fill, then outline.
    if (modes.background) urls.push(flakeImageUrl(layer.flake_path, baseFilename));
    if (modes.flake && overlaysAvailable) urls.push(flakeMaskedUrl(layer.flake_path, maskOpts));
    if (modes.outline && overlaysAvailable) urls.push(flakeOutlineUrl(layer.flake_path, outlineColor, maskOpts));
  }

  const images = (await Promise.all(urls.map(loadImage))).filter(Boolean);
  if (images.length === 0) return;

  const W = displayWidth * scale;
  const S = CANVAS_SIZE * scale;

  // Render the layer's sub-images to a private buffer first, so the
  // brightness/contrast filter + multiply blend apply to the composed group as
  // a whole (matching the DOM, where those live on the container element).
  const buf = document.createElement("canvas");
  buf.width = S;
  buf.height = S;
  const bctx = buf.getContext("2d");
  bctx.save();
  bctx.translate((HALF + (layer.pos_x || 0)) * scale, (HALF + (layer.pos_y || 0)) * scale);
  bctx.rotate(((layer.rotation || 0) * Math.PI) / 180);
  for (const img of images) {
    const H = W * (img.naturalHeight / img.naturalWidth);
    bctx.drawImage(img, (-originX / 100) * W, (-originY / 100) * H, W, H);
  }
  bctx.restore();

  ctx.save();
  ctx.globalAlpha = layer.opacity ?? 1;
  ctx.filter = `brightness(${layer.brightness ?? 1}) contrast(${layer.contrast ?? 1})`;
  ctx.globalCompositeOperation = isBottom ? "source-over" : "multiply";
  ctx.drawImage(buf, 0, 0);
  ctx.restore();
}

function strokedText(ctx, text, x, y, { size, color, align = "left", baseline = "alphabetic" }) {
  ctx.font = `700 ${size}px sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "white";
  ctx.lineWidth = Math.max(2, size * 0.28);
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

// Draw a shape layer (no selection handles). Geometry mirrors ShapeLayer.
function drawShapeLayer(ctx, layer, scale) {
  const data = layer.shape_data || {};
  const color = layer.shape_color || "#2196f3";
  const sw = (layer.shape_stroke_width || 2) * scale;
  const dx = layer.pos_x || 0;
  const dy = layer.pos_y || 0;
  const rot = ((layer.rotation || 0) * Math.PI) / 180;

  // Rotate the whole shape about its center (cx, cy) given in canvas units.
  const withRotation = (cx, cy, fn) => {
    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.translate(cx * scale, cy * scale);
    ctx.rotate(rot);
    fn((x, y) => [(x + dx - cx) * scale, (y + dy - cy) * scale]);
    ctx.restore();
  };

  const dot = (px, py) => {
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(px, py, 4 * scale, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, 3 * scale, 0, 2 * Math.PI);
    ctx.fill();
  };

  switch (layer.shape_type) {
    case "rect": {
      const { x1, y1, x2, y2 } = data;
      const sx1 = Math.min(x1, x2), sy1 = Math.min(y1, y2);
      const sx2 = Math.max(x1, x2), sy2 = Math.max(y1, y2);
      const rx = sx1 + dx, ry = sy1 + dy;
      const rw = sx2 - sx1, rh = sy2 - sy1;
      const cx = rx + rw / 2, cy = ry + rh / 2;
      withRotation(cx, cy, (L) => {
        const [ox, oy] = L(sx1, sy1);
        ctx.fillStyle = hexToRgba(color, 0.15);
        ctx.strokeStyle = color;
        ctx.lineWidth = sw;
        ctx.fillRect(ox, oy, rw * scale, rh * scale);
        ctx.strokeRect(ox, oy, rw * scale, rh * scale);
      });
      break;
    }
    case "freehand":
    case "polygon": {
      const pts = data.points || [];
      if (pts.length < 2) break;
      const closed = layer.shape_type === "polygon";
      const xs = pts.map((p) => p[0] + dx), ys = pts.map((p) => p[1] + dy);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      withRotation(cx, cy, (L) => {
        ctx.beginPath();
        pts.forEach((p, i) => {
          const [px, py] = L(p[0], p[1]);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        if (closed) ctx.closePath();
        ctx.lineWidth = sw;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        if (closed) { ctx.fillStyle = hexToRgba(color, 0.15); ctx.fill(); }
        ctx.strokeStyle = color;
        ctx.stroke();
      });
      break;
    }
    case "line":
    case "distance": {
      const pts = data.points || [];
      if (pts.length !== 2) break;
      const [a, b] = pts;
      const ax = a[0] + dx, ay = a[1] + dy, bx = b[0] + dx, by = b[1] + dy;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      withRotation(mx, my, (L) => {
        const [aX, aY] = L(a[0], a[1]);
        const [bX, bY] = L(b[0], b[1]);
        ctx.lineCap = "round";
        ctx.strokeStyle = "white";
        ctx.lineWidth = sw + 2 * scale;
        ctx.beginPath(); ctx.moveTo(aX, aY); ctx.lineTo(bX, bY); ctx.stroke();
        ctx.strokeStyle = color;
        ctx.lineWidth = sw;
        ctx.beginPath(); ctx.moveTo(aX, aY); ctx.lineTo(bX, bY); ctx.stroke();
        dot(aX, aY);
        dot(bX, bY);
        if (layer.shape_type === "distance") {
          const distUm = Math.hypot(bx - ax, by - ay) * UM_PER_CANVAS_PX;
          // Label offset perpendicular to the line (matches ShapeLayer's 14px),
          // computed in the rotated frame so it stays consistent under rotation.
          const ang = Math.atan2(bY - aY, bX - aX) - Math.PI / 2;
          const midX = (aX + bX) / 2 + Math.cos(ang) * 14 * scale;
          const midY = (aY + bY) / 2 + Math.sin(ang) * 14 * scale;
          strokedText(ctx, `${distUm.toFixed(2)} µm`, midX, midY, {
            size: 13 * scale, color, align: "center", baseline: "middle",
          });
        }
      });
      break;
    }
    case "angle": {
      const pts = data.points || [];
      if (pts.length !== 3) break;
      const [p1, p2, p3] = pts;
      const bx = p2[0] + dx, by = p2[1] + dy; // vertex
      withRotation(bx, by, (L) => {
        const [aX, aY] = L(p1[0], p1[1]);
        const [bX, bY] = L(p2[0], p2[1]);
        const [cX, cY] = L(p3[0], p3[1]);
        ctx.lineCap = "round";
        const arm = (x1, y1, x2, y2) => {
          ctx.strokeStyle = "white"; ctx.lineWidth = sw + 2 * scale;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.strokeStyle = color; ctx.lineWidth = sw;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        };
        arm(aX, aY, bX, bY);
        arm(bX, bY, cX, cY);
        const v1x = aX - bX, v1y = aY - bY, v2x = cX - bX, v2y = cY - bY;
        const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
        const dotp = v1x * v2x + v1y * v2y;
        const angleDeg = m1 > 1e-6 && m2 > 1e-6
          ? (Math.acos(Math.max(-1, Math.min(1, dotp / (m1 * m2)))) * 180) / Math.PI
          : 0;
        const a1 = Math.atan2(v1y, v1x), a2 = Math.atan2(v2y, v2x);
        let da = a2 - a1;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        const arcR = Math.min(28 * scale, Math.min(m1, m2) * 0.6);
        ctx.strokeStyle = color; ctx.lineWidth = sw;
        ctx.beginPath(); ctx.arc(bX, bY, arcR, a1, a2, da < 0); ctx.stroke();
        const midA = a1 + da / 2;
        const lx = bX + Math.cos(midA) * (arcR + 14 * scale);
        const ly = bY + Math.sin(midA) * (arcR + 14 * scale);
        strokedText(ctx, `${angleDeg.toFixed(1)}°`, lx, ly, {
          size: 13 * scale, color, align: "center", baseline: "middle",
        });
      });
      break;
    }
    case "text": {
      const { text, fontSize = 16 } = data;
      if (!text) break;
      const lines = String(text).split("\n");
      const cx = HALF + dx, cy = HALF + dy;
      withRotation(cx, cy, () => {
        const size = fontSize * scale;
        const lineH = fontSize * 1.4 * scale;
        lines.forEach((line, i) => {
          strokedText(ctx, line, 0, i * lineH, { size, color, align: "left", baseline: "alphabetic" });
        });
      });
      break;
    }
    default:
      break;
  }
}

// Draw the calibrated scale bar (mirrors StackCanvas, but baked into pixels).
function drawScaleBar(ctx, scale) {
  const S = CANVAS_SIZE * scale;
  const barTargetUm = 80 * UM_PER_CANVAS_PX;
  const barUm = NICE_UM.find((v) => v >= barTargetUm) ?? NICE_UM[NICE_UM.length - 1];
  const barPx = (barUm * scale) / UM_PER_CANVAS_PX;
  const label = barUm >= 1000 ? `${barUm / 1000} mm` : `${barUm} µm`;
  const x0 = 12 * scale;
  const y = S - 22 * scale;
  const cap = 6 * scale;

  const stroke = (w, col) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + barPx, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0, y - cap); ctx.lineTo(x0, y + cap); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0 + barPx, y - cap); ctx.lineTo(x0 + barPx, y + cap); ctx.stroke();
  };
  stroke(4 * scale, "white");
  stroke(2 * scale, "black");
  strokedText(ctx, label, x0 + barPx / 2, y - 10 * scale, {
    size: 11 * scale, color: "black", align: "center", baseline: "alphabetic",
  });
}

// ---------------------------------------------------------------------------
// Public: render the whole stack to a canvas element.
// ---------------------------------------------------------------------------

export async function renderStackToCanvas({
  layers,
  hiddenLayers,
  getDisplayModes,
  scale = 2,
  background = "#ffffff",
  showScaleBar = true,
  includeShapes = true,
} = {}) {
  const S = CANVAS_SIZE * scale;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, S, S);
  }

  const sorted = [...(layers || [])].sort((a, b) => a.layer_index - b.layer_index);
  const hidden = hiddenLayers || new Set();
  const modesFor = getDisplayModes || (() => DEFAULT_DISPLAY_MODES);

  let firstVisibleSeen = false;
  for (const layer of sorted) {
    if (hidden.has(layer.id)) continue;
    if (layer.is_shape) {
      if (!includeShapes) continue;
      drawShapeLayer(ctx, layer, scale);
    } else {
      // `isBottom` (normal blend vs multiply) tracks the first visible image layer.
      const isBottom = !firstVisibleSeen;
      firstVisibleSeen = true;
      // eslint-disable-next-line no-await-in-loop
      await drawImageLayer(ctx, layer, { scale, isBottom, modes: { ...DEFAULT_DISPLAY_MODES, ...modesFor(layer.id) } });
    }
  }

  if (showScaleBar) drawScaleBar(ctx, scale);
  return canvas;
}

function canvasToBlob(canvas, type = "image/png") {
  return new Promise((resolve) => canvas.toBlob(resolve, type));
}

function safeFilename(name) {
  return (name || "stack").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "stack";
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Public: PNG export.
// ---------------------------------------------------------------------------

export async function exportStackPng(opts) {
  const canvas = await renderStackToCanvas(opts);
  const blob = await canvasToBlob(canvas, "image/png");
  const ts = new Date().toISOString().slice(0, 10);
  triggerDownload(blob, `${safeFilename(opts.stackMeta?.name)}_${ts}.png`);
}

// ---------------------------------------------------------------------------
// Public: transparent outline-only PNG.
// Renders just the flake outlines (no base image, no fill, no shapes/annotations)
// onto a transparent background. Intended as an overlay/reference for the
// stacking microscope — only flakes with a mask (GMM remote or user-painted)
// contribute an outline; the geometry matches the on-screen canvas exactly.
// ---------------------------------------------------------------------------

export async function exportStackOutlines(opts) {
  const canvas = await renderStackToCanvas({
    ...opts,
    background: null,
    showScaleBar: false,
    includeShapes: false,
    getDisplayModes: () => ({ background: false, flake: false, outline: true }),
  });
  const blob = await canvasToBlob(canvas, "image/png");
  const ts = new Date().toISOString().slice(0, 10);
  triggerDownload(blob, `${safeFilename(opts.stackMeta?.name)}_outlines_${ts}.png`);
}

// ---------------------------------------------------------------------------
// Public: one transparent PNG per flake, bundled in a ZIP.
// Every (non-shape, non-hidden) layer is rendered alone on the *full shared
// canvas frame* in its composed position, background transparent. Overlaying
// all the PNGs reproduces the stack, but each can be positioned independently
// in the camera/stacking software. Each flake keeps its current on-canvas
// display mode (e.g. masked silhouette), so a flake with no mask exports empty.
// ---------------------------------------------------------------------------

function flakeFileName(layer, used) {
  const idx = String(layer.layer_index ?? 0).padStart(2, "0");
  const base = layer.is_local
    ? "image"
    : `${layer.flake_material || "flake"}${layer.flake_id ? `_${layer.flake_id}` : ""}`;
  const stem = safeFilename(`${idx}_${base}`);
  let name = stem;
  let k = 2;
  while (used.has(name)) name = `${stem}_${k++}`;
  used.add(name);
  return `${name}.png`;
}

export async function exportStackFlakes(opts) {
  const hidden = opts.hiddenLayers || new Set();
  const flakeLayers = [...(opts.layers || [])]
    .filter((l) => !l.is_shape && !hidden.has(l.id))
    .sort((a, b) => a.layer_index - b.layer_index);
  if (!flakeLayers.length) throw new Error("No flake layers to export.");

  const entries = [];
  const used = new Set();
  for (const layer of flakeLayers) {
    // Render this flake alone on the full transparent canvas, reusing the exact
    // composed geometry (position/rotation/scale) from the shared renderer.
    // eslint-disable-next-line no-await-in-loop
    const canvas = await renderStackToCanvas({
      ...opts,
      layers: [layer],
      hiddenLayers: new Set(),
      background: null,
      showScaleBar: false,
      includeShapes: false,
    });
    // eslint-disable-next-line no-await-in-loop
    const blob = await canvasToBlob(canvas, "image/png");
    // eslint-disable-next-line no-await-in-loop
    const buf = new Uint8Array(await blob.arrayBuffer());
    entries.push({ name: flakeFileName(layer, used), data: buf });
  }

  const zip = buildZip(entries);
  const ts = new Date().toISOString().slice(0, 10);
  triggerDownload(zip, `${safeFilename(opts.stackMeta?.name)}_flakes_${ts}.zip`);
}

// ---------------------------------------------------------------------------
// Public: printable stack report (preview image + per-layer metadata table).
// Opens a new window the user can Save-as-PDF / print from.
// ---------------------------------------------------------------------------

function describeLayer(layer) {
  if (layer.is_shape) {
    const labels = { rect: "Rectangle", freehand: "Freehand", polygon: "Polygon", line: "Line", text: "Text", distance: "Distance", angle: "Angle" };
    return { type: labels[layer.shape_type] || "Shape", detail: layer.shape_type === "text" ? (layer.shape_data?.text || "") : "" };
  }
  if (layer.is_local) return { type: "Imported image", detail: "" };
  return { type: layer.flake_material || "Flake", detail: layer.flake_id ? `#${layer.flake_id}` : "" };
}

export async function exportStackReport(opts) {
  const canvas = await renderStackToCanvas(opts);
  const dataUrl = canvas.toDataURL("image/png");
  const meta = opts.stackMeta || {};
  const sorted = [...(opts.layers || [])].sort((a, b) => a.layer_index - b.layer_index);

  // Twist angle (commented out per request): rotation difference relative to
  // the previous crystalline (flake) layer below it in the stack.
  // let prevFlakeRot = null;
  const rows = sorted.map((l) => {
    const { type, detail } = describeLayer(l);
    // let twist = "";
    // if (!l.is_shape && !l.is_local) {
    //   if (prevFlakeRot !== null) {
    //     let d = (l.rotation || 0) - prevFlakeRot;
    //     d = ((d % 360) + 360) % 360;
    //     if (d > 180) d -= 360;
    //     twist = `${d.toFixed(1)}°`;
    //   }
    //   prevFlakeRot = l.rotation || 0;
    // }
    const num = (v, suffix = "") => (v == null || v === "" ? "—" : `${typeof v === "number" ? v.toFixed(1) : v}${suffix}`);
    return `
      <tr>
        <td>${l.layer_index}</td>
        <td>${escapeHtml(type)}${detail ? ` <span class="dim">${escapeHtml(detail)}</span>` : ""}</td>
        <td>${escapeHtml(l.flake_thickness ?? "")}</td>
        <td>${l.flake_size != null ? l.flake_size.toFixed(0) + " µm²" : "—"}</td>
        <td>${num(l.pos_x)}, ${num(l.pos_y)}</td>
        <td>${num(l.rotation, "°")}</td>
      </tr>`;
  }).join("");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(meta.name || "Stack report")}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 32px; color: #1a1a1a; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #666; font-size: 13px; margin-bottom: 20px; }
  .preview { text-align: center; margin: 0 0 24px; }
  .preview img { max-width: 540px; width: 100%; border: 1px solid #ddd; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
  th { background: #f4f4f4; }
  .dim { color: #888; }
  .toolbar { margin-bottom: 16px; }
  button { font-size: 13px; padding: 6px 14px; cursor: pointer; }
  @media print { .toolbar { display: none; } body { margin: 0; } }
</style></head>
<body>
  <div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>
  <h1>${escapeHtml(meta.name || "Untitled stack")}</h1>
  <div class="meta">
    ${meta.username ? "User: " + escapeHtml(meta.username) + " · " : ""}
    ${sorted.length} layer${sorted.length === 1 ? "" : "s"} ·
    Exported ${new Date().toLocaleString()}
  </div>
  <div class="preview"><img src="${dataUrl}" alt="Stack preview"/></div>
  <table>
    <thead><tr>
      <th>#</th><th>Layer</th><th>Thickness</th><th>Size</th>
      <th>Position (x, y)</th><th>Rotation</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body></html>`;

  const win = window.open("", "_blank");
  if (!win) throw new Error("Pop-up blocked — allow pop-ups to open the report.");
  win.document.open();
  win.document.write(html);
  win.document.close();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
