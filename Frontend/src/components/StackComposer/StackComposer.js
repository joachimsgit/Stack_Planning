import "./StackComposer.css";
import { useState, useEffect } from "react";
import { ActionIcon, Badge, Button, Group, Text } from "@mantine/core";
import {
  IconTrash,
  IconChevronUp,
  IconChevronDown,
  IconPlus,
  IconInfoCircle,
  IconEye,
  IconEyeOff,
} from "@tabler/icons-react";
import { flakeImageUrl, fetchFlakeNotes, resolveLocalImageUrl } from "../../utils/api";
import FlakeInfoModal from "./FlakeInfoModal";

const MATERIAL_COLORS = {
  Graphene: "gray",
  hBN: "yellow",
  WSe2: "green",
  MoS2: "blue",
  MoSe2: "cyan",
  WS2: "teal",
};

function LayerRow({ layer, isActive, isSelected, onSelect, onDelete, onMoveUp, onMoveDown, onInfo, isFirst, isLast, isHidden, onToggleVisibility }) {
  const isShape = !!layer.is_shape;
  const isLocal = !!layer.is_local;
  const [notesPreview, setNotesPreview] = useState("");

  useEffect(() => {
    if (isShape || isLocal || !layer.flake_id) return;
    fetchFlakeNotes(layer.flake_id)
      .then((data) => setNotesPreview(data.notes || ""))
      .catch(() => {});
  }, [layer.flake_id, isShape, isLocal]);

  const shapeLabel = (t) => {
    switch (t) {
      case "rect":     return "Rect";
      case "freehand": return "Draw";
      case "polygon":  return "Polygon";
      case "distance": return "Distance";
      case "angle":    return "Angle";
      default:         return "Shape";
    }
  };
  const material = isShape
    ? shapeLabel(layer.shape_type)
    : (layer.flake_material || "Unknown");
  const shapeBadgeColor = {
    distance: "red",
    angle:    "red",
    polygon:  "grape",
  }[layer.shape_type] || "orange";
  const badgeColor = isShape ? shapeBadgeColor : (MATERIAL_COLORS[material] || "violet");

  const imgUrl = isShape
    ? null
    : (resolveLocalImageUrl(layer.local_image_url) || flakeImageUrl(layer.flake_path, "eval_img.jpg"));

  const subtext = isShape
    ? null
    : isLocal
    ? "Imported image"
    : `ID ${layer.flake_id}${layer.flake_thickness ? ` · ${layer.flake_thickness}` : ""}${layer.flake_size ? ` · ${layer.flake_size.toFixed(0)} μm²` : ""}`;

  return (
    <div
      className={`layerRow ${isActive ? "layerRowActive" : ""} ${isSelected && !isActive ? "layerRowSelected" : ""}`}
      onClick={(e) => onSelect(e)}
    >
      {/* Top action row — visibility + info, prominently placed */}
      <div className="layerRowTopActions" onClick={(e) => e.stopPropagation()}>
        <ActionIcon
          size="lg"
          variant={isHidden ? "filled" : "light"}
          color={isHidden ? "gray" : "blue"}
          onClick={onToggleVisibility}
          title={isHidden ? "Show layer" : "Hide layer"}
        >
          {isHidden ? <IconEyeOff size={20} /> : <IconEye size={20} />}
        </ActionIcon>
        {!isShape && onInfo && (
          <ActionIcon size="lg" variant="light" color="blue" onClick={onInfo} title="Flake info">
            <IconInfoCircle size={20} />
          </ActionIcon>
        )}
      </div>

      {/* Body: thumb + info + side actions */}
      <div className="layerRowBody">
        {isShape ? (
          <div
            className="layerRowThumb"
            style={{ background: layer.shape_color || "#2196f3", borderRadius: 2, flexShrink: 0 }}
          />
        ) : imgUrl ? (
          <img className="layerRowThumb" src={imgUrl} alt={`Flake ${layer.flake_id}`} />
        ) : (
          <div className="layerRowThumbEmpty">
            <Text size="xs" color="dimmed">?</Text>
          </div>
        )}

        <div className="layerRowInfo">
          <Badge color={badgeColor} variant="light" size="sm">{material}</Badge>
          {subtext && (
            <Text size="xs" color="dimmed" truncate>{subtext}</Text>
          )}
          <Text size="xs" color="dimmed">Layer {layer.layer_index}</Text>
          {notesPreview && (
            <Text size="xs" color="dimmed" truncate style={{ fontStyle: "italic" }}>
              {notesPreview}
            </Text>
          )}
        </div>

        <div className="layerRowActions" onClick={(e) => e.stopPropagation()}>
          <ActionIcon size="md" variant="subtle" onClick={onMoveUp} disabled={isFirst} title="Move up">
            <IconChevronUp size={18} />
          </ActionIcon>
          <ActionIcon size="md" variant="subtle" onClick={onMoveDown} disabled={isLast} title="Move down">
            <IconChevronDown size={18} />
          </ActionIcon>
          <ActionIcon size="md" color="red" variant="subtle" onClick={onDelete} title="Delete layer">
            <IconTrash size={18} />
          </ActionIcon>
        </div>
      </div>
    </div>
  );
}

function StackComposer({ layers, activeLayerIndex, selectedLayerIds, onSelectLayer, onDeleteLayer, onReorderLayers, onAddLayer, hiddenLayers, onToggleLayerVisibility, stackId, onMasksChanged }) {
  const sorted = [...layers].sort((a, b) => a.layer_index - b.layer_index);
  const [infoLayerId, setInfoLayerId] = useState(null);
  // Look up the up-to-date layer object each render so `masks` stays fresh
  // after a watershed save triggers a parent refetch.
  const infoLayer = infoLayerId != null
    ? sorted.find((l) => l.id === infoLayerId) || null
    : null;

  const handleMoveUp = (idx) => {
    if (idx === 0) return;
    const newOrder = sorted.map((l, i) => {
      if (i === idx) return { id: l.id, layer_index: l.layer_index - 1 };
      if (i === idx - 1) return { id: l.id, layer_index: l.layer_index + 1 };
      return { id: l.id, layer_index: l.layer_index };
    });
    onReorderLayers(newOrder);
  };

  const handleMoveDown = (idx) => {
    if (idx === sorted.length - 1) return;
    const newOrder = sorted.map((l, i) => {
      if (i === idx) return { id: l.id, layer_index: l.layer_index + 1 };
      if (i === idx + 1) return { id: l.id, layer_index: l.layer_index - 1 };
      return { id: l.id, layer_index: l.layer_index };
    });
    onReorderLayers(newOrder);
  };

  return (
    <div className="stackComposerRoot">
      <div className="stackComposerHeader">
        <Text weight={600} size="sm">
          Stack Layers ({sorted.length})
        </Text>
        <Text size="xs" color="dimmed">
          Bottom → top order
        </Text>
      </div>

      <div className="stackComposerList">
        {sorted.length === 0 ? (
          <Text size="xs" color="dimmed" align="center" mt="lg">
            No layers yet. Add a flake to start.
          </Text>
        ) : (
          sorted.map((layer, idx) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              isActive={layer.layer_index === activeLayerIndex}
              isSelected={selectedLayerIds ? selectedLayerIds.has(layer.id) : false}
              onSelect={(e) => {
                const multi = e && (e.ctrlKey || e.metaKey);
                if (multi) {
                  onSelectLayer(layer.layer_index, { toggle: true });
                } else if (layer.layer_index === activeLayerIndex) {
                  onSelectLayer(null);
                } else {
                  onSelectLayer(layer.layer_index);
                }
              }}
              onDelete={() => onDeleteLayer(layer.id)}
              onMoveUp={() => handleMoveUp(idx)}
              onMoveDown={() => handleMoveDown(idx)}
              onInfo={layer.is_shape ? null : () => setInfoLayerId(layer.id)}
              isFirst={idx === 0}
              isLast={idx === sorted.length - 1}
              isHidden={hiddenLayers ? hiddenLayers.has(layer.id) : false}
              onToggleVisibility={() => onToggleLayerVisibility(layer.id)}
            />
          ))
        )}
      </div>

      <div className="stackComposerFooter">
        <Button
          leftIcon={<IconPlus size="0.9rem" />}
          variant="light"
          size="xs"
          fullWidth
          onClick={onAddLayer}
        >
          Add Layer
        </Button>
      </div>

      <FlakeInfoModal
        layer={infoLayer}
        opened={infoLayer !== null}
        onClose={() => setInfoLayerId(null)}
        stackId={stackId}
        onMasksChanged={onMasksChanged}
      />
    </div>
  );
}

export default StackComposer;
