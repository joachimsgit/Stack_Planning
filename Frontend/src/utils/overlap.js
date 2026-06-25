// Overlap / contact-area computation between two flake layers.
//
// Each flake is rasterized to its own offscreen canvas using the *same* display
// transform as the live canvas (see LayerImage / stackExport.drawImageLayer):
// the mask's transparent-background PNG is placed so its centroid lands at
// (CANVAS_SIZE/2 + pos_x, CANVAS_SIZE/2 + pos_y), rotated about that centroid,
// and width-scaled to getDisplayWidthPx(baseFilename). The alpha channel then
// marks flake pixels; intersecting the two alpha masks and counting pixels gives
// the contact area, converted to µm² via the shared canvas calibration.

import {
  MAGNIFICATION_CALIBRATION,
  REFERENCE_FILENAME,
  CANONICAL_DISPLAY_WIDTH,
  getDisplayWidthPx,
  baseSupportsRemoteOverlay,
} from "./calibration";
import { flakeMaskedUrl, fetchFlakeCentroid } from "./api";

const CANVAS_SIZE = 700;
const HALF = CANVAS_SIZE / 2;
const REF_CAL = MAGNIFICATION_CALIBRATION[REFERENCE_FILENAME];
const UM_PER_CANVAS_PX = (REF_CAL.um_per_px * REF_CAL.native_w) / CANONICAL_DISPLAY_WIDTH;

function baseFilenameOf(layer) {
  return layer.canvas_base_filename || "raw_img.png";
}

function maskOptsOf(layer) {
  const baseFilename = baseFilenameOf(layer);
  const hasUserMask = !!(layer.masks && layer.masks[baseFilename]);
  return hasUserMask ? { layerId: layer.id, imageFilename: baseFilename } : undefined;
}

// True when a layer has a silhouette we can measure: a flake with either a
// user-painted mask or a GMM remote mask (raw_img.png / eval_img.jpg). Local
// imports and shapes have no mask, so overlap is undefined for them.
export function layerHasSilhouette(layer) {
  if (!layer || layer.is_shape || layer.is_local || !layer.flake_path) return false;
  const baseFilename = baseFilenameOf(layer);
  const hasUserMask = !!(layer.masks && layer.masks[baseFilename]);
  return hasUserMask || baseSupportsRemoteOverlay(baseFilename);
}

function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous"; // keep the canvas readable (un-tainted)
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Centroids depend only on the flake + its mask, not on the live transform, so
// cache them to avoid a network round-trip on every drag-settle recompute.
const centroidCache = new Map();
async function getCentroid(layer) {
  const opts = maskOptsOf(layer);
  const key = `${layer.flake_path}|${opts ? `${opts.layerId}:${opts.imageFilename}` : "remote"}`;
  if (centroidCache.has(key)) return centroidCache.get(key);
  const c = await fetchFlakeCentroid(layer.flake_path, opts);
  centroidCache.set(key, c);
  return c;
}

// Rasterize one flake's silhouette; returns the ImageData (RGBA) at S×S, or null.
async function rasterizeSilhouette(layer, scale) {
  const opts = maskOptsOf(layer);
  const img = await loadImage(flakeMaskedUrl(layer.flake_path, opts));
  if (!img || !img.naturalWidth) return null;

  const centroid = await getCentroid(layer);
  const originX = centroid.cx_pct ?? 50;
  const originY = centroid.cy_pct ?? 50;
  const displayWidth = getDisplayWidthPx(baseFilenameOf(layer));

  const S = Math.round(CANVAS_SIZE * scale);
  const W = displayWidth * scale;
  const H = W * (img.naturalHeight / img.naturalWidth);

  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  // High-quality smoothing so the resampled alpha conserves the flake's area
  // (its integral) rather than biasing the edges.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate((HALF + (layer.pos_x || 0)) * scale, (HALF + (layer.pos_y || 0)) * scale);
  ctx.rotate(((layer.rotation || 0) * Math.PI) / 180);
  ctx.drawImage(img, (-originX / 100) * W, (-originY / 100) * H, W, H);
  return ctx.getImageData(0, 0, S, S);
}

/**
 * Compute the overlapping contact area of two flake layers.
 *
 * @returns {Promise<null | {
 *   overlapUm2: number, areaAUm2: number, areaBUm2: number, fractionOfSmaller: number
 * }>} null if either silhouette is unavailable.
 */
export async function computeOverlap(layerA, layerB, { scale = 3 } = {}) {
  if (!layerHasSilhouette(layerA) || !layerHasSilhouette(layerB)) return null;

  const [ia, ib] = await Promise.all([
    rasterizeSilhouette(layerA, scale),
    rasterizeSilhouette(layerB, scale),
  ]);
  if (!ia || !ib) return null;

  // Treat alpha as fractional pixel coverage (0..1) rather than a hard in/out
  // threshold: anti-aliased edge pixels then contribute their true partial area,
  // so the measured silhouette matches the flake's real area even when it spans
  // only a few hundred pixels. The intersection of two fractional masks is the
  // per-pixel min of their coverage.
  const a = ia.data;
  const b = ib.data;
  let sumA = 0;
  let sumB = 0;
  let sumBoth = 0;
  for (let i = 3; i < a.length; i += 4) {
    const ca = a[i] / 255;
    const cb = b[i] / 255;
    sumA += ca;
    sumB += cb;
    sumBoth += ca < cb ? ca : cb;
  }

  const pxUm2 = (UM_PER_CANVAS_PX / scale) ** 2;
  const overlapUm2 = sumBoth * pxUm2;
  const areaAUm2 = sumA * pxUm2;
  const areaBUm2 = sumB * pxUm2;
  const smaller = Math.min(areaAUm2, areaBUm2);
  return {
    overlapUm2,
    areaAUm2,
    areaBUm2,
    fractionOfSmaller: smaller > 0 ? overlapUm2 / smaller : 0,
  };
}
