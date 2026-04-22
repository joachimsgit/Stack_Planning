"""Mirror the SQLite stack database to a human-browsable directory tree.

SQLite remains the source of truth. After every mutating API call, the
relevant subtree is reconciled on disk so researchers can inspect stacks
directly from the filesystem.

Layout::

    <fs_root>/
        users/
            <user_slug>__<user_id>/
                <stack_slug>__<stack_id>/
                    stack.json
                    <NN>_<kind>_<layer_id>/
                        layer.json            (flake layers)
                        <copied flake images> (flake layers)
                        shape.json            (shape layers)

All mirror operations are best-effort: failures are logged but never raised.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

_SLUG_RE = re.compile(r"[^\w-]+")


def slug(value: Optional[str], fallback: str = "unnamed") -> str:
    if not value:
        return fallback
    cleaned = _SLUG_RE.sub("_", value.strip()).strip("_").lower()
    return cleaned or fallback


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

def _users_root(fs_root: Path) -> Path:
    return fs_root / "users"


def _user_dir(fs_root: Path, user) -> Path:
    return _users_root(fs_root) / f"{slug(user.name)}__{user.id}"


def _find_by_id_suffix(parent: Path, sep: str, entity_id: int) -> Optional[Path]:
    """Locate a child directory whose name ends with `<sep><entity_id>`.

    Uses rpartition so that the part after the last `sep` must be exactly
    the numeric id — this avoids matching IDs that share digit prefixes.
    """
    if not parent.exists():
        return None
    target_tail = str(entity_id)
    for entry in parent.iterdir():
        if not entry.is_dir():
            continue
        _, found_sep, tail = entry.name.rpartition(sep)
        if found_sep == sep and tail == target_tail:
            return entry
    return None


def _layer_kind(layer) -> str:
    if layer.name:
        return slug(layer.name)
    if layer.is_shape:
        return slug(layer.shape_type or "shape")
    return "flake"


def _layer_target(stack_dir: Path, layer) -> Path:
    return stack_dir / f"{layer.layer_index:02d}_{_layer_kind(layer)}_{layer.id}"


def _stack_target(fs_root: Path, stack) -> Path:
    return _user_dir(fs_root, stack.user) / f"{slug(stack.name)}__{stack.id}"


# ---------------------------------------------------------------------------
# Core sync operations
# ---------------------------------------------------------------------------

def _write_json(path: Path, data) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, path)


def _copy_flake_images(flake_path: str, target_dir: Path, scans_root: Path) -> None:
    clean = flake_path.replace("\\", "/").strip("/")
    src = scans_root / clean
    if not src.is_dir():
        log.warning("flake_path not found under scans root: %s", src)
        return
    for entry in src.iterdir():
        if not entry.is_file():
            continue
        dest = target_dir / entry.name
        try:
            if dest.exists() and dest.stat().st_size == entry.stat().st_size:
                continue
            shutil.copy2(entry, dest)
        except OSError as exc:
            log.warning("failed to copy %s -> %s: %s", entry, dest, exc)


def sync_user(fs_root: Path, user) -> None:
    try:
        target = _user_dir(fs_root, user)
        existing = _find_by_id_suffix(_users_root(fs_root), "__", user.id)
        if existing and existing != target:
            existing.rename(target)
        else:
            target.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        log.warning("sync_user failed for id=%s: %s", getattr(user, "id", None), exc)


def delete_user(fs_root: Path, user_id: int) -> None:
    try:
        existing = _find_by_id_suffix(_users_root(fs_root), "__", user_id)
        if existing:
            shutil.rmtree(existing, ignore_errors=True)
    except Exception as exc:
        log.warning("delete_user failed for id=%s: %s", user_id, exc)


def sync_stack(
    fs_root: Path,
    stack,
    scans_root: Optional[Path] = None,
    copy_images: bool = True,
) -> None:
    """Reconcile a stack's directory, write stack.json, and sync every layer."""
    try:
        if stack.user is None:
            return  # anonymous stacks are not mirrored
        user_dir = _user_dir(fs_root, stack.user)
        user_dir.mkdir(parents=True, exist_ok=True)

        target = _stack_target(fs_root, stack)
        existing = _find_by_id_suffix(user_dir, "__", stack.id)
        if existing and existing != target:
            existing.rename(target)
        else:
            target.mkdir(parents=True, exist_ok=True)

        # Drop orphan layer directories (layers removed from the DB).
        valid_layer_ids = {layer.id for layer in stack.layers}
        for entry in target.iterdir():
            if not entry.is_dir():
                continue
            _, _, tail = entry.name.rpartition("_")
            try:
                lid = int(tail)
            except ValueError:
                continue
            if lid not in valid_layer_ids:
                shutil.rmtree(entry, ignore_errors=True)

        for layer in stack.layers:
            _sync_layer_in_stack(target, layer, scans_root, copy_images)

        _write_json(target / "stack.json", stack.to_dict(include_layers=True))
    except Exception as exc:
        log.warning("sync_stack failed for id=%s: %s", getattr(stack, "id", None), exc)


def _sync_layer_in_stack(
    stack_dir: Path,
    layer,
    scans_root: Optional[Path],
    copy_images: bool,
) -> None:
    target = _layer_target(stack_dir, layer)
    existing = _find_by_id_suffix(stack_dir, "_", layer.id)
    if existing and existing != target:
        existing.rename(target)
    else:
        target.mkdir(parents=True, exist_ok=True)

    if layer.is_shape:
        _write_json(target / "shape.json", layer.to_dict())
        stale = target / "layer.json"
        if stale.exists():
            stale.unlink()
    else:
        _write_json(target / "layer.json", layer.to_dict())
        stale = target / "shape.json"
        if stale.exists():
            stale.unlink()
        if copy_images and scans_root is not None and layer.flake_path:
            _copy_flake_images(layer.flake_path, target, scans_root)


def sync_layer(
    fs_root: Path,
    stack,
    layer,
    scans_root: Optional[Path] = None,
    copy_images: bool = True,
) -> None:
    """Sync a single layer and refresh the parent stack.json."""
    try:
        if stack.user is None:
            return
        stack_dir = _stack_target(fs_root, stack)
        stack_dir.mkdir(parents=True, exist_ok=True)
        _sync_layer_in_stack(stack_dir, layer, scans_root, copy_images)
        _write_json(stack_dir / "stack.json", stack.to_dict(include_layers=True))
    except Exception as exc:
        log.warning("sync_layer failed for id=%s: %s", getattr(layer, "id", None), exc)


def delete_stack(fs_root: Path, stack_id: int, user) -> None:
    try:
        if user is None:
            return
        user_dir = _user_dir(fs_root, user)
        existing = _find_by_id_suffix(user_dir, "__", stack_id)
        if existing:
            shutil.rmtree(existing, ignore_errors=True)
    except Exception as exc:
        log.warning("delete_stack failed for id=%s: %s", stack_id, exc)


def delete_layer(fs_root: Path, stack, layer_id: int) -> None:
    try:
        if stack.user is None:
            return
        stack_dir = _stack_target(fs_root, stack)
        if not stack_dir.exists():
            return
        existing = _find_by_id_suffix(stack_dir, "_", layer_id)
        if existing:
            shutil.rmtree(existing, ignore_errors=True)
        _write_json(stack_dir / "stack.json", stack.to_dict(include_layers=True))
    except Exception as exc:
        log.warning("delete_layer failed for id=%s: %s", layer_id, exc)


# ---------------------------------------------------------------------------
# Startup reconciliation (metadata only — never re-copies flake images)
# ---------------------------------------------------------------------------

def resync_all(session, fs_root: Path) -> None:
    """Walk the DB and rewrite every user/stack/layer metadata file.

    Images are intentionally NOT re-copied — they were placed on disk when
    the layer was originally saved, and recopying them on every startup is
    unnecessary I/O.
    """
    from database.models import User, Stack  # local import to avoid cycles

    try:
        fs_root.mkdir(parents=True, exist_ok=True)
        for user in session.query(User).all():
            sync_user(fs_root, user)
        for stack in session.query(Stack).all():
            sync_stack(fs_root, stack, scans_root=None, copy_images=False)
    except Exception as exc:
        log.warning("resync_all failed: %s", exc)
