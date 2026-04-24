import json
import os
import time
import gzip
import uuid
from io import BytesIO
from pathlib import Path
from cachetools import LRUCache

# Minimal 1×1 transparent PNG returned when an upstream image is unavailable.
# This prevents ERR_BLOCKED_BY_ORB: browsers block non-image MIME types for <img> requests.
_TRANSPARENT_PNG = (
    b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
    b'\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cb\x00\x01'
    b'\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
)

# Bounded LRU caches — evict oldest entries once the limit is reached.
_crop_cache: LRUCache = LRUCache(maxsize=512)
_masked_cache: LRUCache = LRUCache(maxsize=256)
_outline_cache: LRUCache = LRUCache(maxsize=256)
_centroid_cache: LRUCache = LRUCache(maxsize=512)

# Separate caches for user-mask variants, keyed by (layer_id, image_filename, mask_mtime).
# Kept separate so the remote-mask caches stay untouched when users generate masks.
_user_masked_cache: LRUCache = LRUCache(maxsize=128)
_user_outline_cache: LRUCache = LRUCache(maxsize=128)
_user_centroid_cache: LRUCache = LRUCache(maxsize=128)

from flask import Flask, request, jsonify, Response
from flask_cors import CORS

from sqlalchemy.orm import subqueryload
from database.database import create_db_engine, create_session_factory, init_db, run_migrations
from database.models import User, Stack, StackLayer, FlakeNote, LayerMask
from database import filesystem_mirror as fs_mirror
from services import flake_proxy

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")
with open(CONFIG_PATH) as f:
    config = json.load(f)

# Environment variables override config.json (used in Docker/production)
for _env_key, _cfg_key in [
    ("GMM_API_URL", "flake_api_url"),
    ("GMM_IMAGE_URL", "image_url"),
    ("DATABASE_PATH", "database_path"),
    ("FS_ROOT", "fs_root"),
    ("SCANS_ROOT", "scans_root"),
]:
    _val = os.environ.get(_env_key)
    if _val is not None:
        config[_cfg_key] = _val

# ---------------------------------------------------------------------------
# Database + filesystem mirror
# ---------------------------------------------------------------------------

engine = create_db_engine(config)
init_db(engine)
run_migrations(engine)
db_session = create_session_factory(engine)

# Filesystem mirror roots. `fs_root` holds the browsable user/stack tree
# (defaults to the directory containing the SQLite file). `scans_root` is
# the read-only mount of the GMM scans volume used to source flake images.
_db_path = config.get("database_path", "stacks.db")
if not os.path.isabs(_db_path):
    _db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), _db_path))
FS_ROOT = Path(config.get("fs_root") or os.path.dirname(_db_path))
SCANS_ROOT = Path(config.get("scans_root", "/scans"))
FS_ROOT.mkdir(parents=True, exist_ok=True)

# Uploads directory for user-imported layer images (persist across sessions).
UPLOADS_DIR = FS_ROOT / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_UPLOAD_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"}

# User-painted watershed masks live under uploads/masks so the existing
# /uploads/<path> route serves them without new plumbing.
MASKS_DIR = UPLOADS_DIR / "masks"
MASKS_DIR.mkdir(parents=True, exist_ok=True)

# Self-healing metadata re-mirror on boot. Does not recopy flake images.
fs_mirror.resync_all(db_session, FS_ROOT)


def _scans_root_if_present():
    """Return SCANS_ROOT only if it actually exists — local dev may not have it."""
    return SCANS_ROOT if SCANS_ROOT.is_dir() else None

# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------

app = Flask(__name__)
CORS(app)


def json_response(data, status=200):
    """Return gzip-compressed JSON, mirroring the existing GMM backend pattern."""
    payload = json.dumps(data).encode("utf-8")
    compressed = gzip.compress(payload)
    return Response(
        compressed,
        status=status,
        mimetype="application/json",
        headers={"Content-Encoding": "gzip"},
    )


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.route("/", methods=["GET"])
def health():
    return json_response({"status": "ok", "service": "stack-planning"})


# ---------------------------------------------------------------------------
# Proxy endpoints (forward to 2DMatGMM backend)
# ---------------------------------------------------------------------------

@app.route("/proxy/flakes", methods=["GET"])
def proxy_flakes():
    params = dict(request.args)
    # Date-range params are handled here, not forwarded to the GMM API
    scan_time_min = params.pop("scan_time_min", None)
    scan_time_max = params.pop("scan_time_max", None)
    flake_favorite = params.pop("flake_favorite", None)
    try:
        data = flake_proxy.get_flakes(config, params)
    except Exception as e:
        return json_response({"error": str(e)}, 502)
    if scan_time_min is not None:
        try:
            ts_min = float(scan_time_min)
            data = [f for f in data if f.get("scan_time") is not None and f["scan_time"] >= ts_min]
        except ValueError:
            pass
    if scan_time_max is not None:
        try:
            ts_max = float(scan_time_max)
            data = [f for f in data if f.get("scan_time") is not None and f["scan_time"] <= ts_max]
        except ValueError:
            pass
    if flake_favorite is not None and flake_favorite.lower() == "true":
        data = [f for f in data if f.get("flake_favorite") is True]
    return json_response(data)


@app.route("/proxy/materials", methods=["GET"])
def proxy_materials():
    try:
        data = flake_proxy.get_materials(config)
    except Exception as e:
        return json_response({"error": str(e)}, 502)
    return json_response(data)


@app.route("/proxy/combinations", methods=["GET"])
def proxy_combinations():
    try:
        data = flake_proxy.get_combinations(config)
    except Exception as e:
        return json_response({"error": str(e)}, 502)
    return json_response(data)


@app.route("/proxy/scan-users", methods=["GET"])
def proxy_scan_users():
    try:
        data = flake_proxy.get_scan_users(config)
    except Exception as e:
        return json_response({"error": str(e)}, 502)
    return json_response(data)


@app.route("/proxy/image", methods=["GET"])
def proxy_image():
    """Proxy a flake image via the GMM Nginx image server to avoid browser ORB blocking.
    Always returns image bytes (or a transparent PNG placeholder) so the browser
    never receives a non-image MIME type for an <img> src request.
    """
    import requests as req
    flake_path = request.args.get("flake_path", "")
    filename = request.args.get("filename", "eval_img.jpg")
    if not flake_path:
        return Response(_TRANSPARENT_PNG, content_type="image/png")

    image_base = config.get("image_url", "http://134.61.8.242/images/").rstrip("/")
    flake_path = flake_path.replace("\\", "/").strip("/")
    url = f"{image_base}/{flake_path}/{filename}"
    try:
        resp = req.get(url, timeout=10)
        resp.raise_for_status()
        content_type = resp.headers.get("Content-Type", "image/jpeg")
        return Response(resp.content, content_type=content_type)
    except Exception as e:
        app.logger.warning("Image proxy failed for %s: %s", url, e)
        return Response(_TRANSPARENT_PNG, content_type="image/png")


# ---------------------------------------------------------------------------
# User-mask helpers (shared by proxy_masked / outline / crop / centroid when a
# per-layer watershed mask has been saved).
# ---------------------------------------------------------------------------

def _mask_url_to_path(mask_url: str):
    """Translate a stored mask_url ('/uploads/masks/<uuid>.png') to a filesystem path.

    Returns None if the URL doesn't point inside MASKS_DIR — guards against traversal.
    """
    if not mask_url:
        return None
    prefix = "/uploads/"
    if not mask_url.startswith(prefix):
        return None
    rel = mask_url[len(prefix):].replace("\\", "/").lstrip("/")
    p = (UPLOADS_DIR / rel).resolve()
    try:
        p.relative_to(UPLOADS_DIR.resolve())
    except ValueError:
        return None
    return p if p.is_file() else None


def _lookup_user_mask(layer_id, image_filename):
    """Return (LayerMask, Path, mtime) if a saved user mask exists, else None."""
    if not layer_id or not image_filename:
        return None
    session = db_session()
    try:
        row = (
            session.query(LayerMask)
            .filter_by(layer_id=layer_id, image_filename=image_filename)
            .one_or_none()
        )
    finally:
        db_session.remove()
    if row is None:
        return None
    path = _mask_url_to_path(row.mask_url)
    if path is None:
        return None
    return row, path, path.stat().st_mtime


def _fetch_base_image(flake_path, image_filename):
    """Fetch a base image (e.g. 20x.png) from the GMM image server as bytes."""
    import requests as req
    image_base = config.get("image_url", "").rstrip("/")
    clean_path = flake_path.replace("\\", "/").strip("/")
    url = f"{image_base}/{clean_path}/{image_filename}"
    resp = req.get(url, timeout=15)
    resp.raise_for_status()
    return resp.content


@app.route("/proxy/crop", methods=["GET"])
def proxy_crop():
    """Return a tightly-cropped RGBA PNG of the flake with transparent background.

    Loads eval_img.jpg and flake_mask.png, detects the flake pixels from the mask
    (handling both 0/1 and 0/255 value ranges, and both normal and inverted masks),
    sets background pixels to alpha=0, crops to the bounding box + padding, and
    returns a PNG with transparent background so layers composite cleanly.
    Results are cached in memory.
    """
    import requests as req
    import numpy as np
    from PIL import Image as PILImage

    flake_path = request.args.get("flake_path", "")
    try:
        padding = int(request.args.get("padding", 30))
    except ValueError:
        return json_response({"error": "padding must be an integer"}, 400)

    layer_id = request.args.get("layer_id", type=int)
    image_filename = request.args.get("image_filename", "")

    if not flake_path:
        return Response(_TRANSPARENT_PNG, content_type="image/png")

    user_info = _lookup_user_mask(layer_id, image_filename)
    if user_info is not None:
        _row, mask_path, mtime = user_info
        cache_key_user = ("crop", layer_id, image_filename, mtime, padding)
        if cache_key_user in _user_masked_cache:
            return Response(_user_masked_cache[cache_key_user], content_type="image/png")
        try:
            img_bytes = _fetch_base_image(flake_path, image_filename)
            img_arr = np.array(PILImage.open(BytesIO(img_bytes)).convert("RGB"))
            mask_arr = np.array(PILImage.open(mask_path).convert("L"))
            flake_pixels = mask_arr > 128
            if not flake_pixels.any():
                return Response(_TRANSPARENT_PNG, content_type="image/png")
            h, w = mask_arr.shape
            rows_any = np.any(flake_pixels, axis=1)
            cols_any = np.any(flake_pixels, axis=0)
            rmin = max(0, int(np.where(rows_any)[0][0]) - padding)
            rmax = min(h - 1, int(np.where(rows_any)[0][-1]) + padding)
            cmin = max(0, int(np.where(cols_any)[0][0]) - padding)
            cmax = min(w - 1, int(np.where(cols_any)[0][-1]) + padding)
            crop_rgb = img_arr[rmin:rmax + 1, cmin:cmax + 1]
            crop_mask = flake_pixels[rmin:rmax + 1, cmin:cmax + 1]
            alpha = np.where(crop_mask, 255, 0).astype(np.uint8)
            rgba = np.dstack([crop_rgb, alpha])
            out = PILImage.fromarray(rgba, "RGBA")
            buf = BytesIO()
            out.save(buf, format="PNG")
            png_bytes = buf.getvalue()
            _user_masked_cache[cache_key_user] = png_bytes
            return Response(png_bytes, content_type="image/png")
        except Exception as e:
            app.logger.warning("User-mask crop failed for layer %s/%s: %s", layer_id, image_filename, e)
            return Response(_TRANSPARENT_PNG, content_type="image/png")

    cache_key = (flake_path, padding)
    if cache_key in _crop_cache:
        return Response(_crop_cache[cache_key], content_type="image/png")

    image_base = config.get("image_url", "").rstrip("/")
    clean_path = flake_path.replace("\\", "/").strip("/")

    try:
        img_resp = req.get(f"{image_base}/{clean_path}/raw_img.png", timeout=15)
        img_resp.raise_for_status()
        mask_resp = req.get(f"{image_base}/{clean_path}/flake_mask.png", timeout=15)
        mask_resp.raise_for_status()

        img_arr = np.array(PILImage.open(BytesIO(img_resp.content)).convert("RGB"))
        mask_arr = np.array(PILImage.open(BytesIO(mask_resp.content)).convert("L"))

        # Normalise mask to 0/255: handles both 0/1 and 0/255 input ranges
        mask_max = int(mask_arr.max())
        if mask_max == 0:
            # Empty mask — return the full image as RGBA (fully opaque)
            app.logger.warning("Empty mask for %s — returning full image", clean_path)
            rgba = np.dstack([img_arr, np.full(img_arr.shape[:2], 255, dtype=np.uint8)])
            out = PILImage.fromarray(rgba, "RGBA")
            buf = BytesIO()
            out.save(buf, format="PNG")
            return Response(buf.getvalue(), content_type="image/png")

        if mask_max <= 1:
            normalised = (mask_arr * 255).astype(np.uint8)
        else:
            normalised = mask_arr.astype(np.uint8)

        # Determine which value represents the flake.
        # Convention in 2DMatGMM: 255 = flake, 0 = background.
        # Sanity check: the flake should be the minority class (<50 % of pixels).
        flake_pixels = normalised > 128
        if flake_pixels.sum() > flake_pixels.size * 0.5:
            # Mask appears inverted — flip it
            app.logger.info("Inverting mask for %s (majority was >128)", clean_path)
            flake_pixels = ~flake_pixels

        # Compute bounding box and apply padding
        rows = np.any(flake_pixels, axis=1)
        cols = np.any(flake_pixels, axis=0)
        if not rows.any():
            rgba = np.dstack([img_arr, np.full(img_arr.shape[:2], 255, dtype=np.uint8)])
            out = PILImage.fromarray(rgba, "RGBA")
            buf = BytesIO()
            out.save(buf, format="PNG")
            return Response(buf.getvalue(), content_type="image/png")

        h, w = mask_arr.shape
        rmin = max(0, int(np.where(rows)[0][0]) - padding)
        rmax = min(h - 1, int(np.where(rows)[0][-1]) + padding)
        cmin = max(0, int(np.where(cols)[0][0]) - padding)
        cmax = min(w - 1, int(np.where(cols)[0][-1]) + padding)

        crop_rgb  = img_arr[rmin:rmax + 1, cmin:cmax + 1]
        crop_mask = flake_pixels[rmin:rmax + 1, cmin:cmax + 1]

        # Build RGBA: flake pixels fully opaque, background transparent
        alpha = np.where(crop_mask, 255, 0).astype(np.uint8)
        rgba  = np.dstack([crop_rgb, alpha])

        out = PILImage.fromarray(rgba, "RGBA")
        buf = BytesIO()
        out.save(buf, format="PNG")
        png_bytes = buf.getvalue()

        _crop_cache[cache_key] = png_bytes  # keyed by (flake_path, padding)
        return Response(png_bytes, content_type="image/png")

    except Exception as e:
        app.logger.warning("Crop failed for %s: %s", clean_path, e)
        return Response(_TRANSPARENT_PNG, content_type="image/png")


@app.route("/proxy/masked", methods=["GET"])
def proxy_masked():
    """Full-size RGBA image: flake pixels opaque, background transparent (no crop)."""
    import requests as req
    import numpy as np
    from PIL import Image as PILImage

    flake_path = request.args.get("flake_path", "")
    layer_id = request.args.get("layer_id", type=int)
    image_filename = request.args.get("image_filename", "")

    if not flake_path:
        return Response(_TRANSPARENT_PNG, content_type="image/png")

    user_info = _lookup_user_mask(layer_id, image_filename)
    if user_info is not None:
        _row, mask_path, mtime = user_info
        cache_key_user = (layer_id, image_filename, mtime)
        if cache_key_user in _user_masked_cache:
            return Response(_user_masked_cache[cache_key_user], content_type="image/png")
        try:
            img_bytes = _fetch_base_image(flake_path, image_filename)
            img_arr = np.array(PILImage.open(BytesIO(img_bytes)).convert("RGB"))
            mask_arr = np.array(PILImage.open(mask_path).convert("L"))
            flake_pixels = mask_arr > 128
            alpha = np.where(flake_pixels, 255, 0).astype(np.uint8)
            rgba = np.dstack([img_arr, alpha])
            out = PILImage.fromarray(rgba, "RGBA")
            buf = BytesIO()
            out.save(buf, format="PNG")
            png_bytes = buf.getvalue()
            _user_masked_cache[cache_key_user] = png_bytes
            return Response(png_bytes, content_type="image/png")
        except Exception as e:
            app.logger.warning("User-mask masked failed for layer %s/%s: %s", layer_id, image_filename, e)
            return Response(_TRANSPARENT_PNG, content_type="image/png")

    if flake_path in _masked_cache:
        return Response(_masked_cache[flake_path], content_type="image/png")

    image_base = config.get("image_url", "").rstrip("/")
    clean_path = flake_path.replace("\\", "/").strip("/")

    try:
        img_resp  = req.get(f"{image_base}/{clean_path}/raw_img.png",   timeout=15)
        img_resp.raise_for_status()
        mask_resp = req.get(f"{image_base}/{clean_path}/flake_mask.png", timeout=15)
        mask_resp.raise_for_status()

        img_arr  = np.array(PILImage.open(BytesIO(img_resp.content)).convert("RGB"))
        mask_arr = np.array(PILImage.open(BytesIO(mask_resp.content)).convert("L"))

        mask_max = int(mask_arr.max())
        if mask_max == 0:
            return Response(_TRANSPARENT_PNG, content_type="image/png")

        normalised   = (mask_arr * 255).astype(np.uint8) if mask_max <= 1 else mask_arr.astype(np.uint8)
        flake_pixels = normalised > 128
        if flake_pixels.sum() > flake_pixels.size * 0.5:
            flake_pixels = ~flake_pixels

        alpha = np.where(flake_pixels, 255, 0).astype(np.uint8)
        rgba  = np.dstack([img_arr, alpha])

        out = PILImage.fromarray(rgba, "RGBA")
        buf = BytesIO()
        out.save(buf, format="PNG")
        png_bytes = buf.getvalue()
        _masked_cache[flake_path] = png_bytes
        return Response(png_bytes, content_type="image/png")

    except Exception as e:
        app.logger.warning("Masked failed for %s: %s", clean_path, e)
        return Response(_TRANSPARENT_PNG, content_type="image/png")


@app.route("/proxy/outline", methods=["GET"])
def proxy_outline():
    """Full-size RGBA image: yellow contour around the flake, background transparent."""
    import requests as req
    import numpy as np
    from PIL import Image as PILImage

    flake_path = request.args.get("flake_path", "")
    layer_id = request.args.get("layer_id", type=int)
    image_filename = request.args.get("image_filename", "")

    if not flake_path:
        return Response(_TRANSPARENT_PNG, content_type="image/png")

    # Parse optional color param: accepts "ffdd00", "#ffdd00", "ff0", "#ff0".
    # Falls back to yellow (255, 230, 0) on any parse failure.
    color_arg = (request.args.get("color", "") or "").strip().lstrip("#")
    r, g, b = 255, 230, 0
    if len(color_arg) == 3:
        try:
            r, g, b = (int(c * 2, 16) for c in color_arg)
        except ValueError:
            pass
    elif len(color_arg) == 6:
        try:
            r = int(color_arg[0:2], 16)
            g = int(color_arg[2:4], 16)
            b = int(color_arg[4:6], 16)
        except ValueError:
            pass

    def _dilate(m, iters):
        result = m.copy()
        for _ in range(iters):
            up    = np.zeros_like(result); up[:-1, :]    = result[1:, :]
            down  = np.zeros_like(result); down[1:, :]   = result[:-1, :]
            left  = np.zeros_like(result); left[:, :-1]  = result[:, 1:]
            right = np.zeros_like(result); right[:, 1:]  = result[:, :-1]
            result = result | up | down | left | right
        return result

    user_info = _lookup_user_mask(layer_id, image_filename)
    if user_info is not None:
        _row, mask_path, mtime = user_info
        cache_key_user = (layer_id, image_filename, mtime, r, g, b)
        if cache_key_user in _user_outline_cache:
            return Response(_user_outline_cache[cache_key_user], content_type="image/png")
        try:
            mask_arr = np.array(PILImage.open(mask_path).convert("L"))
            h, w = mask_arr.shape
            flake_pixels = mask_arr > 128
            if not flake_pixels.any():
                return Response(_TRANSPARENT_PNG, content_type="image/png")
            border = _dilate(flake_pixels, 4) & ~flake_pixels
            rgba = np.zeros((h, w, 4), dtype=np.uint8)
            rgba[border, 0] = r
            rgba[border, 1] = g
            rgba[border, 2] = b
            rgba[border, 3] = 255
            out = PILImage.fromarray(rgba, "RGBA")
            buf = BytesIO()
            out.save(buf, format="PNG")
            png_bytes = buf.getvalue()
            _user_outline_cache[cache_key_user] = png_bytes
            return Response(png_bytes, content_type="image/png")
        except Exception as e:
            app.logger.warning("User-mask outline failed for layer %s/%s: %s", layer_id, image_filename, e)
            return Response(_TRANSPARENT_PNG, content_type="image/png")

    cache_key = (flake_path, r, g, b)
    if cache_key in _outline_cache:
        return Response(_outline_cache[cache_key], content_type="image/png")

    image_base = config.get("image_url", "").rstrip("/")
    clean_path = flake_path.replace("\\", "/").strip("/")

    try:
        mask_resp = req.get(f"{image_base}/{clean_path}/flake_mask.png", timeout=15)
        mask_resp.raise_for_status()

        mask_arr = np.array(PILImage.open(BytesIO(mask_resp.content)).convert("L"))
        h, w = mask_arr.shape

        mask_max = int(mask_arr.max())
        if mask_max == 0:
            return Response(_TRANSPARENT_PNG, content_type="image/png")

        normalised   = (mask_arr * 255).astype(np.uint8) if mask_max <= 1 else mask_arr.astype(np.uint8)
        flake_pixels = normalised > 128
        if flake_pixels.sum() > flake_pixels.size * 0.5:
            flake_pixels = ~flake_pixels

        # 4-px border outside the flake
        border = _dilate(flake_pixels, 4) & ~flake_pixels

        # Tint the outline pixels with the requested colour (default yellow)
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[border, 0] = r
        rgba[border, 1] = g
        rgba[border, 2] = b
        rgba[border, 3] = 255

        out = PILImage.fromarray(rgba, "RGBA")
        buf = BytesIO()
        out.save(buf, format="PNG")
        png_bytes = buf.getvalue()
        _outline_cache[cache_key] = png_bytes
        return Response(png_bytes, content_type="image/png")

    except Exception as e:
        app.logger.warning("Outline failed for %s: %s", clean_path, e)
        return Response(_TRANSPARENT_PNG, content_type="image/png")


@app.route("/proxy/centroid", methods=["GET"])
def proxy_centroid():
    """Return the flake centroid and crop geometry.

    Returns:
      cx_pct / cy_pct       – centroid as % of full image (used when crop is off)
      crop_cx_pct / crop_cy_pct – centroid as % of the cropped image (used when crop is on)
      crop_scale            – crop_width / full_width, so the frontend can size the
                              cropped image proportionally (display_width = 900 * crop_scale)
    Results are cached in memory.
    """
    import requests as req
    import numpy as np
    from PIL import Image as PILImage

    PADDING = 30
    _fallback = {
        "cx_pct": 50.0, "cy_pct": 50.0,
        "crop_cx_pct": 50.0, "crop_cy_pct": 50.0, "crop_scale": 1.0,
        "bbox_left_pct": 10.0, "bbox_top_pct": 10.0,
        "bbox_right_pct": 90.0, "bbox_bottom_pct": 90.0,
    }

    flake_path = request.args.get("flake_path", "")
    layer_id = request.args.get("layer_id", type=int)
    image_filename = request.args.get("image_filename", "")

    if not flake_path:
        return jsonify(_fallback)

    user_info = _lookup_user_mask(layer_id, image_filename)
    if user_info is not None:
        _row, mask_path, mtime = user_info
        cache_key_user = (layer_id, image_filename, mtime)
        if cache_key_user in _user_centroid_cache:
            return jsonify(_user_centroid_cache[cache_key_user])
        try:
            mask_arr = np.array(PILImage.open(mask_path).convert("L"))
            h, w = mask_arr.shape
            flake_pixels = mask_arr > 128
            if not flake_pixels.any():
                result = _fallback
            else:
                rows_idx, cols_idx = np.where(flake_pixels)
                cx_px = float(cols_idx.mean())
                cy_px = float(rows_idx.mean())
                rmin = max(0, int(rows_idx.min()) - PADDING)
                rmax = min(h - 1, int(rows_idx.max()) + PADDING)
                cmin = max(0, int(cols_idx.min()) - PADDING)
                cmax = min(w - 1, int(cols_idx.max()) + PADDING)
                crop_w = cmax - cmin + 1
                crop_h = rmax - rmin + 1
                result = {
                    "cx_pct":      cx_px / w * 100,
                    "cy_pct":      cy_px / h * 100,
                    "crop_cx_pct": (cx_px - cmin) / crop_w * 100,
                    "crop_cy_pct": (cy_px - rmin) / crop_h * 100,
                    "crop_scale":  crop_w / w,
                    "bbox_left_pct":   cmin / w * 100,
                    "bbox_top_pct":    rmin / h * 100,
                    "bbox_right_pct":  (cmax + 1) / w * 100,
                    "bbox_bottom_pct": (rmax + 1) / h * 100,
                }
            _user_centroid_cache[cache_key_user] = result
            return jsonify(result)
        except Exception as e:
            app.logger.warning("User-mask centroid failed for layer %s/%s: %s", layer_id, image_filename, e)
            return jsonify(_fallback)

    # Use cached value only if it contains the newer bbox fields
    if flake_path in _centroid_cache and "bbox_left_pct" in _centroid_cache[flake_path]:
        return jsonify(_centroid_cache[flake_path])

    image_base = config.get("image_url", "").rstrip("/")
    clean_path = flake_path.replace("\\", "/").strip("/")

    try:
        mask_resp = req.get(f"{image_base}/{clean_path}/flake_mask.png", timeout=15)
        mask_resp.raise_for_status()

        mask_arr = np.array(PILImage.open(BytesIO(mask_resp.content)).convert("L"))
        h, w = mask_arr.shape

        mask_max = int(mask_arr.max())
        if mask_max <= 1:
            normalised = (mask_arr * 255).astype(np.uint8)
        else:
            normalised = mask_arr.astype(np.uint8)

        flake_pixels = normalised > 128
        if flake_pixels.sum() > flake_pixels.size * 0.5:
            flake_pixels = ~flake_pixels

        if not flake_pixels.any():
            result = _fallback
        else:
            rows_idx, cols_idx = np.where(flake_pixels)
            cx_px = float(cols_idx.mean())
            cy_px = float(rows_idx.mean())

            # Bounding box with padding (same as proxy_crop)
            rmin = max(0, int(rows_idx.min()) - PADDING)
            rmax = min(h - 1, int(rows_idx.max()) + PADDING)
            cmin = max(0, int(cols_idx.min()) - PADDING)
            cmax = min(w - 1, int(cols_idx.max()) + PADDING)
            crop_w = cmax - cmin + 1
            crop_h = rmax - rmin + 1

            result = {
                "cx_pct":      cx_px / w * 100,
                "cy_pct":      cy_px / h * 100,
                "crop_cx_pct": (cx_px - cmin) / crop_w * 100,
                "crop_cy_pct": (cy_px - rmin) / crop_h * 100,
                "crop_scale":  crop_w / w,
                "bbox_left_pct":   cmin / w * 100,
                "bbox_top_pct":    rmin / h * 100,
                "bbox_right_pct":  (cmax + 1) / w * 100,
                "bbox_bottom_pct": (rmax + 1) / h * 100,
            }

        _centroid_cache[flake_path] = result
        return jsonify(result)

    except Exception as e:
        app.logger.warning("Centroid failed for %s: %s", clean_path, e)
        return jsonify(_fallback)


# ---------------------------------------------------------------------------
# Local image uploads (persisted on server so they survive sessions)
# ---------------------------------------------------------------------------

@app.route("/uploads", methods=["POST"])
def upload_image():
    file = request.files.get("file")
    if file is None or not file.filename:
        return json_response({"error": "no file uploaded"}, 400)
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_UPLOAD_EXTS:
        return json_response({"error": f"unsupported file type: {ext}"}, 400)
    name = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOADS_DIR / name
    file.save(str(dest))
    return json_response({"url": f"/uploads/{name}", "filename": name})


@app.route("/uploads/<path:filename>", methods=["GET"])
def serve_upload(filename):
    from flask import send_from_directory, abort
    # Normalise and reject anything that would escape UPLOADS_DIR. Subdirectories
    # under uploads/ are allowed (e.g. uploads/masks/<uuid>.png).
    candidate = (UPLOADS_DIR / filename).resolve()
    try:
        candidate.relative_to(UPLOADS_DIR.resolve())
    except ValueError:
        abort(404)
    rel = candidate.relative_to(UPLOADS_DIR.resolve()).as_posix()
    return send_from_directory(str(UPLOADS_DIR), rel)


# ---------------------------------------------------------------------------
# User-painted watershed masks (per layer, per base image)
# ---------------------------------------------------------------------------

def _invalidate_user_mask_caches(layer_id, image_filename):
    """Drop any cached render that was keyed on this (layer_id, image_filename).

    The three user-mask caches use slightly different key tuple shapes (crop has a
    padding term, outline has an rgb triple). Since every key does contain both
    layer_id and image_filename somewhere, the cheapest correct thing is to scan.
    """
    for cache in (_user_masked_cache, _user_outline_cache, _user_centroid_cache):
        stale = [
            k for k in list(cache.keys())
            if isinstance(k, tuple) and layer_id in k and image_filename in k
        ]
        for k in stale:
            cache.pop(k, None)


@app.route("/stacks/<int:stack_id>/layers/<int:layer_id>/watershed", methods=["POST"])
def create_watershed_mask(stack_id, layer_id):
    """Run cv2.watershed on a user-curated base image and persist the resulting mask.

    Body JSON:
      { image_filename: "20x.png",
        strokes: { foreground: [[[x,y], ...], ...], background: [[[x,y], ...], ...] },
        brush_radius: 15 }
    Coordinates are in the base image's native pixel space.
    """
    from services.watershed import run_watershed

    layer = db_session.get(StackLayer, layer_id)
    if layer is None or layer.stack_id != stack_id:
        return json_response({"error": "layer not found"}, 404)
    if not layer.flake_path:
        return json_response({"error": "layer has no flake_path"}, 400)

    body = request.get_json(force=True, silent=True) or {}
    image_filename = (body.get("image_filename") or "").strip()
    strokes = body.get("strokes") or {}
    fg = strokes.get("foreground") or []
    bg = strokes.get("background") or []
    try:
        brush_radius = int(body.get("brush_radius", 15))
    except (TypeError, ValueError):
        return json_response({"error": "brush_radius must be an integer"}, 400)

    if not image_filename:
        return json_response({"error": "image_filename is required"}, 400)
    if not fg or not bg:
        return json_response({"error": "foreground and background strokes are required"}, 400)

    try:
        img_bytes = _fetch_base_image(layer.flake_path, image_filename)
    except Exception as e:
        return json_response({"error": f"could not fetch base image: {e}"}, 502)

    try:
        mask_png = run_watershed(img_bytes, fg, bg, brush_radius=brush_radius)
    except ValueError as e:
        return json_response({"error": str(e)}, 400)
    except Exception as e:
        app.logger.exception("Watershed failed for layer %s/%s", layer_id, image_filename)
        return json_response({"error": f"watershed failed: {e}"}, 500)

    name = f"{uuid.uuid4().hex}.png"
    dest = MASKS_DIR / name
    dest.write_bytes(mask_png)
    mask_url = f"/uploads/masks/{name}"

    existing = (
        db_session.query(LayerMask)
        .filter_by(layer_id=layer_id, image_filename=image_filename)
        .one_or_none()
    )
    if existing is not None:
        old_path = _mask_url_to_path(existing.mask_url)
        if old_path is not None and old_path != dest:
            try:
                old_path.unlink()
            except OSError:
                pass
        existing.mask_url = mask_url
        existing.created_at = time.time()
        mask_row = existing
    else:
        mask_row = LayerMask(
            layer_id=layer_id,
            image_filename=image_filename,
            mask_url=mask_url,
            created_at=time.time(),
        )
        db_session.add(mask_row)
    db_session.commit()

    _invalidate_user_mask_caches(layer_id, image_filename)
    return json_response(mask_row.to_dict(), 201)


@app.route("/stacks/<int:stack_id>/layers/<int:layer_id>/masks", methods=["GET"])
def list_layer_masks(stack_id, layer_id):
    layer = db_session.get(StackLayer, layer_id)
    if layer is None or layer.stack_id != stack_id:
        return json_response({"error": "layer not found"}, 404)
    return json_response({m.image_filename: m.mask_url for m in layer.masks})


@app.route("/stacks/<int:stack_id>/layers/<int:layer_id>/masks/<path:image_filename>", methods=["DELETE"])
def delete_layer_mask(stack_id, layer_id, image_filename):
    layer = db_session.get(StackLayer, layer_id)
    if layer is None or layer.stack_id != stack_id:
        return json_response({"error": "layer not found"}, 404)
    row = (
        db_session.query(LayerMask)
        .filter_by(layer_id=layer_id, image_filename=image_filename)
        .one_or_none()
    )
    if row is None:
        return json_response({"error": "mask not found"}, 404)
    path = _mask_url_to_path(row.mask_url)
    if path is not None:
        try:
            path.unlink()
        except OSError as e:
            app.logger.warning("Could not unlink mask %s: %s", path, e)
    db_session.delete(row)
    db_session.commit()
    _invalidate_user_mask_caches(layer_id, image_filename)
    return json_response({"deleted": image_filename})


# ---------------------------------------------------------------------------
# User CRUD
# ---------------------------------------------------------------------------

@app.route("/users", methods=["GET"])
def list_users():
    limit = min(int(request.args.get("limit", 500)), 1000)
    offset = int(request.args.get("offset", 0))
    users = (
        db_session.query(User)
        .options(subqueryload(User.stacks))
        .order_by(User.name)
        .limit(limit)
        .offset(offset)
        .all()
    )
    return json_response([u.to_dict() for u in users])


@app.route("/users", methods=["POST"])
def create_user():
    body = request.get_json(force=True, silent=True) or {}
    name = body.get("name", "").strip()
    if not name:
        return json_response({"error": "name is required"}, 400)
    existing = db_session.query(User).filter(User.name == name).first()
    if existing:
        return json_response(existing.to_dict(), 200)
    user = User(name=name, created_at=time.time())
    db_session.add(user)
    db_session.commit()
    fs_mirror.sync_user(FS_ROOT, user)
    return json_response(user.to_dict(), 201)


# ---------------------------------------------------------------------------
# Stack CRUD
# ---------------------------------------------------------------------------

@app.route("/stacks", methods=["GET"])
def list_stacks():
    limit = min(int(request.args.get("limit", 500)), 1000)
    offset = int(request.args.get("offset", 0))
    stacks = (
        db_session.query(Stack)
        .options(subqueryload(Stack.layers), subqueryload(Stack.user))
        .order_by(Stack.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    return json_response([s.to_dict() for s in stacks])


@app.route("/stacks", methods=["POST"])
def create_stack():
    body = request.get_json(force=True, silent=True) or {}
    name = body.get("name", "").strip()
    if not name:
        return json_response({"error": "name is required"}, 400)
    user_id = body.get("user_id")
    if user_id is not None:
        user_id = int(user_id)
        if db_session.get(User, user_id) is None:
            return json_response({"error": "user not found"}, 404)
    stack = Stack(
        name=name,
        notes=body.get("notes"),
        user_id=user_id,
        created_at=time.time(),
        updated_at=time.time(),
    )
    db_session.add(stack)
    db_session.commit()
    fs_mirror.sync_stack(FS_ROOT, stack, scans_root=_scans_root_if_present())
    return json_response(stack.to_dict(), 201)


@app.route("/stacks/<int:stack_id>", methods=["GET"])
def get_stack(stack_id):
    stack = db_session.get(Stack, stack_id)
    if stack is None:
        return json_response({"error": "not found"}, 404)
    return json_response(stack.to_dict(include_layers=True))


@app.route("/stacks/<int:stack_id>", methods=["PUT"])
def update_stack(stack_id):
    stack = db_session.get(Stack, stack_id)
    if stack is None:
        return json_response({"error": "not found"}, 404)
    body = request.get_json(force=True, silent=True) or {}
    if "name" in body and body["name"].strip():
        stack.name = body["name"].strip()
    if "notes" in body:
        stack.notes = body["notes"]
    stack.updated_at = time.time()
    db_session.commit()
    fs_mirror.sync_stack(FS_ROOT, stack, scans_root=_scans_root_if_present(), copy_images=False)
    return json_response(stack.to_dict())


@app.route("/stacks/<int:stack_id>", methods=["DELETE"])
def delete_stack(stack_id):
    stack = db_session.get(Stack, stack_id)
    if stack is None:
        return json_response({"error": "not found"}, 404)
    user = stack.user  # capture before delete so the mirror can locate the folder

    # Collect mask file paths + cache keys before the cascade deletes the rows.
    mask_cleanup = []
    for layer in stack.layers:
        for mask in layer.masks:
            mask_cleanup.append((layer.id, mask.image_filename, _mask_url_to_path(mask.mask_url)))

    db_session.delete(stack)
    db_session.commit()
    fs_mirror.delete_stack(FS_ROOT, stack_id, user)

    for lid, ifile, path in mask_cleanup:
        if path is not None:
            try:
                path.unlink()
            except OSError as e:
                app.logger.warning("Could not unlink mask %s: %s", path, e)
        _invalidate_user_mask_caches(lid, ifile)

    return json_response({"deleted": stack_id})


# ---------------------------------------------------------------------------
# Layer management
# ---------------------------------------------------------------------------

@app.route("/stacks/<int:stack_id>/layers", methods=["POST"])
def add_layer(stack_id):
    stack = db_session.get(Stack, stack_id)
    if stack is None:
        return json_response({"error": "stack not found"}, 404)

    body = request.get_json(force=True, silent=True) or {}
    is_shape = bool(body.get("is_shape", False))
    is_local = bool(body.get("is_local", False))

    # Default layer_index to one above the current maximum
    existing_max = (
        db_session.query(StackLayer.layer_index)
        .filter(StackLayer.stack_id == stack_id)
        .order_by(StackLayer.layer_index.desc())
        .first()
    )
    default_index = (existing_max[0] + 1) if existing_max else 0
    layer_index = body.get("layer_index", default_index)

    if is_shape:
        shape_data = body.get("shape_data")
        layer = StackLayer(
            stack_id=stack_id,
            layer_index=layer_index,
            name=body.get("name"),
            is_shape=True,
            shape_type=body.get("shape_type"),
            shape_data=json.dumps(shape_data) if shape_data is not None else None,
            shape_color=body.get("shape_color"),
            shape_stroke_width=float(body.get("shape_stroke_width", 2.0)),
            pos_x=body.get("pos_x", 0.0),
            pos_y=body.get("pos_y", 0.0),
            rotation=body.get("rotation", 0.0),
            opacity=float(body.get("opacity", 1.0)),
            brightness=1.0,
            contrast=1.0,
        )
    elif is_local:
        layer = StackLayer(
            stack_id=stack_id,
            layer_index=layer_index,
            name=body.get("name"),
            is_shape=False,
            is_local=True,
            local_image_url=body.get("local_image_url"),
            flake_id=None,
            flake_material=body.get("flake_material") or "Custom",
            pos_x=body.get("pos_x", 0.0),
            pos_y=body.get("pos_y", 0.0),
            rotation=body.get("rotation", 0.0),
            opacity=body.get("opacity", 1.0),
            brightness=body.get("brightness", 1.0),
            contrast=body.get("contrast", 1.0),
        )
    else:
        flake_id = body.get("flake_id")
        if flake_id is None:
            return json_response({"error": "flake_id is required"}, 400)

        # Snapshot flake metadata from the GMM backend
        flake_material = body.get("flake_material")
        flake_size = body.get("flake_size")
        flake_thickness = body.get("flake_thickness")
        flake_path = body.get("flake_path")

        # If the client didn't supply cached fields, fetch them from the proxy
        if flake_path is None:
            try:
                flake_data = flake_proxy.get_flake(config, flake_id)
                flake_material = flake_data.get("chip_material", flake_material)
                flake_size = flake_data.get("flake_size", flake_size)
                flake_thickness = flake_data.get("flake_thickness", flake_thickness)
                flake_path = flake_data.get("flake_path", flake_path)
            except Exception as e:
                # Not fatal — the layer is still saved, just without cached metadata
                app.logger.warning("Could not fetch flake metadata for id=%s: %s", flake_id, e)

        layer = StackLayer(
            stack_id=stack_id,
            layer_index=layer_index,
            name=body.get("name"),
            is_shape=False,
            flake_id=flake_id,
            flake_material=flake_material,
            flake_size=flake_size,
            flake_thickness=flake_thickness,
            flake_path=flake_path,
            pos_x=body.get("pos_x", 0.0),
            pos_y=body.get("pos_y", 0.0),
            rotation=body.get("rotation", 0.0),
            opacity=body.get("opacity", 0.7),
            brightness=body.get("brightness", 1.0),
            contrast=body.get("contrast", 1.0),
            image_filename=body.get("image_filename", "eval_img.jpg"),
            canvas_base_filename=body.get("canvas_base_filename", "raw_img.png"),
        )

    db_session.add(layer)
    stack.updated_at = time.time()
    db_session.commit()
    fs_mirror.sync_layer(FS_ROOT, stack, layer, scans_root=_scans_root_if_present())
    return json_response(layer.to_dict(), 201)


@app.route("/stacks/<int:stack_id>/layers/<int:layer_id>", methods=["PUT"])
def update_layer(stack_id, layer_id):
    layer = db_session.get(StackLayer, layer_id)
    if layer is None or layer.stack_id != stack_id:
        return json_response({"error": "not found"}, 404)

    body = request.get_json(force=True, silent=True) or {}
    float_fields = ("pos_x", "pos_y", "rotation", "opacity", "brightness", "contrast")
    for field in float_fields:
        if field in body:
            setattr(layer, field, float(body[field]))
    if "layer_index" in body:
        layer.layer_index = int(body["layer_index"])
    if "image_filename" in body:
        layer.image_filename = body["image_filename"]
    if "canvas_base_filename" in body:
        layer.canvas_base_filename = body["canvas_base_filename"] or "raw_img.png"
    if "name" in body:
        layer.name = body["name"] or None
    # Shape-specific updatable fields
    if "shape_color" in body:
        layer.shape_color = body["shape_color"]
    if "shape_stroke_width" in body:
        layer.shape_stroke_width = float(body["shape_stroke_width"])

    stack = db_session.get(Stack, stack_id)
    if stack:
        stack.updated_at = time.time()
    db_session.commit()
    if stack is not None:
        fs_mirror.sync_stack(FS_ROOT, stack, scans_root=_scans_root_if_present(), copy_images=False)
    return json_response(layer.to_dict())


@app.route("/stacks/<int:stack_id>/layers/<int:layer_id>", methods=["DELETE"])
def delete_layer(stack_id, layer_id):
    layer = db_session.get(StackLayer, layer_id)
    if layer is None or layer.stack_id != stack_id:
        return json_response({"error": "not found"}, 404)

    # Unlink mask files before the row cascade removes the LayerMask records.
    for mask in list(layer.masks):
        path = _mask_url_to_path(mask.mask_url)
        if path is not None:
            try:
                path.unlink()
            except OSError as e:
                app.logger.warning("Could not unlink mask %s: %s", path, e)
        _invalidate_user_mask_caches(layer_id, mask.image_filename)

    db_session.delete(layer)
    stack = db_session.get(Stack, stack_id)
    if stack:
        stack.updated_at = time.time()
    db_session.commit()
    if stack is not None:
        fs_mirror.delete_layer(FS_ROOT, stack, layer_id)
    return json_response({"deleted": layer_id})


@app.route("/stacks/<int:stack_id>/layers/reorder", methods=["PUT"])
def reorder_layers(stack_id):
    """Batch-update layer_index values. Body: [{id, layer_index}, ...]"""
    stack = db_session.get(Stack, stack_id)
    if stack is None:
        return json_response({"error": "stack not found"}, 404)

    body = request.get_json(force=True, silent=True) or []
    for item in body:
        layer = db_session.get(StackLayer, item.get("id"))
        if layer and layer.stack_id == stack_id:
            layer.layer_index = int(item["layer_index"])
    stack.updated_at = time.time()
    db_session.commit()
    # Return the updated stack
    db_session.refresh(stack)
    fs_mirror.sync_stack(FS_ROOT, stack, scans_root=_scans_root_if_present(), copy_images=False)
    return json_response(stack.to_dict(include_layers=True))


# ---------------------------------------------------------------------------
# Flake notes
# ---------------------------------------------------------------------------

@app.route("/flakes/<int:flake_id>/notes", methods=["GET"])
def get_flake_notes(flake_id):
    note = db_session.query(FlakeNote).filter(FlakeNote.flake_id == flake_id).first()
    if note is None:
        return json_response({
            "flake_id": flake_id,
            "notes": "",
            "user_override": None,
            "updated_at": None,
        })
    return json_response(note.to_dict())


@app.route("/flakes/<int:flake_id>/notes", methods=["PUT"])
def save_flake_notes(flake_id):
    body = request.get_json(force=True, silent=True) or {}
    note = db_session.query(FlakeNote).filter(FlakeNote.flake_id == flake_id).first()
    if note is None:
        note = FlakeNote(flake_id=flake_id, updated_at=time.time())
        db_session.add(note)
    if "notes" in body:
        note.notes = body.get("notes") or ""
    if "user_override" in body:
        value = body.get("user_override")
        note.user_override = value.strip() if isinstance(value, str) and value.strip() else None
    note.updated_at = time.time()
    db_session.commit()
    return json_response(note.to_dict())


# ---------------------------------------------------------------------------
# Used-flake tracking
# ---------------------------------------------------------------------------

@app.route("/used-flake-ids", methods=["GET"])
def get_used_flake_ids():
    """Return all distinct flake_ids that appear in any stack layer."""
    rows = (
        db_session.query(StackLayer.flake_id)
        .filter(StackLayer.flake_id.isnot(None))
        .distinct()
        .all()
    )
    return json_response([row[0] for row in rows])


# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------

@app.route("/backup/download")
def download_backup():
    """Stream a consistent SQLite snapshot as a file download."""
    import sqlite3
    from flask import send_file
    import datetime

    db_path = config.get("database_path", "stacks.db")
    if not os.path.isabs(db_path):
        db_path = os.path.join(os.path.dirname(__file__), db_path)
    db_path = os.path.abspath(db_path)

    buf = BytesIO()
    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(":memory:")
    src.backup(dst)
    src.close()
    for line in dst.iterdump():
        buf.write((line + "\n").encode("utf-8"))
    dst.close()
    buf.seek(0)

    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"stacks_backup_{timestamp}.sql"
    return send_file(
        buf,
        mimetype="text/plain",
        as_attachment=True,
        download_name=filename,
    )


# ---------------------------------------------------------------------------
# Teardown
# ---------------------------------------------------------------------------

@app.teardown_appcontext
def shutdown_session(exception=None):
    db_session.remove()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = config.get("port", 5000)
    app.run(host="0.0.0.0", port=port, debug=True)
