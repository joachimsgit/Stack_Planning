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
