import { useCallback, useRef, useState } from "react";

// Fields that, when changed, constitute a distinct editing state worth a history
// entry. `masks` is intentionally excluded — watershed edits are persisted
// separately and must not be reverted by undo/redo.
const TRACKED = [
  "layer_index",
  "pos_x",
  "pos_y",
  "rotation",
  "opacity",
  "brightness",
  "contrast",
  "shape_data",
  "shape_color",
  "shape_stroke_width",
  "canvas_base_filename",
  "name",
  "flake_material",
];

// Shallow per-layer clone. Snapshots must not share layer objects with live
// state, because `remapId` mutates a snapshot layer's `id` in place after a
// deleted layer is re-created with a fresh backend id.
function cloneLayers(layers) {
  return (layers || []).map((l) => ({ ...l }));
}

// Order-independent signature used to dedupe consecutive identical states (e.g.
// a debounced record firing when nothing actually moved, or re-recording the
// state we just restored).
function signature(layers) {
  return JSON.stringify(
    layers
      .map((l) => {
        const o = { id: l.id };
        for (const k of TRACKED) o[k] = l[k] ?? null;
        return o;
      })
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
  );
}

/**
 * In-memory undo/redo timeline for the stack's layers.
 *
 * The hook only owns the *history of snapshots*; it does not know how to apply a
 * snapshot (that requires backend reconciliation, which lives in the page).
 * `undo()` / `redo()` move the cursor and hand back the snapshot to apply.
 *
 * @param getLayers () => current layers array (kept fresh via a ref by the page)
 * @param capacity  max retained snapshots
 */
export function useStackHistory(getLayers, capacity = 60) {
  const getLayersRef = useRef(getLayers);
  getLayersRef.current = getLayers;

  const stackRef = useRef([]); // snapshot timeline
  const indexRef = useRef(-1); // cursor into stackRef
  const timerRef = useRef(null); // debounced-record timer

  const [{ canUndo, canRedo }, setFlags] = useState({ canUndo: false, canRedo: false });
  const syncFlags = useCallback(() => {
    setFlags({
      canUndo: indexRef.current > 0,
      canRedo: indexRef.current < stackRef.current.length - 1,
    });
  }, []);

  // Seed the timeline with the loaded state. Anything before this is unreachable.
  const reset = useCallback(
    (layers) => {
      clearTimeout(timerRef.current);
      stackRef.current = [cloneLayers(layers)];
      indexRef.current = 0;
      syncFlags();
    },
    [syncFlags]
  );

  const commit = useCallback(
    (layers) => {
      const snap = cloneLayers(layers);
      const top = stackRef.current[indexRef.current];
      if (top && signature(top) === signature(snap)) return; // no real change
      // Drop any redo branch, append, and cap the timeline length.
      const next = stackRef.current.slice(0, indexRef.current + 1);
      next.push(snap);
      while (next.length > capacity) next.shift();
      stackRef.current = next;
      indexRef.current = next.length - 1;
      syncFlags();
    },
    [capacity, syncFlags]
  );

  // Record immediately (discrete actions: add / delete / reorder).
  const record = useCallback(
    (layers) => {
      clearTimeout(timerRef.current);
      commit(layers || getLayersRef.current());
    },
    [commit]
  );

  // Record after the user pauses (continuous gestures: drag / rotate / sliders),
  // so one gesture collapses into a single undo step.
  const recordSoon = useCallback(
    (delay = 400) => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => commit(getLayersRef.current()), delay);
    },
    [commit]
  );

  const cancelPending = useCallback(() => clearTimeout(timerRef.current), []);

  const undo = useCallback(() => {
    clearTimeout(timerRef.current);
    if (indexRef.current <= 0) return null;
    indexRef.current -= 1;
    syncFlags();
    return cloneLayers(stackRef.current[indexRef.current]);
  }, [syncFlags]);

  const redo = useCallback(() => {
    clearTimeout(timerRef.current);
    if (indexRef.current >= stackRef.current.length - 1) return null;
    indexRef.current += 1;
    syncFlags();
    return cloneLayers(stackRef.current[indexRef.current]);
  }, [syncFlags]);

  // After a deleted layer is re-created with a new backend id, rewrite that id
  // everywhere in the timeline so further undo/redo stays consistent.
  const remapId = useCallback((oldId, newId) => {
    for (const snap of stackRef.current) {
      for (const l of snap) {
        if (l.id === oldId) l.id = newId;
      }
    }
  }, []);

  return { reset, record, recordSoon, cancelPending, undo, redo, remapId, canUndo, canRedo };
}
