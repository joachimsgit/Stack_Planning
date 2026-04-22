import { Slider, Button, Text, Group, Stack, Divider } from "@mantine/core";

const DISPLAY_BUTTONS = [
  { key: "background", label: "Background" },
  { key: "flake",      label: "Flake"       },
  { key: "bbox",       label: "Bbox"        },
  { key: "outline",    label: "Outline"     },
];

function CanvasControls({ layer, displayModes, onToggleMode, onSetDisplayColor, onUpdateTransform }) {
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
            <div>
              <Text size="xs" weight={500} mb={4}>Display</Text>
              <Group spacing={4}>
                {DISPLAY_BUTTONS.map(({ key, label }) => (
                  <Button
                    key={key}
                    size="xs"
                    compact
                    variant={displayModes[key] ? "filled" : "default"}
                    onClick={() => onToggleMode(key)}
                    disabled={layer.is_local && key !== "background"}
                  >
                    {label}
                  </Button>
                ))}
              </Group>
              {!layer.is_local && (
                <Group spacing={12} mt={6} align="center">
                  <Group spacing={4} align="center">
                    <Text size="xs" color="dimmed">Bbox colour</Text>
                    <input
                      type="color"
                      value={displayModes.bbox_color || "#ffdd00"}
                      onChange={(e) => onSetDisplayColor && onSetDisplayColor("bbox_color", e.target.value)}
                      style={{
                        width: 26, height: 22, padding: 2,
                        border: "1px solid var(--mantine-color-gray-4, #ced4da)",
                        borderRadius: 4, cursor: "pointer", background: "none",
                      }}
                    />
                  </Group>
                  <Group spacing={4} align="center">
                    <Text size="xs" color="dimmed">Outline colour</Text>
                    <input
                      type="color"
                      value={displayModes.outline_color || "#ffdd00"}
                      onChange={(e) => onSetDisplayColor && onSetDisplayColor("outline_color", e.target.value)}
                      style={{
                        width: 26, height: 22, padding: 2,
                        border: "1px solid var(--mantine-color-gray-4, #ced4da)",
                        borderRadius: 4, cursor: "pointer", background: "none",
                      }}
                    />
                  </Group>
                </Group>
              )}
            </div>
          )}

          <Divider />

          <div>
            <Group position="apart">
              <Text size="xs" weight={500}>Rotation</Text>
              <Text size="xs" color="dimmed">{layer.rotation.toFixed(0)}°</Text>
            </Group>
            <Slider
              min={-180} max={180} step={1}
              value={layer.rotation}
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
