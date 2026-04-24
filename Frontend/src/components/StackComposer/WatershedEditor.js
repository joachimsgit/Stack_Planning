import { useEffect, useRef, useState } from "react";
import { Modal, Button, Group, Slider, Text, Stack, Divider, Loader, Alert } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { flakeImageUrl, createWatershedMask, deleteLayerMask, resolveLocalImageUrl } from "../../utils/api";

/**
 * Paint foreground ("flake") + background scribbles on the selected base image;
 * submit to the backend which runs cv2.watershed and persists the mask.
 *
 * Strokes are tracked in native-image pixel coords (not canvas-local coords)
 * so the backend can rasterise markers at native resolution regardless of the
 * editor's current CSS size.
 */
function WatershedEditor({ opened, onClose, stackId, layer, imageFilename, onSaved }) {
  const imgRef = useRef(null);
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const scaleRef = useRef(1); // native px per canvas-display px
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [mode, setMode] = useState("foreground");
  const [brushRadius, setBrushRadius] = useState(15);
  const [strokes, setStrokes] = useState([]); // [{mode, points: [[nx, ny], ...]}]
  const [generating, setGenerating] = useState(false);
  const [maskUrl, setMaskUrl] = useState(null);
  const [error, setError] = useState(null);

  // Reset everything when opened or when the target image changes.
  useEffect(() => {
    if (!opened) return;
    setStrokes([]);
    setMaskUrl(null);
    setError(null);
    setImgLoaded(false);
    setImgError(false);
  }, [opened, imageFilename, layer?.id]);

  // Redraw overlay whenever strokes change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const nativeToDisplay = 1 / scaleRef.current;
    const r = brushRadius * nativeToDisplay;
    for (const stroke of strokes) {
      ctx.strokeStyle = stroke.mode === "foreground" ? "rgba(76,175,80,0.75)" : "rgba(244,67,54,0.75)";
      ctx.fillStyle = stroke.mode === "foreground" ? "rgba(76,175,80,0.45)" : "rgba(244,67,54,0.45)";
      ctx.lineWidth = r * 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (stroke.points.length === 1) {
        const [nx, ny] = stroke.points[0];
        ctx.beginPath();
        ctx.arc(nx * nativeToDisplay, ny * nativeToDisplay, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        stroke.points.forEach(([nx, ny], i) => {
          const x = nx * nativeToDisplay;
          const y = ny * nativeToDisplay;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
    }
  }, [strokes, brushRadius]);

  function handleImgLoad() {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const displayW = img.clientWidth;
    const displayH = img.clientHeight;
    canvas.width = displayW;
    canvas.height = displayH;
    scaleRef.current = img.naturalWidth / displayW;
    setImgLoaded(true);
  }

  function pointerPosToNative(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    return [cx * scaleRef.current, cy * scaleRef.current];
  }

  function onPointerDown(e) {
    if (!imgLoaded) return;
    e.preventDefault();
    drawingRef.current = true;
    const p = pointerPosToNative(e);
    setStrokes((prev) => [...prev, { mode, points: [p] }]);
  }

  function onPointerMove(e) {
    if (!drawingRef.current) return;
    const p = pointerPosToNative(e);
    setStrokes((prev) => {
      if (!prev.length) return prev;
      const copy = prev.slice(0, -1);
      const last = prev[prev.length - 1];
      return [...copy, { ...last, points: [...last.points, p] }];
    });
  }

  function onPointerUp() {
    drawingRef.current = false;
  }

  function undoLast() { setStrokes((s) => s.slice(0, -1)); }
  function clearAll() { setStrokes([]); setMaskUrl(null); }

  async function handleGenerate() {
    const fg = strokes.filter((s) => s.mode === "foreground").map((s) => s.points);
    const bg = strokes.filter((s) => s.mode === "background").map((s) => s.points);
    if (!fg.length || !bg.length) {
      setError("Paint at least one foreground stroke AND one background stroke.");
      return;
    }
    setError(null);
    setGenerating(true);
    try {
      const res = await createWatershedMask(stackId, layer.id, {
        image_filename: imageFilename,
        strokes: { foreground: fg, background: bg },
        brush_radius: brushRadius,
      });
      setMaskUrl(res.mask_url);
    } catch (e) {
      setError(e.message || "Watershed failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDiscard() {
    if (maskUrl) {
      try { await deleteLayerMask(stackId, layer.id, imageFilename); } catch {}
    }
    setMaskUrl(null);
    onClose();
  }

  function handleSave() {
    if (maskUrl && onSaved) onSaved(maskUrl, imageFilename);
    onClose();
  }

  if (!opened || !layer || !imageFilename) return null;

  const imgSrc = flakeImageUrl(layer.flake_path, imageFilename);
  const resolvedMaskUrl = maskUrl ? resolveLocalImageUrl(maskUrl) : null;

  return (
    <Modal opened={opened} onClose={onClose} size="90%" title={`Watershed — Flake #${layer.flake_id} @ ${imageFilename}`}>
      <div style={{ display: "flex", gap: "1rem" }}>
        <div style={{ flex: 1, minWidth: 0, position: "relative", background: "#111", borderRadius: 6 }}>
          {!imgLoaded && !imgError && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
              <Loader size="sm" />
            </div>
          )}
          {imgError ? (
            <div style={{ padding: "2rem", textAlign: "center" }}>
              <Text size="sm" color="dimmed">Image not available for {imageFilename}</Text>
            </div>
          ) : (
            <div style={{ position: "relative", width: "100%", lineHeight: 0 }}>
              <img
                ref={imgRef}
                src={imgSrc}
                alt={imageFilename}
                onLoad={handleImgLoad}
                onError={() => { setImgError(true); setImgLoaded(false); }}
                style={{ width: "100%", display: "block", userSelect: "none" }}
                draggable={false}
              />
              {resolvedMaskUrl && (
                <img
                  src={resolvedMaskUrl}
                  alt=""
                  style={{
                    position: "absolute",
                    top: 0, left: 0, width: "100%", height: "100%",
                    opacity: 0.45,
                    mixBlendMode: "screen",
                    pointerEvents: "none",
                    filter: "drop-shadow(0 0 0 #f44336)",
                  }}
                  draggable={false}
                />
              )}
              <canvas
                ref={canvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
                style={{
                  position: "absolute", top: 0, left: 0,
                  width: "100%", height: "100%",
                  touchAction: "none",
                  cursor: "crosshair",
                }}
              />
            </div>
          )}
        </div>

        <div style={{ flex: "0 0 240px" }}>
          <Stack spacing="sm">
            <div>
              <Text size="xs" weight={500} mb={4}>Paint mode</Text>
              <Group spacing={4} grow>
                <Button
                  size="xs" compact
                  variant={mode === "foreground" ? "filled" : "default"}
                  color="green"
                  onClick={() => setMode("foreground")}
                >Flake</Button>
                <Button
                  size="xs" compact
                  variant={mode === "background" ? "filled" : "default"}
                  color="red"
                  onClick={() => setMode("background")}
                >Background</Button>
              </Group>
            </div>
            <div>
              <Group position="apart">
                <Text size="xs" weight={500}>Brush radius</Text>
                <Text size="xs" color="dimmed">{brushRadius}px</Text>
              </Group>
              <Slider min={3} max={80} step={1} value={brushRadius} onChange={setBrushRadius} size="xs" label={null} />
              <Text size="xs" color="dimmed" mt={2}>(native image pixels)</Text>
            </div>
            <Group spacing={4} grow>
              <Button size="xs" compact variant="default" onClick={undoLast} disabled={!strokes.length}>Undo</Button>
              <Button size="xs" compact variant="default" onClick={clearAll} disabled={!strokes.length && !maskUrl}>Clear</Button>
            </Group>
            <Divider />
            <Button
              size="sm"
              onClick={handleGenerate}
              loading={generating}
              disabled={!imgLoaded || !strokes.length}
            >Generate mask</Button>
            {error && (
              <Alert icon={<IconAlertCircle size={14} />} color="red" p="xs">
                <Text size="xs">{error}</Text>
              </Alert>
            )}
            {maskUrl && (
              <>
                <Text size="xs" color="green">Mask saved. Regenerate or confirm.</Text>
                <Group spacing={4} grow>
                  <Button size="xs" compact color="red" variant="outline" onClick={handleDiscard}>Discard</Button>
                  <Button size="xs" compact onClick={handleSave}>Save & close</Button>
                </Group>
              </>
            )}
          </Stack>
        </div>
      </div>
    </Modal>
  );
}

export default WatershedEditor;
