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
import { flakeImageUrl, fetchFlakeNotes } from "../../utils/api";
import FlakeInfoModal from "./FlakeInfoModal";

const MATERIAL_COLORS = {
  Graphene: "gray",
  hBN: "yellow",
  WSe2: "green",
  MoS2: "blue",
  MoSe2: "cyan",
  WS2: "teal",
};

function LayerRow({ layer, isActive, onSelect, onDelete, onMoveUp, onMoveDown, onInfo, isFirst, isLast, isHidden, onToggleVisibility }) {
  const isShape = !!layer.is_shape;
  const isLocal = !!layer.is_local;
  const [notesPreview, setNotesPreview] = useState("");

  useEffect(() => {
    if (isShape || isLocal || !layer.flake_id) return;
    fetchFlakeNotes(layer.flake_id)
      .then((data) => setNotesPreview(data.notes || ""))
      .catch(() => {});
  }, [layer.flake_id, isShape, isLocal]);

  const material = isShape
    ? (layer.shape_type === "rect" ? "Rect" : "Draw")
    : (layer.flake_material || "Unknown");
  const badgeColor = isShape ? "orange" : (MATERIAL_COLORS[material] || "violet");

  const imgUrl = isShape ? null : (layer.local_image_url || flakeImageUrl(layer.flake_path, "eval_img.jpg"));

  const subtext = isShape
    ? null
    : isLocal
    ? "Imported image"
    : `ID ${layer.flake_id}${layer.flake_thickness ? ` · ${layer.flake_thickness}` : ""}${layer.flake_size ? ` · ${layer.flake_size.toFixed(0)} μm²` : ""}`;

  return (
    <div
      className={`layerRow ${isActive ? "layerRowActive" : ""}`}
      onClick={onSelect}
    >
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
        <Badge color={badgeColor} variant="light" size="xs">{material}</Badge>
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
        <ActionIcon size="xs" variant="subtle" onClick={onToggleVisibility} title={isHidden ? "Show layer" : "Hide layer"}>
          {isHidden ? <IconEyeOff size={12} /> : <IconEye size={12} />}
        </ActionIcon>
        {!isShape && onInfo && (
          <ActionIcon size="xs" variant="subtle" onClick={onInfo} title="Flake info">
            <IconInfoCircle size={12} />
          </ActionIcon>
        )}
        <ActionIcon size="xs" variant="subtle" onClick={onMoveUp} disabled={isFirst}>
          <IconChevronUp size={12} />
        </ActionIcon>
        <ActionIcon size="xs" variant="subtle" onClick={onMoveDown} disabled={isLast}>
          <IconChevronDown size={12} />
        </ActionIcon>
        <ActionIcon size="xs" color="red" variant="subtle" onClick={onDelete}>
          <IconTrash size={12} />
        </ActionIcon>
      </div>
    </div>
  );
}

function StackComposer({ layers, activeLayerIndex, onSelectLayer, onDeleteLayer, onReorderLayers, onAddLayer, hiddenLayers, onToggleLayerVisibility }) {
  const sorted = [...layers].sort((a, b) => a.layer_index - b.layer_index);
  const [infoLayer, setInfoLayer] = useState(null);

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
              onSelect={() => layer.layer_index === activeLayerIndex ? onSelectLayer(null) : onSelectLayer(layer.layer_index)}
              onDelete={() => onDeleteLayer(layer.id)}
              onMoveUp={() => handleMoveUp(idx)}
              onMoveDown={() => handleMoveDown(idx)}
              onInfo={layer.is_shape ? null : () => setInfoLayer(layer)}
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
        onClose={() => setInfoLayer(null)}
      />
    </div>
  );
}

export default StackComposer;
