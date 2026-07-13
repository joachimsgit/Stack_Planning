# Stack Planning — Feature Ideas & Roadmap

A running list of potential features and improvements, grouped by theme and
roughly ordered by impact. Generated from a review of the current codebase
(backend Flask API + React/Mantine frontend).

> Status legend: ⬜ not started · 🟡 in progress · ✅ done

---

## 1. Highest-impact features

- 🟡 **Export composed stack as image / report.** The only current output is a
  `.sql` DB backup. Add:
  - PNG/SVG export of the canvas (with scale bar + measurements baked in).
  - A "stack report" (printable → Save as PDF) listing every layer
    (flake ID, material, thickness, size, position, rotation, twist angle)
    alongside the rendered preview.
  - *This is the most useful single addition — the researcher's actual deliverable.*
- ✅ **Undo / redo.** In-memory snapshot timeline (`utils/useStackHistory.js`)
  wired into `StackEditorPage`. Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) plus header
  buttons cover add / delete / move / reorder / transform. Drags & sliders
  coalesce into one step via a debounced record; restoring a snapshot reconciles
  the backend (deletes re-adds, recreates deletions with id remapping, updates
  transforms, reorders). *Known limit:* watershed masks on a deleted layer are
  not restored when that delete is undone (the layer comes back with a new id).
- ⬜ **Generate a transfer "recipe."** Derive an ordered bottom→top checklist
  from the layers ("pick up flake 042318 (hBN, 3L), rotate 12°, place at …")
  with per-step twist angle and offset. Printable for the bench.

## 2. Domain / scientific features

- ⬜ **Relative twist-angle readout.** Surface a live "twist = θ₂ − θ₁" panel
  between two selected crystal layers; allow snapping to a target twist. Key
  for moiré / magic-angle work.
- ✅ **Overlap / contact-area computation.** Select exactly two flake layers and
  a floating readout (`StackCanvas/OverlapReadout.js`, `utils/overlap.js`) shows
  the contact area in µm² plus its fraction of the smaller flake. Each silhouette
  is rasterized with the live display transform (reusing the export geometry) and
  the alpha masks are intersected. Requires a mask (user-painted or GMM remote)
  on both flakes; recomputes debounced as they're dragged/rotated.
- ⬜ **Re-enable auto-segmentation.** `auto_watershed` and its endpoint are
  commented out pending a better marker heuristic. Wire in the MaskTerial model
  (already hosted on the same machine) for one-click masks.

## 3. UX improvements

- ⬜ **Stack thumbnails on the home page.** Cards show only name/count/date; a
  rendered mini-preview would make the gallery far more navigable.
- ⬜ **Batch flake-notes fetch.** Every `LayerRow` independently calls
  `fetchFlakeNotes` (N requests per render). Add `/flakes/notes?ids=…`.
- ⬜ **Drag-to-reorder layers** (reorder API already exists; UI is up/down arrows only).
- ⬜ **Duplicate stack / "save as template."**
- ⬜ **Arrow-key nudge** for fine layer positioning.
- ⬜ **On-canvas keyboard-shortcut & tool legend overlay.**

## 4. Technical / robustness

- ⬜ **Disable `debug=True` in production** (`app.run(..., debug=True)` — Werkzeug
  debugger RCE risk if ever exposed). Gate behind an env flag.
- ⬜ **Authentication / authorization.** Any client can `DELETE /stacks/<id>`.
- ⬜ **Shared cache across workers.** In-process LRU caches won't be shared if
  multiple Gunicorn workers run — masks re-render per worker.
- ⬜ **Concurrent-edit safety.** Edits are last-write-wins via a 300 ms debounce
  with no `updated_at` conflict check.
- ⬜ **Automated tests** (none currently exist).

---

*Currently being implemented: §1 image / stack report export.*
