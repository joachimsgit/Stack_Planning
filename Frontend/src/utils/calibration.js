// Microscope calibration per base image filename.
// um_per_px values supplied by the rig owner. native_w is the native capture
// width in pixels; 1944 matches the 20x reference that predates this module.
// If a revisit capture comes back at a different width, LayerImage reads the
// actual naturalWidth and rescales against this table.
export const MAGNIFICATION_CALIBRATION = {
  "raw_img.png":  { um_per_px: 0.3844, native_w: 1944, label: "Raw" },
  "eval_img.jpg": { um_per_px: 0.3844, native_w: 1944, label: "Eval" },
  "2.5x.png":     { um_per_px: 3.0754, native_w: 1944, label: "2.5×" },
  "5x.png":       { um_per_px: 1.5377, native_w: 1944, label: "5×" },
  "20x.png":      { um_per_px: 0.3844, native_w: 1944, label: "20×" },
  "50x.png":      { um_per_px: 0.1538, native_w: 1944, label: "50×" },
  "100x.png":     { um_per_px: 0.0769, native_w: 1944, label: "100×" },
};

export const REFERENCE_FILENAME = "20x.png";
export const CANONICAL_DISPLAY_WIDTH = 900;

const REF = MAGNIFICATION_CALIBRATION[REFERENCE_FILENAME];
const REF_UM = REF.um_per_px * REF.native_w;

// Display width in canvas pixels for a given base image, so that physical µm
// size matches the reference (20x @ 900 px) regardless of magnification.
export function getDisplayWidthPx(filename, canonical = CANONICAL_DISPLAY_WIDTH) {
  const cal = MAGNIFICATION_CALIBRATION[filename] || REF;
  const um = cal.um_per_px * cal.native_w;
  return canonical * (um / REF_UM);
}

// Filenames in the recommended selector order.
export const BASE_IMAGE_ORDER = [
  "raw_img.png",
  "eval_img.jpg",
  "2.5x.png",
  "5x.png",
  "20x.png",
  "50x.png",
  "100x.png",
];

// Overlay modes (Flake / Outline) only work against the GMM-supplied mask when
// the base is raw_img.png / eval_img.jpg (same pixel space as flake_mask.png).
// Revisit magnifications require a user-painted mask for overlays.
export function baseSupportsRemoteOverlay(filename) {
  return filename === "raw_img.png" || filename === "eval_img.jpg";
}
