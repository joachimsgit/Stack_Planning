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
} from "@mantine/core";
import { IconPencil, IconCheck, IconX, IconUpload } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import AppHeader from "../components/AppHeader/AppHeader";
import StackComposer from "../components/StackComposer/StackComposer";
import StackCanvas from "../components/StackCanvas/StackCanvas";
import FlakePicker from "../components/FlakePicker/FlakePicker";
import {
  fetchStack,
  addLayer,
  updateLayer,
  deleteLayer,
  reorderLayers,
  updateStack,
  uploadImage,
  fetchLayerMasks,
} from "../utils/api";

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

  // Kept current so drag callbacks always see the latest layer positions without
  // recreating the callback on every render.
  const layersRef = useRef(layers);
  useEffect(() => { layersRef.current = layers; }, [layers]);
  const selectedLayerIdsRef = useRef(selectedLayerIds);
  useEffect(() => { selectedLayerIdsRef.current = selectedLayerIds; }, [selectedLayerIds]);

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
  }, []);
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
    setLayers((prev) => [...prev, shape]);
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
      setLayers((prev) =>
        prev.map((l) => (l.id === shape.id ? { ...saved, is_shape: true } : l))
      );
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
      setLayers((prev) => [...prev, newLayer]);
      setActiveLayerIndex(newLayer.layer_index);
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
  }, [id, navigate]);

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
      setLayers((prev) => [...prev, newLayer]);
      setActiveLayerIndex(newLayer.layer_index);
    } catch (err) {
      notifications.show({ color: "red", message: `Failed to add layer: ${err.message}` });
    }
  };

  // updateLayer is called frequently (drag, sliders) — persist to backend after a short debounce
  const persistLayerUpdate = useCallback(
    async (layerId, data) => {
      if (typeof layerId === "string") return;
      try {
        const updated = await updateLayer(id, layerId, data);
        setLayers((prev) =>
          prev.map((l) => (l.id === updated.id ? updated : l))
        );
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
    },
    [debouncedPersist]
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
    setLayers((prev) =>
      prev.map((l) => {
        const entry = newOrder.find((o) => o.id === l.id);
        return entry ? { ...l, layer_index: entry.layer_index } : l;
      })
    );
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
