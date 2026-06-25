"""User-guided watershed segmentation of a flake from foreground/background scribbles.

Callers pass the base image bytes plus stroke polylines in *native* pixel coords.
We rasterise markers (1 = background, 2 = flake), run cv2.watershed, keep the
largest connected foreground blob, and return a clean 0/255 PNG mask.
"""
from io import BytesIO
import cv2
import numpy as np
from PIL import Image


def _rasterise_strokes(markers, strokes, label, brush_radius):
    """Paint each stroke (a polyline) onto `markers` using `label`.

    A stroke with a single point becomes a filled circle; with multiple points
    we draw thick line segments and cap each endpoint with a circle so short
    strokes match the user's brush width exactly.
    """
    for stroke in strokes:
        if not stroke:
            continue
        pts = [(int(round(x)), int(round(y))) for x, y in stroke]
        if len(pts) == 1:
            cv2.circle(markers, pts[0], brush_radius, label, thickness=-1)
            continue
        for a, b in zip(pts[:-1], pts[1:]):
            cv2.line(markers, a, b, label, thickness=brush_radius * 2)
        for p in pts:
            cv2.circle(markers, p, brush_radius, label, thickness=-1)


def run_watershed(image_bytes, foreground_strokes, background_strokes, brush_radius=15):
    """Return a binary mask (0/255 PNG bytes) produced by cv2.watershed.

    Parameters
    ----------
    image_bytes : bytes
        Raw image bytes for the base image the user painted on.
    foreground_strokes, background_strokes : list[list[tuple[float, float]]]
        Each stroke is a polyline in native-image pixel coordinates.
    brush_radius : int
        Radius in native pixels. Must be >= 1.
    """
    brush_radius = max(1, int(brush_radius))

    pil = Image.open(BytesIO(image_bytes)).convert("RGB")
    rgb = np.array(pil)                              # (H, W, 3) uint8
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    h, w = bgr.shape[:2]

    markers = np.zeros((h, w), dtype=np.int32)
    _rasterise_strokes(markers, background_strokes, label=1, brush_radius=brush_radius)
    _rasterise_strokes(markers, foreground_strokes, label=2, brush_radius=brush_radius)

    if not np.any(markers == 2) or not np.any(markers == 1):
        raise ValueError("Both foreground and background scribbles are required.")

    cv2.watershed(bgr, markers)

    flake = (markers == 2).astype(np.uint8)

    # Keep only the largest connected component of flake pixels to kill stray blobs.
    num, labels, stats, _ = cv2.connectedComponentsWithStats(flake, connectivity=8)
    if num > 1:
        # index 0 is background; pick the component with the largest area among the rest.
        largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        flake = (labels == largest).astype(np.uint8)

    # Gentle morphological close to smooth ragged boundaries from watershed.
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    flake = cv2.morphologyEx(flake, cv2.MORPH_CLOSE, kernel)

    mask_img = Image.fromarray((flake * 255).astype(np.uint8), mode="L")
    out = BytesIO()
    mask_img.save(out, format="PNG")
    return out.getvalue()


# ---------------------------------------------------------------------------
# Auto-watershed: locate the GMM-detected flake in a high-magnification image
# by *shape*, then refine with watershed.
#
# The old heuristic assumed the flake sat in the centre of the frame, which
# breaks at 50x/100x where the flake of interest is off-centre and often not the
# largest object. Instead we use the GMM ``flake_mask.png`` as a shape template:
# segment the target image into candidate blobs, then pick the one whose outline
# best matches the detected flake (cv2.matchShapes — invariant to scale, rotation
# and position). An optional size prior, derived from the magnification ratio,
# breaks ties so a big neighbouring flake isn't chosen.
# ---------------------------------------------------------------------------

def _mode_color(rgb, q=8):
    """Most common quantised colour — the substrate dominates the frame, so the
    colour mode is the background we measure contrast against."""
    packed = (
        (rgb[:, :, 0].astype(np.int32) // q) * (32 * 32)
        + (rgb[:, :, 1].astype(np.int32) // q) * 32
        + (rgb[:, :, 2].astype(np.int32) // q)
    ).ravel()
    mode_packed = int(np.bincount(packed).argmax())
    return np.array(
        [(mode_packed // (32 * 32)) * q, ((mode_packed // 32) % 32) * q, (mode_packed % 32) * q],
        dtype=np.float32,
    )


def _largest_contour(mask_uint8):
    cnts, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    return max(cnts, key=cv2.contourArea)


def auto_watershed(image_bytes, eval_mask_bytes, size_scale=None, size_weight=0.6):
    """Return a 0/255 PNG mask for the flake in ``image_bytes``.

    Parameters
    ----------
    image_bytes : bytes
        The target base image to segment (e.g. ``50x.png`` / ``100x.png``).
    eval_mask_bytes : bytes
        The GMM ``flake_mask.png`` whose outline identifies the flake of interest.
    size_scale : float | None
        Linear pixel-size ratio (mask -> target). When provided, a soft size
        prior favours the candidate whose area matches the flake's expected size
        at the target magnification. ``None`` => shape-only selection.
    size_weight : float
        Relative weight of the size prior against the shape distance.
    """
    pil = Image.open(BytesIO(image_bytes)).convert("RGB")
    rgb = np.array(pil)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    h, w = bgr.shape[:2]
    img_area = float(h * w)

    # --- 1. Describe the detected flake by its eval-mask contour -------------
    eval_mask = np.array(Image.open(BytesIO(eval_mask_bytes)).convert("L"))
    eval_bin = (eval_mask > 128).astype(np.uint8)
    if not eval_bin.any():                       # tolerate an inverted mask
        eval_bin = (eval_mask <= 128).astype(np.uint8)
    eval_cnt = _largest_contour(eval_bin)
    if eval_cnt is None or cv2.contourArea(eval_cnt) < 1:
        raise ValueError("Eval mask is empty — cannot derive flake shape.")
    expected_area = cv2.contourArea(eval_cnt) * (size_scale ** 2) if size_scale else None

    # --- 2. Candidate blobs from a background-distance saliency map ----------
    bg = _mode_color(rgb)
    dist = np.sqrt(((rgb.astype(np.float32) - bg) ** 2).sum(axis=2))
    dist_u8 = cv2.normalize(dist, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    _, fg = cv2.threshold(dist_u8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, kernel)

    num, labels, stats, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
    min_area = max(25.0, 0.0002 * img_area)      # drop specks / noise
    max_area = 0.85 * img_area                   # drop background-sized blobs

    candidates = []                              # (label, area, touches_border)
    for i in range(1, num):
        x, y, bw, bh, area = stats[i]
        if area < min_area or area > max_area:
            continue
        touches = x == 0 or y == 0 or x + bw == w or y + bh == h
        candidates.append((i, float(area), bool(touches)))

    # Prefer fully-in-frame blobs; fall back to border-touchers only if needed
    # (a flake clipped by the frame edge is better than nothing).
    pool = [c for c in candidates if not c[2]] or candidates
    if not pool:
        raise ValueError("No flake-like region found in the target image.")

    # --- 3. Pick the candidate that best matches the flake's shape -----------
    best_label, best_score = None, float("inf")
    for label, area, _touches in pool:
        cnt = _largest_contour((labels == label).astype(np.uint8))
        if cnt is None:
            continue
        score = cv2.matchShapes(eval_cnt, cnt, cv2.CONTOURS_MATCH_I1, 0.0)
        if expected_area:
            score += size_weight * abs(area - expected_area) / expected_area
        if score < best_score:
            best_score, best_label = score, label
    if best_label is None:
        raise ValueError("Could not match the flake shape to any candidate.")

    flake_blob = (labels == best_label).astype(np.uint8)

    # --- 4. Seed sure-fg / sure-bg from the winner and refine ---------------
    sure_fg = cv2.erode(flake_blob, kernel, iterations=3)
    if not sure_fg.any():                        # tiny flake: keep the blob itself
        sure_fg = flake_blob
    outside = cv2.dilate(flake_blob, kernel, iterations=8) == 0
    sure_bg = (outside & (dist_u8 < 64)).astype(np.uint8)   # substrate-like & far
    if not sure_bg.any():
        sure_bg = outside.astype(np.uint8)

    markers = np.zeros((h, w), dtype=np.int32)
    markers[sure_bg.astype(bool)] = 1
    markers[sure_fg.astype(bool)] = 2
    if not np.any(markers == 1) or not np.any(markers == 2):
        raise ValueError("Auto marker placement failed.")

    cv2.watershed(bgr, markers)
    flake = (markers == 2).astype(np.uint8)

    num2, labels2, stats2, _ = cv2.connectedComponentsWithStats(flake, connectivity=8)
    if num2 > 1:
        largest = 1 + int(np.argmax(stats2[1:, cv2.CC_STAT_AREA]))
        flake = (labels2 == largest).astype(np.uint8)
    flake = cv2.morphologyEx(flake, cv2.MORPH_CLOSE, kernel)

    mask_img = Image.fromarray((flake * 255).astype(np.uint8), mode="L")
    out = BytesIO()
    mask_img.save(out, format="PNG")
    return out.getvalue()
