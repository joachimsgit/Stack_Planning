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

// Alpha above this counts as "flake present" (tolerates anti-aliased edges).
const ALPHA_THRESHOLD = 16;

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
export async function computeOverlap(layerA, layerB, { scale = 2 } = {}) {
  if (!layerHasSilhouette(layerA) || !layerHasSilhouette(layerB)) return null;

  const [ia, ib] = await Promise.all([
    rasterizeSilhouette(layerA, scale),
    rasterizeSilhouette(layerB, scale),
  ]);
  if (!ia || !ib) return null;

  const a = ia.data;
  const b = ib.data;
  let countA = 0;
  let countB = 0;
  let countBoth = 0;
  for (let i = 3; i < a.length; i += 4) {
    const av = a[i] > ALPHA_THRESHOLD;
    const bv = b[i] > ALPHA_THRESHOLD;
    if (av) countA++;
    if (bv) countB++;
    if (av && bv) countBoth++;
  }

  const pxUm2 = (UM_PER_CANVAS_PX / scale) ** 2;
  const overlapUm2 = countBoth * pxUm2;
  const areaAUm2 = countA * pxUm2;
  const areaBUm2 = countB * pxUm2;
  const smaller = Math.min(areaAUm2, areaBUm2);
  return {
    overlapUm2,
    areaAUm2,
    areaBUm2,
    fractionOfSmaller: smaller > 0 ? overlapUm2 / smaller : 0,
  };
}
