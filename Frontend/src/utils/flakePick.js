// Click-to-select hit testing for stacked flake layers.
//
// Flakes are usually drawn on top of one another, so a click frequently lands
// inside several overlapping silhouettes at once. To pick the one the user most
// likely meant, we test the click against each flake's *silhouette* (not its
// rectangular bounding box) and, among every flake that actually covers the
// point, select the one with the smallest area. That single rule yields the
// behaviour the lab asked for:
//
//   • small flake A fully inside big flake B, click in A∩B  → A  (A is smaller)
//   • click on B where A isn't                              → B  (only B covers)
//   • A and B partially overlap, click in A∩B               → A  (A is smaller)
//   • N flakes overlapping a point                          → smallest covering one
//
// Hit testing inverts the same display transform used by LayerImage /
// utils/overlap.js: a flake's mask PNG is width-scaled to getDisplayWidthPx,
// placed so its centroid lands at (HALF + pos_x, HALF + pos_y), and rotated
// about that centroid. Inverting that maps a canvas point back into the mask's
// own pixels, where we sample the alpha channel.

import {
  MAGNIFICATION_CALIBRATION,
  REFERENCE_FILENAME,
  CANONICAL_DISPLAY_WIDTH,
  getDisplayWidthPx,
} from "./calibration";
import { flakeMaskedUrl, flakeImageUrl, fetchFlakeCentroid, resolveLocalImageUrl } from "./api";
import { layerHasSilhouette } from "./overlap";

const CANVAS_SIZE = 700;
const HALF = CANVAS_SIZE / 2;
const REF_CAL = MAGNIFICATION_CALIBRATION[REFERENCE_FILENAME];
const UM_PER_CANVAS_PX = (REF_CAL.um_per_px * REF_CAL.native_w) / CANONICAL_DISPLAY_WIDTH;

// Alpha (0..255) above which a mask pixel counts as "inside the flake". Low
// enough to include soft anti-aliased edges, high enough to ignore stray noise.
const ALPHA_HIT = 24;
// Cap the sampled mask resolution; hit testing doesn't need full native pixels
// and a smaller buffer keeps the per-flake getImageData cheap.
const SAMPLE_MAX = 600;

function baseFilenameOf(layer) {
  return layer.canvas_base_filename || "raw_img.png";
}

function maskOptsOf(layer) {
  const bf = baseFilenameOf(layer);
  const hasUserMask = !!(layer.masks && layer.masks[bf]);
  return hasUserMask ? { layerId: layer.id, imageFilename: bf } : undefined;
}

// A flake layer is a selection candidate; shapes are handled by their own DOM
// hit area and aren't part of this overlapping-silhouette problem.
function isFlakeCandidate(layer) {
  return layer && !layer.is_shape;
}

// The image whose pixels define the clickable region:
//   • silhouette flake → its masked (transparent-background) PNG → alpha = shape
//   • local import     → the imported image (treated as an opaque rectangle)
//   • flake w/o mask   → its base image    (treated as an opaque rectangle)
function primaryImageUrl(layer) {
  if (layer.is_local) return resolveLocalImageUrl(layer.local_image_url);
  if (layerHasSilhouette(layer)) return flakeMaskedUrl(layer.flake_path, maskOptsOf(layer));
  return flakeImageUrl(layer.flake_path, baseFilenameOf(layer));
}

// ── Async caches (keyed by content, independent of the live transform) ───────
const samplerCache = new Map();  // url -> { alpha, sw, sh, nw, nh, areaPx } | null
const centroidCache = new Map(); // key -> centroid

function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous"; // keep the offscreen canvas un-tainted/readable
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Rasterize a mask/image once to a downscaled offscreen buffer and keep its
// alpha channel for point sampling. `useAlpha` is false for opaque rectangles
// (local imports, maskless flakes) where every in-bounds pixel is a hit.
async function loadSampler(url, useAlpha) {
  if (samplerCache.has(url)) return samplerCache.get(url);
  const img = await loadImage(url);
  if (!img || !img.naturalWidth) {
    samplerCache.set(url, null);
    return null;
  }
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

  let alpha = null;
  let areaPx = sw * sh;
  if (useAlpha) {
    const data = ctx.getImageData(0, 0, sw, sh).data;
    alpha = new Uint8Array(sw * sh);
    areaPx = 0;
    for (let p = 0, a = 3; p < alpha.length; p++, a += 4) {
      const v = data[a];
      alpha[p] = v;
      if (v >= ALPHA_HIT) areaPx++;
    }
  }
  const sampler = { alpha, sw, sh, nw, nh, areaPx };
  samplerCache.set(url, sampler);
  return sampler;
}

async function getCentroid(layer) {
  if (layer.is_local) return { cx_pct: 50, cy_pct: 50 };
  const opts = maskOptsOf(layer);
  const key = `${layer.flake_path}|${opts ? `${opts.layerId}:${opts.imageFilename}` : "remote"}`;
  if (centroidCache.has(key)) return centroidCache.get(key);
  try {
    const c = await fetchFlakeCentroid(layer.flake_path, opts);
    centroidCache.set(key, c);
    return c;
  } catch {
    return { cx_pct: 50, cy_pct: 50 };
  }
}

// Per-layer hit-test inputs, resolved asynchronously and memoised so the actual
// pick on pointerdown is synchronous. Keyed by a *content* signature (not the
// layer id) so a re-painted mask or swapped base image never returns stale
// geometry. The geometry is transform-independent, so it needn't refresh on drag.
const GEOM_CACHE_CAP = 64;
const layerGeomCache = new Map(); // sig -> { sampler, originX, originY, displayWidth, useAlpha }

// Content signature: everything the resolved geometry depends on, but not the
// live position/rotation (which the pick math applies fresh each click).
function geomKey(layer) {
  const bf = baseFilenameOf(layer);
  const mask = (layer.masks && layer.masks[bf]) || "";
  const src = layer.is_local ? layer.local_image_url : layer.flake_path;
  return `${layer.is_local ? "L" : "F"}:${src}:${bf}:${mask}`;
}

function cacheGeom(key, geom) {
  layerGeomCache.set(key, geom);
  // Simple LRU-ish bound: drop the oldest entry once over the cap.
  if (layerGeomCache.size > GEOM_CACHE_CAP) {
    layerGeomCache.delete(layerGeomCache.keys().next().value);
  }
}

async function resolveLayerGeom(layer) {
  const useAlpha = !layer.is_local && layerHasSilhouette(layer);
  const [sampler, centroid] = await Promise.all([
    loadSampler(primaryImageUrl(layer), useAlpha),
    getCentroid(layer),
  ]);
  const geom = {
    sampler,
    originX: centroid.cx_pct ?? 50,
    originY: centroid.cy_pct ?? 50,
    displayWidth: layer.is_local ? 900 : getDisplayWidthPx(baseFilenameOf(layer)),
    useAlpha,
  };
  cacheGeom(geomKey(layer), geom);
  return geom;
}

/**
 * Pre-resolve hit-test geometry for the given flake layers so a later
 * pickFlakeAt() runs synchronously. Cheap to call on every layer-set change:
 * results are content-cached and don't depend on position/rotation.
 */
export async function warmFlakePicker(layers) {
  await Promise.all(
    (layers || [])
      .filter(isFlakeCandidate)
      .map((l) => (layerGeomCache.has(geomKey(l)) ? null : resolveLayerGeom(l)))
  );
}

// Map a canvas-space point into a layer's normalized image coords (u, v) ∈ unit
// square when inside the displayed rectangle, by inverting translate→rotate→scale.
function toLayerUV(point, layer, geom) {
  const { sampler, originX, originY, displayWidth: W } = geom;
  if (!sampler) return null;
  const H = W * (sampler.nh / sampler.nw);

  const vx = point.x - (HALF + (layer.pos_x || 0));
  const vy = point.y - (HALF + (layer.pos_y || 0));
  const rot = ((layer.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  // Inverse rotation R(-rot).
  const lx = vx * cos + vy * sin;
  const ly = -vx * sin + vy * cos;

  const u = lx / W + originX / 100;
  const v = ly / H + originY / 100;
  return { u, v, W, H };
}

// Approximate flake area in µm² for ranking. Prefer the catalogued GMM size;
// otherwise derive it from the sampled silhouette (or the full rectangle).
function layerAreaUm2(layer, geom) {
  if (typeof layer.flake_size === "number" && layer.flake_size > 0) return layer.flake_size;
  const { sampler, displayWidth: W } = geom;
  if (!sampler) return Infinity;
  const H = W * (sampler.nh / sampler.nw);
  // Canvas px² covered by one sampler pixel, then → µm².
  const pxCanvasArea = (W / sampler.sw) * (H / sampler.sh);
  return sampler.areaPx * pxCanvasArea * UM_PER_CANVAS_PX * UM_PER_CANVAS_PX;
}

/**
 * Pick the flake the user meant by clicking at `point` (canvas-space px).
 *
 * Returns the chosen layer's id, or null if the click hit no flake. Among all
 * flakes whose silhouette covers the point, the smallest-area one wins; ties
 * (e.g. equal catalogued sizes, or rectangle fallbacks) break toward the
 * topmost layer so the visibly-front flake is preferred.
 *
 * Synchronous: relies on warmFlakePicker() having resolved each layer's
 * geometry. Layers whose geometry isn't cached yet are skipped this click.
 */
export function pickFlakeAt(layers, point) {
  let best = null; // { id, area, layer_index }
  for (const layer of layers) {
    if (!isFlakeCandidate(layer)) continue;
    const geom = layerGeomCache.get(geomKey(layer));
    if (!geom || !geom.sampler) continue;

    const uv = toLayerUV(point, layer, geom);
    if (!uv) continue;
    if (uv.u < 0 || uv.u > 1 || uv.v < 0 || uv.v > 1) continue; // outside the image rect

    if (geom.useAlpha) {
      const sx = Math.min(geom.sampler.sw - 1, Math.max(0, Math.floor(uv.u * geom.sampler.sw)));
      const sy = Math.min(geom.sampler.sh - 1, Math.max(0, Math.floor(uv.v * geom.sampler.sh)));
      if (geom.sampler.alpha[sy * geom.sampler.sw + sx] < ALPHA_HIT) continue; // transparent → miss
    }

    const area = layerAreaUm2(layer, geom);
    if (
      !best ||
      area < best.area - 1e-6 ||
      (Math.abs(area - best.area) <= 1e-6 && (layer.layer_index || 0) > best.layer_index)
    ) {
      best = { id: layer.id, area, layer_index: layer.layer_index || 0 };
    }
  }
  return best ? best.id : null;
}
