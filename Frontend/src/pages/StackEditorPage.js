import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Center,
  Drawer,
  Group,
  Loader,
  Text,
  TextInput,
  ActionIcon,
  Button,
  Tooltip,
} from "@mantine/core";
import {
  IconPencil,
  IconCheck,
  IconX,
  IconUpload,
  IconArrowBackUp,
  IconArrowForwardUp,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import AppHeader from "../components/AppHeader/AppHeader";
import StackComposer from "../components/StackComposer/StackComposer";
import StackCanvas from "../components/StackCanvas/StackCanvas";
import FlakePicker from "../components/FlakePicker/FlakePicker";
import { useStackHistory } from "../utils/useStackHistory";
import {
  fetchStack,
  addLayer,
  updateLayer,
  deleteLayer,
  reorderLayers,
  updateStack,
  uploadImage,
  fetchLayerMasks,
  fetchFlakeById,
} from "../utils/api";

// Tracked fields the backend's PUT /layers/<id> can update (excluding
// layer_index, which is handled by the dedicated reorder endpoint).
const UPDATABLE_FIELDS = [
  "pos_x",
  "pos_y",
  "rotation",
  "opacity",
  "brightness",
  "contrast",
  "shape_color",
  "shape_stroke_width",
  "canvas_base_filename",
  "name",
];

function remapSet(set, oldId, newId) {
  if (!set.has(oldId)) return set;
  const next = new Set(set);
  next.delete(oldId);
  next.add(newId);
  return next;
}

// Build a POST /layers payload that recreates a layer from a history snapshot.
function buildAddPayload(l) {
  const common = {
    layer_index: l.layer_index,
    pos_x: l.pos_x ?? 0,
    pos_y: l.pos_y ?? 0,
    rotation: l.rotation ?? 0,
    opacity: l.opacity ?? 1,
    name: l.name ?? null,
  };
  if (l.is_shape) {
    return {
      ...common,
      is_shape: true,
      shape_type: l.shape_type,
      shape_data: l.shape_data,
      shape_color: l.shape_color,
      shape_stroke_width: l.shape_stroke_width,
    };
  }
  if (l.is_local) {
    return {
      ...common,
      is_local: true,
      local_image_url: l.local_image_url,
      flake_material: l.flake_material,
      brightness: l.brightness ?? 1,
      contrast: l.contrast ?? 1,
    };
  }
  return {
    ...common,
    flake_id: l.flake_id,
    flake_material: l.flake_material,
    flake_size: l.flake_size,
    flake_thickness: l.flake_thickness,
    flake_path: l.flake_path,
    image_filename: l.image_filename,
    canvas_base_filename: l.canvas_base_filename,
    brightness: l.brightness ?? 1,
    contrast: l.contrast ?? 1,
  };
}

// Fields of `target` that differ from the live layer and need a backend update.
function transformDiff(live, target) {
  const diff = {};
  for (const f of UPDATABLE_FIELDS) {
    if ((target[f] ?? null) !== (live[f] ?? null)) diff[f] = target[f];
  }
  if (JSON.stringify(target.shape_data ?? null) !== JSON.stringify(live.shape_data ?? null)) {
    diff.shape_data = target.shape_data ?? null;
  }
  return diff;
}

// Debounce helper — returns a function that delays calling fn by `delay` ms
function useDebounce(fn, delay) {
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback(
    (...args) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => fn(...args), delay);
    },
    [fn, delay]
  );
}

function StackEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [stack, setStack] = useState(null);
  const [layers, setLayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeLayerIndex, setActiveLayerIndex] = useState(null);
  const [selectedLayerIds, setSelectedLayerIds] = useState(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hiddenLayers, setHiddenLayers] = useState(new Set());
  const [flakeIdInput, setFlakeIdInput] = useState("");
  const [flakeIdLoading, setFlakeIdLoading] = useState(false);

  // Kept current so drag callbacks always see the latest layer positions without
  // recreating the callback on every render.
  const layersRef = useRef(layers);
  useEffect(() => { layersRef.current = layers; }, [layers]);
  const selectedLayerIdsRef = useRef(selectedLayerIds);
  useEffect(() => { selectedLayerIdsRef.current = selectedLayerIds; }, [selectedLayerIds]);

  // -----------------------------------------------------------------------
  // Undo / redo history
  // -----------------------------------------------------------------------
  const history = useStackHistory(useCallback(() => layersRef.current, []));
  const {
    reset: resetHistory,
    record: recordHistory,
    recordSoon: recordHistorySoon,
    remapId: remapHistoryId,
    undo: undoHistory,
    redo: redoHistory,
    canUndo,
    canRedo,
  } = history;

  // Reconcile the backend + local state to a restored snapshot. Diffs the
  // current layers against `target`: deletes layers that were re-added, recreates
  // layers that were deleted (remapping their new backend id through the
  // timeline), updates changed transforms, and reorders. Backend failures are
  // non-fatal, mirroring the app's optimistic-write pattern elsewhere.
  const applySnapshot = useCallback(
    async (target) => {
      const cur = layersRef.current;
      const curById = new Map(cur.map((l) => [l.id, l]));
      const tgtIds = new Set(target.map((l) => l.id));

      // Carry over live masks so watershed edits survive an undo/redo.
      const resolved = target.map((l) => {
        const live = curById.get(l.id);
        return { ...l, masks: live ? live.masks : l.masks || {} };
      });

      // Optimistic local state first for instant feedback.
      setLayers(resolved);
      setSelectedLayerIds((prev) => new Set([...prev].filter((x) => tgtIds.has(x))));
      setHiddenLayers((prev) => new Set([...prev].filter((x) => tgtIds.has(x))));
      setActiveLayerIndex((prev) =>
        resolved.some((l) => l.layer_index === prev)
          ? prev
          : resolved.length
          ? resolved[0].layer_index
          : null
      );

      // 1) Delete layers present now but absent in the target.
      for (const l of cur) {
        if (!tgtIds.has(l.id) && typeof l.id === "number") {
          try {
            await deleteLayer(id, l.id);
          } catch {
            /* non-fatal */
          }
        }
      }

      // 2) Recreate layers present in the target but not currently — they were
      //    deleted earlier and are coming back with a fresh backend id.
      for (const l of resolved) {
        if (curById.has(l.id)) continue;
        try {
          const saved = await addLayer(id, buildAddPayload(l));
          if (saved && saved.id != null && saved.id !== l.id) {
            const oldId = l.id;
            const newId = saved.id;
            remapHistoryId(oldId, newId);
            l.id = newId;
            setLayers((prev) => prev.map((x) => (x.id === oldId ? { ...x, id: newId } : x)));
            setHiddenLayers((prev) => remapSet(prev, oldId, newId));
            setSelectedLayerIds((prev) => remapSet(prev, oldId, newId));
          }
        } catch {
          /* non-fatal */
        }
      }

      // 3) Update survivors whose transform fields changed.
      for (const l of resolved) {
        const live = curById.get(l.id); // recreated layers have a new id → skipped
        if (!live || typeof l.id !== "number") continue;
        const diff = transformDiff(live, l);
        if (Object.keys(diff).length) {
          try {
            await updateLayer(id, l.id, diff);
          } catch {
            /* non-fatal */
          }
        }
      }

      // 4) Reassert layer order.
      const order = resolved
        .filter((l) => typeof l.id === "number")
        .map((l) => ({ id: l.id, layer_index: l.layer_index }));
      if (order.length) {
        try {
          await reorderLayers(id, order);
        } catch {
          /* non-fatal */
        }
      }
    },
    [id, remapHistoryId]
  );

  // Serialize snapshot applications so rapid undo/redo can't interleave backend
  // calls out of order.
  const applyChainRef = useRef(Promise.resolve());
  const enqueueApply = useCallback(
    (target) => {
      applyChainRef.current = applyChainRef.current
        .then(() => applySnapshot(target))
        .catch(() => {});
      return applyChainRef.current;
    },
    [applySnapshot]
  );

  const handleUndo = useCallback(() => {
    const target = undoHistory();
    if (target) enqueueApply(target);
  }, [undoHistory, enqueueApply]);

  const handleRedo = useCallback(() => {
    const target = redoHistory();
    if (target) enqueueApply(target);
  }, [redoHistory, enqueueApply]);

  // Keyboard shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z redo.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndo, handleRedo]);

  const handleToggleLayerVisibility = useCallback((layerId) => {
    setHiddenLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  }, []);

  // Unified selection entry point.
  //   - handleSelectLayer(layerIndex): select a single layer (or null to clear).
  //   - handleSelectLayer(layerIndex, { toggle: true }): Ctrl/Cmd-click; toggle
  //     the layer in the multi-selection without disturbing the rest.
  const handleSelectLayer = useCallback((layerIndex, opts) => {
    if (layerIndex === null || layerIndex === undefined) {
      setActiveLayerIndex(null);
      setSelectedLayerIds(new Set());
      return;
    }
    const layer = layersRef.current.find((l) => l.layer_index === layerIndex);
    if (!layer) return;
    if (opts && opts.toggle) {
      setSelectedLayerIds((prev) => {
        const next = new Set(prev);
        if (next.has(layer.id)) next.delete(layer.id);
        else next.add(layer.id);
        return next;
      });
      setActiveLayerIndex(layerIndex);
    } else {
      setSelectedLayerIds(new Set([layer.id]));
      setActiveLayerIndex(layerIndex);
    }
  }, []);

  // Batch-update several layers at once (used for group drag / rotate).
  // Each update: { id, pos_x?, pos_y?, rotation? }
  const handleUpdateManyLayers = useCallback((updates) => {
    const byId = new Map(updates.map((u) => [u.id, u]));
    setLayers((prev) =>
      prev.map((l) => (byId.has(l.id) ? { ...l, ...byId.get(l.id) } : l))
    );
    updates.forEach((u) => {
      const { id, ...data } = u;
      if (typeof id !== "number") return;
      debouncedPersistRef.current?.(id, data);
    });
    recordHistorySoon();
  }, [recordHistorySoon]);
  const debouncedPersistRef = useRef(null);

  // Inline stack name editing
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");

  // Inline stack user editing
  const [editingUser, setEditingUser] = useState(false);
  const [userInput, setUserInput] = useState("");

  // Local image import
  const fileInputRef = useRef(null);

  const handleAddShape = async (shape) => {
    // Optimistically add to state so the shape appears immediately
    const optimistic = [...layersRef.current, shape];
    setLayers(optimistic);
    setActiveLayerIndex(shape.layer_index);

    try {
      const saved = await addLayer(id, {
        is_shape: true,
        shape_type: shape.shape_type,
        shape_data: shape.shape_data,
        shape_color: shape.shape_color,
        shape_stroke_width: shape.shape_stroke_width,
        layer_index: shape.layer_index,
        pos_x: shape.pos_x,
        pos_y: shape.pos_y,
        rotation: shape.rotation,
        opacity: shape.opacity,
      });
      // Replace the temporary id with the real database id
      const next = optimistic.map((l) => (l.id === shape.id ? { ...saved, is_shape: true } : l));
      setLayers(next);
      recordHistory(next);
    } catch (err) {
      notifications.show({ color: "red", title: "Save failed", message: "Shape could not be saved to the database." });
    }
  };

  const handleImportImage = async (e) => {
    const file = e.target.files?.[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";
    if (!file) return;
    const nextIndex = layers.length > 0 ? Math.max(...layers.map((l) => l.layer_index)) + 1 : 1;
    try {
      const { url } = await uploadImage(file);
      const newLayer = await addLayer(id, {
        is_local: true,
        local_image_url: url,
        flake_material: "Custom",
        layer_index: nextIndex,
        opacity: 1,
      });
      const next = [...layersRef.current, newLayer];
      setLayers(next);
      setActiveLayerIndex(newLayer.layer_index);
      recordHistory(next);
    } catch (err) {
      notifications.show({ color: "red", title: "Import failed", message: err.message || "Could not save image" });
    }
  };

  // -----------------------------------------------------------------------
  // Load stack on mount
  // -----------------------------------------------------------------------

  useEffect(() => {
    fetchStack(id)
      .then((data) => {
        setStack({ id: data.id, name: data.name, notes: data.notes, username: data.username });
        setLayers(data.layers || []);
        resetHistory(data.layers || []);
        setNameInput(data.name);
        if (data.layers && data.layers.length > 0) {
          setActiveLayerIndex(data.layers[0].layer_index);
        }
      })
      .catch(() => {
        notifications.show({ color: "red", message: "Could not load stack" });
        navigate("/");
      })
      .finally(() => setLoading(false));
  }, [id, navigate, resetHistory]);

  // -----------------------------------------------------------------------
  // Layer callbacks
  // -----------------------------------------------------------------------

  const handleAddFlake = async (flake) => {
    setPickerOpen(false);
    try {
      const newLayer = await addLayer(id, {
        flake_id: flake.flake_id,
        flake_material: flake.chip_material,
        flake_size: flake.flake_size,
        flake_thickness: flake.flake_thickness,
        flake_path: flake.flake_path,
      });
      const next = [...layersRef.current, newLayer];
      setLayers(next);
      setActiveLayerIndex(newLayer.layer_index);
      recordHistory(next);
    } catch (err) {
      notifications.show({ color: "red", message: `Failed to add layer: ${err.message}` });
    }
  };

  const handleFlakeIdChange = async (raw) => {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setFlakeIdInput(digits);
    if (digits.length !== 6 || flakeIdLoading) return;
    setFlakeIdLoading(true);
    try {
      const flake = await fetchFlakeById(digits);
      await handleAddFlake(flake);
      setFlakeIdInput("");
    } catch (err) {
      notifications.show({ color: "red", title: "Flake not found", message: err.message });
    } finally {
      setFlakeIdLoading(false);
    }
  };

  // updateLayer is called frequently (drag, sliders) — persist to backend after a short debounce
  const persistLayerUpdate = useCallback(
    async (layerId, data) => {
      if (typeof layerId === "string") return;
      try {
        await updateLayer(id, layerId, data);
      } catch {
        // silently ignore transient save errors during drag
      }
    },
    [id]
  );
  const debouncedPersist = useDebounce(persistLayerUpdate, 300);
  useEffect(() => { debouncedPersistRef.current = debouncedPersist; }, [debouncedPersist]);

  const handleUpdateLayer = useCallback(
    (layerId, data) => {
      // Optimistically update local state immediately for smooth UX
      setLayers((prev) =>
        prev.map((l) => (l.id === layerId ? { ...l, ...data } : l))
      );
      debouncedPersist(layerId, data);
      recordHistorySoon();
    },
    [debouncedPersist, recordHistorySoon]
  );

  const handleDeleteLayer = async (layerId) => {
    if (typeof layerId !== "string") {
      try {
        await deleteLayer(id, layerId);
      } catch (err) {
        notifications.show({ color: "red", message: `Failed to delete layer: ${err.message}` });
        return;
      }
    }

    const remaining = layers
      .filter((l) => l.id !== layerId)
      .sort((a, b) => a.layer_index - b.layer_index)
      .map((l, i) => ({ ...l, layer_index: i }));

    setLayers(remaining);

    if (remaining.length === 0) {
      setActiveLayerIndex(null);
    } else {
      const prevActive = layers.find((l) => l.layer_index === activeLayerIndex && l.id !== layerId);
      const relocated = prevActive && remaining.find((l) => l.id === prevActive.id);
      setActiveLayerIndex(relocated ? relocated.layer_index : remaining[0].layer_index);
    }

    const remoteOrder = remaining
      .filter((l) => typeof l.id === "number")
      .map((l) => ({ id: l.id, layer_index: l.layer_index }));
    if (remoteOrder.length > 0) {
      reorderLayers(id, remoteOrder).catch(() => {});
    }

    recordHistory(remaining);
  };

  // Called after WatershedEditor save / discard. Refetch the layer's masks
  // from the backend and merge them into state so `layer.masks` is current on
  // the canvas and in the FlakeInfo modal.
  const handleLayerMasksChanged = useCallback(
    async (layerId) => {
      if (typeof layerId !== "number") return;
      try {
        const masks = await fetchLayerMasks(id, layerId);
        setLayers((prev) =>
          prev.map((l) => (l.id === layerId ? { ...l, masks: masks || {} } : l))
        );
      } catch {
        // ignore — stale masks just mean the user needs to reopen the modal
      }
    },
    [id]
  );

  const handleReorderLayers = async (newOrder) => {
    // Optimistic update for all layers (local + remote)
    const next = layersRef.current.map((l) => {
      const entry = newOrder.find((o) => o.id === l.id);
      return entry ? { ...l, layer_index: entry.layer_index } : l;
    });
    setLayers(next);
    recordHistory(next);
    const remoteOrder = newOrder.filter((o) => typeof o.id === "number");
    if (remoteOrder.length === 0) return;
    try {
      const updatedStack = await reorderLayers(id, remoteOrder);
      setLayers((prev) => {
        const clientLayers = prev.filter((l) => typeof l.id === "string");
        return [...(updatedStack.layers || []), ...clientLayers];
      });
    } catch (err) {
      notifications.show({ color: "red", message: `Failed to reorder: ${err.message}` });
    }
  };

  // -----------------------------------------------------------------------
  // Name editing
  // -----------------------------------------------------------------------

  const saveStackName = async () => {
    if (!nameInput.trim()) return;
    try {
      const updated = await updateStack(id, { name: nameInput.trim() });
      setStack((prev) => ({ ...prev, name: updated.name }));
      setEditingName(false);
    } catch {
      notifications.show({ color: "red", message: "Failed to rename stack" });
    }
  };

  const saveStackUser = async () => {
    try {
      const updated = await updateStack(id, { username: userInput.trim() });
      setStack((prev) => ({ ...prev, username: updated.username }));
      setEditingUser(false);
    } catch {
      notifications.show({ color: "red", message: "Failed to update stack user" });
    }
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <Center style={{ height: "100vh" }}>
        <Loader />
      </Center>
    );
  }

  const headerRight = (
    <Group spacing={8}>
      <Group spacing={2}>
        <Tooltip label="Undo (Ctrl+Z)" withArrow>
          <ActionIcon
            size="sm"
            variant="default"
            onClick={handleUndo}
            disabled={!canUndo}
          >
            <IconArrowBackUp size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Redo (Ctrl+Y)" withArrow>
          <ActionIcon
            size="sm"
            variant="default"
            onClick={handleRedo}
            disabled={!canRedo}
          >
            <IconArrowForwardUp size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
      {editingName ? (
        <Group spacing={4}>
          <TextInput
            value={nameInput}
            onChange={(e) => setNameInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveStackName();
              if (e.key === "Escape") setEditingName(false);
            }}
            size="xs"
            autoFocus
          />
          <ActionIcon size="sm" color="green" onClick={saveStackName}><IconCheck size={14} /></ActionIcon>
          <ActionIcon size="sm" color="red" onClick={() => setEditingName(false)}><IconX size={14} /></ActionIcon>
        </Group>
      ) : (
        <Group spacing={4}>
          <Text weight={600} size="sm">{stack?.name}</Text>
          <ActionIcon size="sm" variant="subtle" onClick={() => { setNameInput(stack?.name || ""); setEditingName(true); }}>
            <IconPencil size={14} />
          </ActionIcon>
        </Group>
      )}
      {editingUser ? (
        <Group spacing={4}>
          <TextInput
            value={userInput}
            onChange={(e) => setUserInput(e.currentTarget.value)}
            placeholder="user name"
            size="xs"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") saveStackUser();
              if (e.key === "Escape") setEditingUser(false);
            }}
          />
          <ActionIcon size="sm" color="green" onClick={saveStackUser}><IconCheck size={14} /></ActionIcon>
          <ActionIcon size="sm" color="red" onClick={() => setEditingUser(false)}><IconX size={14} /></ActionIcon>
        </Group>
      ) : (
        <Group spacing={4}>
          <Text size="sm" color="dimmed">{stack?.username || "no user"}</Text>
          <ActionIcon size="sm" variant="subtle" onClick={() => { setUserInput(stack?.username || ""); setEditingUser(true); }}>
            <IconPencil size={14} />
          </ActionIcon>
        </Group>
      )}
      <TextInput
        placeholder="Flake ID"
        value={flakeIdInput}
        onChange={(e) => handleFlakeIdChange(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        size="xs"
        style={{ width: 90 }}
        disabled={flakeIdLoading}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleImportImage}
      />
      <Button
        leftIcon={<IconUpload size="0.9rem" />}
        variant="default"
        size="xs"
        onClick={() => fileInputRef.current?.click()}
      >
        Import Image
      </Button>
    </Group>
  );

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        <AppHeader rightSection={headerRight} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "280px 1fr",
            flex: 1,
            overflow: "hidden",
          }}
        >
          {/* Left: stack composer */}
          <StackComposer
            layers={layers}
            activeLayerIndex={activeLayerIndex}
            selectedLayerIds={selectedLayerIds}
            onSelectLayer={handleSelectLayer}
            onDeleteLayer={handleDeleteLayer}
            onReorderLayers={handleReorderLayers}
            onAddLayer={() => setPickerOpen(true)}
            hiddenLayers={hiddenLayers}
            onToggleLayerVisibility={handleToggleLayerVisibility}
            stackId={id}
            onMasksChanged={handleLayerMasksChanged}
          />

          {/* Centre: canvas */}
          <StackCanvas
            layers={layers}
            activeLayerIndex={activeLayerIndex}
            selectedLayerIds={selectedLayerIds}
            onSelectLayer={handleSelectLayer}
            onUpdateLayer={handleUpdateLayer}
            onUpdateManyLayers={handleUpdateManyLayers}
            onAddShape={handleAddShape}
            hiddenLayers={hiddenLayers}
            stackMeta={stack}
          />
        </div>
      </div>

      {/* Right: flake picker drawer */}
      <Drawer
        opened={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Pick a Flake"
        position="right"
        size={780}
        padding={0}
        styles={{ body: { padding: 0, height: "calc(100% - 60px)", overflow: "hidden" } }}
      >
        <FlakePicker onSelectFlake={handleAddFlake} />
      </Drawer>
    </>
  );
}

export default StackEditorPage;
