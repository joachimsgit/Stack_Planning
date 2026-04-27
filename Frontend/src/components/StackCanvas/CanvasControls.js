import { useState, useEffect } from "react";
import { Slider, Button, Text, Group, Stack, Divider, NumberInput } from "@mantine/core";
import {
  BASE_IMAGE_ORDER,
  MAGNIFICATION_CALIBRATION,
  baseSupportsRemoteOverlay,
} from "../../utils/calibration";
import { fetchAvailableImages } from "../../utils/api";

const normalizeRotation = (r) => {
  const mod = ((Number(r) || 0) % 360 + 360) % 360;
  return Math.round(mod * 100) / 100;
};

const DISPLAY_BUTTONS = [
  { key: "background", label: "Background" },
  { key: "flake",      label: "Flake"       },
  { key: "outline",    label: "Outline"     },
];

function CanvasControls({ layer, displayModes, onToggleMode, onSetDisplayColor, onUpdateTransform }) {
  const [imageExists, setImageExists] = useState(null);

  useEffect(() => {
    if (!layer?.flake_path || layer.is_shape || layer.is_local) {
      setImageExists(null);
      return;
    }
    setImageExists(null);
    fetchAvailableImages(layer.flake_path)
      .then((data) => setImageExists(data))
      .catch(() => setImageExists({}));
  }, [layer?.flake_path, layer?.id]);

  return (
    <Stack spacing="xs" style={{ padding: "0 0.25rem" }}>
      {!layer ? (
        <Text size="xs" color="dimmed" align="center">Select a layer to adjust its settings</Text>
      ) : (
        <>
          {layer.is_shape ? (
            <>
              <Group spacing="xs" align="flex-end">
                <div>
                  <Text size="xs" weight={500} mb={4}>Colour</Text>
                  <input
                    type="color"
                    value={layer.shape_color || "#2196f3"}
                    onChange={(e) => onUpdateTransform({ shape_color: e.target.value })}
                    style={{
                      width: 32, height: 24, padding: 2,
                      border: "1px solid var(--mantine-color-gray-4, #ced4da)",
                      borderRadius: 4, cursor: "pointer", background: "none",
                    }}
                  />
                </div>
              </Group>

              <div>
                <Group position="apart">
                  <Text size="xs" weight={500}>Stroke width</Text>
                  <Text size="xs" color="dimmed">{layer.shape_stroke_width || 2}px</Text>
                </Group>
                <Slider
                  min={1} max={10} step={1}
                  value={layer.shape_stroke_width || 2}
                  onChange={(val) => onUpdateTransform({ shape_stroke_width: val })}
                  size="xs" label={null}
                />
              </div>
            </>
          ) : (
            <>
              {!layer.is_local && (
                <div>
                  <Text size="xs" weight={500} mb={4}>Base image</Text>
                  <Group spacing={4}>
                    {BASE_IMAGE_ORDER.map((file) => {
                      const cal = MAGNIFICATION_CALIBRATION[file];
                      if (!cal) return null;
                      const active = (layer.canvas_base_filename || "raw_img.png") === file;
                      const hasMask = Boolean(layer.masks && layer.masks[file]);
                      // raw_img.png and eval_img.jpg are always available (not probed)
                      const imgAvail = imageExists === null || imageExists[file] !== false;
                      return (
                        <Button
                          key={file}
                          size="xs"
                          compact
                          variant={active ? "filled" : "default"}
                          onClick={() => onUpdateTransform({ canvas_base_filename: file })}
                          style={!imgAvail ? { opacity: 0.45, textDecoration: "line-through" } : undefined}
                          title={!imgAvail ? "Image not available" : hasMask ? "User mask available" : undefined}
                        >
                          {cal.label}{hasMask ? " •" : ""}
                        </Button>
                      );
                    })}
                  </Group>
                </div>
              )}
              <div>
                <Text size="xs" weight={500} mb={4}>Display</Text>
                <Group spacing={4}>
                  {DISPLAY_BUTTONS.map(({ key, label }) => {
                    const baseFile = layer.canvas_base_filename || "raw_img.png";
                    const hasMask = Boolean(layer.masks && layer.masks[baseFile]);
                    const overlaysOk = hasMask || baseSupportsRemoteOverlay(baseFile);
                    const overlayDisabled = (key === "flake" || key === "outline") && !overlaysOk;
                    return (
                      <Button
                        key={key}
                        size="xs"
                        compact
                        variant={displayModes[key] ? "filled" : "default"}
                        onClick={() => onToggleMode(key)}
                        disabled={(layer.is_local && key !== "background") || overlayDisabled}
                        title={overlayDisabled ? "Generate a watershed mask for this magnification first" : undefined}
                      >
                        {label}
                      </Button>
                    );
                  })}
                </Group>
              </div>
            </>
          )}

          <Divider />

          <div>
            <Group position="apart" align="center" noWrap>
              <Text size="xs" weight={500}>Rotation</Text>
              <NumberInput
                value={normalizeRotation(layer.rotation)}
                onChange={(val) => {
                  if (val === "" || val === null || val === undefined) return;
                  onUpdateTransform({ rotation: Number(val) });
                }}
                min={0} max={360} step={0.01} precision={2}
                size="xs"
                hideControls
                rightSection={<Text size="xs" color="dimmed" pr={6}>°</Text>}
                styles={{ input: { width: 74, textAlign: "right" } }}
              />
            </Group>
            <Slider
              min={0} max={360} step={0.01} precision={2}
              value={normalizeRotation(layer.rotation)}
              onChange={(val) => onUpdateTransform({ rotation: val })}
              size="xs" label={null}
            />
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Group position="apart">
                <Text size="xs" weight={500}>Opacity</Text>
                <Text size="xs" color="dimmed">{layer.opacity.toFixed(2)}</Text>
              </Group>
              <Slider
                min={0} max={1} step={0.05}
                value={layer.opacity}
                onChange={(val) => onUpdateTransform({ opacity: val })}
                size="xs" label={null}
              />
            </div>

            {!layer.is_shape && (
              <>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Group position="apart">
                    <Text size="xs" weight={500}>Brightness</Text>
                    <Text size="xs" color="dimmed">{layer.brightness.toFixed(2)}</Text>
                  </Group>
                  <Slider
                    min={0.2} max={3} step={0.05}
                    value={layer.brightness}
                    onChange={(val) => onUpdateTransform({ brightness: val })}
                    size="xs" label={null}
                  />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <Group position="apart">
                    <Text size="xs" weight={500}>Contrast</Text>
                    <Text size="xs" color="dimmed">{layer.contrast.toFixed(2)}</Text>
                  </Group>
                  <Slider
                    min={0.2} max={3} step={0.05}
                    value={layer.contrast}
                    onChange={(val) => onUpdateTransform({ contrast: val })}
                    size="xs" label={null}
                  />
                </div>
              </>
            )}
          </div>
        </>
      )}
    </Stack>
  );
}

export default CanvasControls;
