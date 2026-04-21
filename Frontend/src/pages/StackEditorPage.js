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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hiddenLayers, setHiddenLayers] = useState(new Set());

  const handleToggleLayerVisibility = useCallback((layerId) => {
    setHiddenLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  }, []);

  // Inline stack name editing
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");

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

  const handleImportImage = (e) => {
    const file = e.target.files?.[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";
    if (!file) return;
    const url = URL.createObjectURL(file);
    const nextIndex = layers.length > 0 ? Math.max(...layers.map((l) => l.layer_index)) + 1 : 1;
    const localLayer = {
      id: `local-${Date.now()}`,
      layer_index: nextIndex,
      flake_id: null,
      flake_material: "Custom",
      flake_size: null,
      flake_thickness: null,
      flake_path: null,
      local_image_url: url,
      is_local: true,
      pos_x: 0,
      pos_y: 0,
      rotation: 0,
      opacity: 1,
      brightness: 1,
      contrast: 1,
    };
    setLayers((prev) => [...prev, localLayer]);
    setActiveLayerIndex(nextIndex);
  };

  // -----------------------------------------------------------------------
  // Load stack on mount
  // -----------------------------------------------------------------------

  useEffect(() => {
    fetchStack(id)
      .then((data) => {
        setStack({ id: data.id, name: data.name, notes: data.notes });
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
    const removeLocal = () => {
      setLayers((prev) => {
        const remaining = prev.filter((l) => l.id !== layerId);
        if (remaining.length > 0 && !remaining.find((l) => l.layer_index === activeLayerIndex)) {
          setActiveLayerIndex(remaining[0].layer_index);
        } else if (remaining.length === 0) {
          setActiveLayerIndex(null);
        }
        return remaining;
      });
    };
    if (typeof layerId === "string") { removeLocal(); return; }
    try {
      await deleteLayer(id, layerId);
      removeLocal();
    } catch (err) {
      notifications.show({ color: "red", message: `Failed to delete layer: ${err.message}` });
    }
  };

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
            onSelectLayer={setActiveLayerIndex}
            onDeleteLayer={handleDeleteLayer}
            onReorderLayers={handleReorderLayers}
            onAddLayer={() => setPickerOpen(true)}
            hiddenLayers={hiddenLayers}
            onToggleLayerVisibility={handleToggleLayerVisibility}
          />

          {/* Centre: canvas */}
          <StackCanvas
            layers={layers}
            activeLayerIndex={activeLayerIndex}
            onSelectLayer={setActiveLayerIndex}
            onUpdateLayer={handleUpdateLayer}
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
        size={620}
        padding={0}
        styles={{ body: { padding: 0, height: "calc(100% - 60px)", overflow: "hidden" } }}
      >
        <FlakePicker onSelectFlake={handleAddFlake} />
      </Drawer>
    </>
  );
}

export default StackEditorPage;
