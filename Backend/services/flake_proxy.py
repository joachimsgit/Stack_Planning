"""
Thin HTTP wrapper around the 2DMatGMM backend API.
All functions accept a config dict (loaded from config.json).
"""

import requests


def _base(config: dict) -> str:
    return config["flake_api_url"].rstrip("/")


def get_flakes(config: dict, query_params: dict) -> list:
    forward = {k: v for k, v in query_params.items() if k not in ("page", "query_limit")}
    resp = requests.get(f"{_base(config)}/flakes", params=forward, timeout=30)
    resp.raise_for_status()
    flakes = resp.json()
    flakes.sort(key=lambda f: f.get("flake_id", 0), reverse=True)
    return flakes


def get_flake(config: dict, flake_id: int) -> dict:
    resp = requests.get(f"{_base(config)}/flakes", params={"flake_id": flake_id}, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    if not data:
        raise ValueError(f"Flake {flake_id} not found in GMM database")
    return data[0]


def get_materials(config: dict) -> list:
    resp = requests.get(f"{_base(config)}/stats/materials", timeout=10)
    resp.raise_for_status()
    return resp.json()


def get_combinations(config: dict) -> dict:
    resp = requests.get(f"{_base(config)}/stats/uniqueCombinations", timeout=10)
    resp.raise_for_status()
    return resp.json()


def get_scan_users(config: dict) -> list:
    """Return a sorted list of unique scan_user strings from the GMM backend."""
    resp = requests.get(f"{_base(config)}/scans", timeout=30)
    resp.raise_for_status()
    scans = resp.json()
    users = sorted({s["scan_user"] for s in scans if s.get("scan_user")})
    return users


def flake_image_url(config: dict, flake_id: int, filename: str = "eval_img.jpg") -> str:
    return f"{_base(config)}/image/flake?flake_id={flake_id}&filename={filename}"
