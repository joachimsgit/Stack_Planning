import "./StackCanvas.css";
import { useState, useEffect, useRef, useCallback } from "react";
import { Text, Slider, Group, ActionIcon, Divider, Tooltip } from "@mantine/core";
import { IconLayersIntersect, IconRectangle, IconPencil, IconRuler2, IconAngle, IconPolygon } from "@tabler/icons-react";
import LayerImage from "./LayerImage";
import ShapeLayer from "./ShapeLayer";
import CanvasControls from "./CanvasControls";

const CANVAS_SIZE = 700;
const ROTATION_STEP = 3;
const ZOOM_STEP = 0.15;
const DEFAULT_DISPLAY_MODES = {
  background: false,
  flake: true,
  bbox: false,
  outline: false,
  bbox_color: "#ffdd00",
  outline_color: "#ffdd00",
};

// ── Scale calibration for 20x images ────────────────────────────────────────
// Camera pixel size at 20x magnification
const UM_PER_PX = 0.3844;
// Native camera pixel width of the stored images
const NATIVE_IMAGE_WIDTH_PX = 1944;
// CSS width at which LayerImage renders each image (see LayerImage.js displayWidth)
const DISPLAY_IMAGE_WIDTH = 900;
// Derived: µm per canvas pixel at zoom = 1
const UM_PER_CANVAS_PX = (UM_PER_PX * NATIVE_IMAGE_WIDTH_PX) / DISPLAY_IMAGE_WIDTH;
// Nice round values used to auto-select scale bar label
const NICE_UM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

function StackCanvas({ layers, activeLayerIndex, onSelectLayer, onUpdateLayer, onAddShape, hiddenLayers }) {
  const sorted = [...layers].sort((a, b) => a.layer_index - b.layer_index);
  const activeLayer = sorted.find((l) => l.layer_index === activeLayerIndex) || null;

  const [layerDisplayModes, setLayerDisplayModes] = useState({});
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [activeTool, setActiveTool] = useState(null); // null | "rect" | "freehand" | "polygon" | "measure" | "protractor"
  const [drawColor, setDrawColor] = useState("#2196f3");
  const [drawingShape, setDrawingShape] = useState(null);
  // Multi-click tool state (shared between measure / protractor / polygon)
  const [toolPoints, setToolPoints] = useState([]); // [{x, y}]
  const [toolHover, setToolHover]   = useState(null); // live cursor position (canvas px)

  const rootRef             = useRef(null);
  const canvasContainerRef  = useRef(null);
  const heldKey             = useRef(null);
  const drawingRef          = useRef(null);
  const drawColorRef        = useRef(drawColor);
  const activeToolRef       = useRef(activeTool);
  const sortedRef           = useRef(sorted);
  const activeLayerRef      = useRef(activeLayer);
  const activeLayerIndexRef = useRef(activeLayerIndex);
  const zoomRef             = useRef(zoom);
  const panOffsetRef        = useRef(panOffset);
  const toolPointsRef       = useRef([]);

  useEffect(() => { sortedRef.current = sorted; });
  useEffect(() => { activeLayerRef.current = activeLayer; });
  useEffect(() => { activeLayerIndexRef.current = activeLayerIndex; });
  useEffect(() => { zoomRef.current = zoom; });
  useEffect(() => { panOffsetRef.current = panOffset; }, [panOffset]);
  useEffect(() => { drawColorRef.current = drawColor; }, [drawColor]);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { toolPointsRef.current = toolPoints; }, [toolPoints]);

  // Clear multi-click state when switching tools
  useEffect(() => {
    toolPointsRef.current = [];
    setToolPoints([]);
    setToolHover(null);
  }, [activeTool]);

  // Key tracking
  useEffect(() => {
    const isInput = () => {
      const t = document.activeElement?.tagName;
      return t === "INPUT" || t === "TEXTAREA" || t === "SELECT";
    };
    const onKeyDown = (e) => { if (!isInput()) heldKey.current = e.key.toLowerCase(); };
    const onKeyUp   = () => { heldKey.current = null; };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup",   onKeyUp);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup",   onKeyUp);
    };
  }, []);

  // Scroll wheel controls
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e) => {
      const key = heldKey.current;
      if (!key) return;
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      if (key === "r") {
        const layer = activeLayerRef.current;
        if (!layer) return;
        onUpdateLayer(layer.id, { rotation: layer.rotation + dir * ROTATION_STEP });
      } else if (key === "t") {
        const s = sortedRef.current;
        if (s.length < 2) return;
        const cur = s.findIndex((l) => l.layer_index === activeLayerIndexRef.current);
        const next = (cur + dir + s.length) % s.length;
        onSelectLayer(s[next].layer_index);
      } else if (key === "z") {
        setZoom((prev) => Math.min(10, Math.max(1, prev - dir * ZOOM_STEP)));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onUpdateLayer, onSelectLayer]);

  // Canvas-relative position helper
  // getBoundingClientRect returns screen-space coords after CSS scale transform,
  // so we divide by zoom to convert back to unscaled canvas coordinates.
  const getCanvasPos = useCallback((clientX, clientY) => {
    const rect = canvasContainerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left) / zoomRef.current, y: (clientY - rect.top) / zoomRef.current };
  }, []);

  // ── Canvas background pan + deselect ────────────────────────────────────
  const handleContainerPointerDown = useCallback(
    (e) => {
      if (activeToolRef.current) return; // tool overlays handle their own events
      e.preventDefault();
      onSelectLayer(null); // deselect active layer

      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const startPan = { ...panOffsetRef.current };

      const onMove = (me) => {
        setPanOffset({
          x: startPan.x + (me.clientX - startClientX),
          y: startPan.y + (me.clientY - startClientY),
        });
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [onSelectLayer]
  );

  // ── Drawing handlers ─────────────────────────────────────────────────────
  const handleDrawStart = useCallback(
    (e) => {
      e.preventDefault();
      const tool = activeToolRef.current;
      if (tool !== "rect" && tool !== "freehand") return;
      const pos = getCanvasPos(e.clientX, e.clientY);

      if (tool === "rect") {
        drawingRef.current = { type: "rect", x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y };
      } else {
        drawingRef.current = { type: "freehand", points: [[pos.x, pos.y]] };
      }
      setDrawingShape({ ...drawingRef.current });

      const onMove = (me) => {
        if (!drawingRef.current) return;
        const p = getCanvasPos(me.clientX, me.clientY);
        if (tool === "rect") {
          drawingRef.current = { ...drawingRef.current, x2: p.x, y2: p.y };
        } else {
          const pts = drawingRef.current.points;
          const last = pts[pts.length - 1];
          if ((p.x - last[0]) ** 2 + (p.y - last[1]) ** 2 < 25) return;
          drawingRef.current = { ...drawingRef.current, points: [...pts, [p.x, p.y]] };
        }
        setDrawingShape({ ...drawingRef.current });
      };

      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        const shape = drawingRef.current;
        drawingRef.current = null;
        setDrawingShape(null);
        if (!shape) return;
        if (shape.type === "rect" && Math.abs(shape.x2 - shape.x1) < 5 && Math.abs(shape.y2 - shape.y1) < 5) return;
        if (shape.type === "freehand" && shape.points.length < 3) return;

        const all = sortedRef.current;
        const nextIndex = all.length > 0 ? Math.max(...all.map((l) => l.layer_index)) + 1 : 1;

        onAddShape({
          id: `shape-${Date.now()}`,
          is_shape: true,
          shape_type: shape.type,
          shape_data: shape.type === "rect"
            ? { x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2 }
            : { points: shape.points },
          shape_color: drawColorRef.current,
          shape_stroke_width: 2,
          layer_index: nextIndex,
          pos_x: 0, pos_y: 0, rotation: 0,
          opacity: 1, brightness: 1, contrast: 1,
          flake_material: null, flake_id: null, flake_path: null,
        });
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [getCanvasPos, onAddShape]
  );

  // ── Persist a multi-click tool result as a shape layer ───────────────────
  const persistMeasurement = useCallback((shapeType, pts) => {
    const all = sortedRef.current;
    const nextIndex = all.length > 0 ? Math.max(...all.map((l) => l.layer_index)) + 1 : 1;
    onAddShape({
      id: `shape-${Date.now()}`,
      is_shape: true,
      shape_type: shapeType,
      shape_data: { points: pts.map((p) => [p.x, p.y]) },
      shape_color: drawColorRef.current,
      shape_stroke_width: 2,
      layer_index: nextIndex,
      pos_x: 0, pos_y: 0, rotation: 0,
      opacity: 1, brightness: 1, contrast: 1,
      flake_material: null, flake_id: null, flake_path: null,
    });
  }, [onAddShape]);

  // ── Multi-click tool handlers (measure / protractor / polygon) ───────────
  // Uses toolPointsRef (not toolPoints state) so rapid clicks see the latest value,
  // and so side-effects like persistMeasurement never run inside a setState updater.
  const handleToolPointerDown = useCallback((e) => {
    e.preventDefault();
    const pos = getCanvasPos(e.clientX, e.clientY);
    const tool = activeToolRef.current;
    const prev = toolPointsRef.current;

    const commit = (next) => {
      toolPointsRef.current = next;
      setToolPoints(next);
    };

    if (tool === "measure") {
      if (prev.length >= 2) { commit([pos]); return; }
      const next = [...prev, pos];
      if (next.length === 2) {
        persistMeasurement("distance", next);
        commit([]);
      } else {
        commit(next);
      }
    } else if (tool === "protractor") {
      if (prev.length >= 3) { commit([pos]); return; }
      const next = [...prev, pos];
      if (next.length === 3) {
        persistMeasurement("angle", next);
        commit([]);
      } else {
        commit(next);
      }
    } else if (tool === "polygon") {
      if (prev.length >= 3) {
        const dxp = pos.x - prev[0].x;
        const dyp = pos.y - prev[0].y;
        if (dxp * dxp + dyp * dyp < 100) {
          persistMeasurement("polygon", prev);
          commit([]);
          return;
        }
      }
      commit([...prev, pos]);
    }
  }, [getCanvasPos, persistMeasurement]);

  const handleToolPointerMove = useCallback((e) => {
    setToolHover(getCanvasPos(e.clientX, e.clientY));
  }, [getCanvasPos]);

  // Polygon: close on double-click or Enter, cancel on Escape
  const closePolygon = useCallback(() => {
    const prev = toolPointsRef.current;
    if (prev.length >= 3) persistMeasurement("polygon", prev);
    toolPointsRef.current = [];
    setToolPoints([]);
  }, [persistMeasurement]);

  const handleToolDoubleClick = useCallback(() => {
    if (activeToolRef.current !== "polygon") return;
    closePolygon();
  }, [closePolygon]);

  useEffect(() => {
    const onKey = (e) => {
      if (activeToolRef.current !== "polygon") return;
      if (e.key === "Escape") {
        toolPointsRef.current = [];
        setToolPoints([]);
      } else if (e.key === "Enter") {
        closePolygon();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closePolygon]);

  // ── Scale bar computation ────────────────────────────────────────────────
  // The scale bar SVG sits outside the scaled container in raw screen pixels.
  // barPx must therefore be in screen pixels: barUm * zoom / UM_PER_CANVAS_PX.
  const barTargetPx = 80; // desired screen-pixel width of scale bar
  const barTargetUm = barTargetPx * UM_PER_CANVAS_PX / zoom;
  const barUm       = NICE_UM.find((v) => v >= barTargetUm) ?? NICE_UM[NICE_UM.length - 1];
  const barPx       = (barUm * zoom) / UM_PER_CANVAS_PX;
  const barLabel    = barUm >= 1000 ? `${barUm / 1000} mm` : `${barUm} µm`;

  // ── Measurement geometry ─────────────────────────────────────────────────
  // getCanvasPos already returns canvas-space coords (divided by zoom),
  // so distance in canvas pixels converts directly to µm without zoom factor.
  const distUm = (ax, ay, bx, by) => {
    const px = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
    return px * UM_PER_CANVAS_PX;
  };
  const angleDeg = (a, b, c) => {
    const v1x = a.x - b.x, v1y = a.y - b.y;
    const v2x = c.x - b.x, v2y = c.y - b.y;
    const dot = v1x * v2x + v1y * v2y;
    const m1 = Math.hypot(v1x, v1y);
    const m2 = Math.hypot(v2x, v2y);
    if (m1 < 1e-6 || m2 < 1e-6) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2)))) * 180 / Math.PI;
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const getDisplayModes = (layerId) => ({ ...DEFAULT_DISPLAY_MODES, ...(layerDisplayModes[layerId] || {}) });
  const toggleDisplayMode = (layerId, mode) => {
    setLayerDisplayModes((prev) => {
      const cur = { ...DEFAULT_DISPLAY_MODES, ...(prev[layerId] || {}) };
      return { ...prev, [layerId]: { ...cur, [mode]: !cur[mode] } };
    });
  };
  const setDisplayColor = (layerId, key, value) => {
    setLayerDisplayModes((prev) => {
      const cur = { ...DEFAULT_DISPLAY_MODES, ...(prev[layerId] || {}) };
      return { ...prev, [layerId]: { ...cur, [key]: value } };
    });
  };

  const handleUpdateTransform = (data) => {
    if (!activeLayer) return;
    onUpdateLayer(activeLayer.id, data);
  };

  const toggleTool = (tool) => setActiveTool((t) => (t === tool ? null : tool));

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="stackCanvasRoot" ref={rootRef}>
      {/* ── Tool bar ── */}
      <div className="stackCanvasZoomBar">
        <Group spacing="sm" style={{ width: "100%" }}>
          <Text size="xs" weight={500} style={{ whiteSpace: "nowrap" }}>Zoom</Text>
          <Slider
            min={1} max={10} step={0.05}
            value={zoom} onChange={setZoom}
            size="xs" label={null} style={{ flex: 1 }}
          />
          <Text size="xs" color="dimmed" style={{ whiteSpace: "nowrap", minWidth: 40, textAlign: "right" }}>
            {(zoom * 100).toFixed(0)}%
          </Text>

          <Divider orientation="vertical" />

          <Tooltip label="Rectangle" withArrow>
            <ActionIcon
              size="sm"
              variant={activeTool === "rect" ? "filled" : "default"}
              onClick={() => toggleTool("rect")}
            >
              <IconRectangle size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Freehand draw" withArrow>
            <ActionIcon
              size="sm"
              variant={activeTool === "freehand" ? "filled" : "default"}
              onClick={() => toggleTool("freehand")}
            >
              <IconPencil size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Polygon (click to add vertex, click first point or Enter to close, Esc to cancel)" withArrow>
            <ActionIcon
              size="sm"
              variant={activeTool === "polygon" ? "filled" : "default"}
              onClick={() => toggleTool("polygon")}
            >
              <IconPolygon size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Shape colour" withArrow>
            <input
              type="color"
              value={drawColor}
              onChange={(e) => setDrawColor(e.target.value)}
              style={{
                width: 24, height: 24, padding: 2,
                border: "1px solid var(--mantine-color-gray-4, #ced4da)",
                borderRadius: 4, cursor: "pointer", background: "none",
              }}
            />
          </Tooltip>

          <Divider orientation="vertical" />

          <Tooltip label="Measure distance (click two points)" withArrow>
            <ActionIcon
              size="sm"
              variant={activeTool === "measure" ? "filled" : "default"}
              onClick={() => toggleTool("measure")}
            >
              <IconRuler2 size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Measure angle (click three points — middle is the vertex)" withArrow>
            <ActionIcon
              size="sm"
              variant={activeTool === "protractor" ? "filled" : "default"}
              onClick={() => toggleTool("protractor")}
            >
              <IconAngle size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </div>

      {/* ── Canvas ── */}
      <div className="stackCanvasArea">
        {/* Wrapper: stable 700×700 layout footprint, not scaled.
            Scale bar is positioned here so it's always visible. */}
        <div style={{ position: "relative", width: CANVAS_SIZE, height: CANVAS_SIZE, flexShrink: 0 }}>

          {/* Scaled + panned container */}
          <div
            className="stackCanvasContainer"
            ref={canvasContainerRef}
            onPointerDown={handleContainerPointerDown}
            style={{
              width: CANVAS_SIZE, height: CANVAS_SIZE,
              transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              cursor: activeLayer ? "default" : "grab",
            }}
          >
            {sorted.length === 0 && (
              <div className="stackCanvasEmpty">
                <IconLayersIntersect size={48} />
                <Text size="sm" mt="sm" align="center">Add layers using the flake picker</Text>
              </div>
            )}

            {sorted.map((layer, idx) => {
              const isHidden = hiddenLayers && hiddenLayers.has(layer.id);
              if (layer.is_shape) {
                return (
                  <ShapeLayer
                    key={layer.id}
                    layer={layer}
                    isActive={layer.layer_index === activeLayerIndex}
                    zoom={zoom}
                    onSelect={() => onSelectLayer(layer.layer_index)}
                    onUpdateTransform={(data) => onUpdateLayer(layer.id, data)}
                    hidden={isHidden}
                  />
                );
              }
              return (
                <LayerImage
                  key={layer.id}
                  layer={layer}
                  isActive={layer.layer_index === activeLayerIndex}
                  isBottom={idx === 0}
                  displayModes={getDisplayModes(layer.id)}
                  zoom={zoom}
                  onSelect={() => onSelectLayer(layer.layer_index)}
                  onUpdateTransform={(data) => onUpdateLayer(layer.id, data)}
                  hidden={isHidden}
                />
              );
            })}

            {/* Drawing preview */}
            {drawingShape && (
              <svg
                style={{
                  position: "absolute", top: 0, left: 0,
                  width: `${CANVAS_SIZE}px`, height: `${CANVAS_SIZE}px`,
                  pointerEvents: "none", zIndex: 998, overflow: "visible",
                }}
              >
                {drawingShape.type === "rect" && (
                  <rect
                    x={Math.min(drawingShape.x1, drawingShape.x2)}
                    y={Math.min(drawingShape.y1, drawingShape.y2)}
                    width={Math.abs(drawingShape.x2 - drawingShape.x1)}
                    height={Math.abs(drawingShape.y2 - drawingShape.y1)}
                    fill={`${drawColor}26`} stroke={drawColor}
                    strokeWidth={2} strokeDasharray="4 2"
                  />
                )}
                {drawingShape.type === "freehand" && drawingShape.points.length > 1 && (
                  <path
                    d={drawingShape.points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ")}
                    fill="none" stroke={drawColor} strokeWidth={2}
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                )}
              </svg>
            )}

            {/* ── Multi-click tool preview overlay (measure / protractor / polygon) ── */}
            {(activeTool === "measure" || activeTool === "protractor" || activeTool === "polygon") && toolPoints.length > 0 && (
              <svg
                style={{
                  position: "absolute", top: 0, left: 0,
                  width: `${CANVAS_SIZE}px`, height: `${CANVAS_SIZE}px`,
                  pointerEvents: "none", zIndex: 10, overflow: "visible",
                }}
              >
                <g>
                  {toolPoints.map((p, i) => (
                    <g key={i}>
                      <circle cx={p.x} cy={p.y} r={5} fill="white" />
                      <circle cx={p.x} cy={p.y} r={4} fill={drawColor} stroke="rgba(0,0,0,0.5)" strokeWidth={1} />
                    </g>
                  ))}

                  {/* MEASURE live preview */}
                  {activeTool === "measure" && toolPoints.length === 1 && toolHover && (() => {
                    const A = toolPoints[0];
                    const d = distUm(A.x, A.y, toolHover.x, toolHover.y);
                    return (
                      <>
                        <line x1={A.x} y1={A.y} x2={toolHover.x} y2={toolHover.y}
                          stroke="white" strokeWidth={3} opacity={0.6} />
                        <line x1={A.x} y1={A.y} x2={toolHover.x} y2={toolHover.y}
                          stroke={drawColor} strokeWidth={1.5} strokeDasharray="5 3" />
                        <text x={toolHover.x + 10} y={toolHover.y - 8}
                          fontSize={12} fontFamily="sans-serif" fontWeight="600"
                          stroke="white" strokeWidth={3} paintOrder="stroke" fill="white">
                          {d.toFixed(2)} µm
                        </text>
                        <text x={toolHover.x + 10} y={toolHover.y - 8}
                          fontSize={12} fontFamily="sans-serif" fontWeight="600" fill={drawColor}>
                          {d.toFixed(2)} µm
                        </text>
                      </>
                    );
                  })()}

                  {/* PROTRACTOR live preview */}
                  {activeTool === "protractor" && toolPoints.length >= 1 && (() => {
                    const segs = [];
                    for (let i = 0; i < toolPoints.length - 1; i++) {
                      segs.push(
                        <g key={`s${i}`}>
                          <line x1={toolPoints[i].x} y1={toolPoints[i].y}
                            x2={toolPoints[i + 1].x} y2={toolPoints[i + 1].y}
                            stroke="white" strokeWidth={3} />
                          <line x1={toolPoints[i].x} y1={toolPoints[i].y}
                            x2={toolPoints[i + 1].x} y2={toolPoints[i + 1].y}
                            stroke={drawColor} strokeWidth={1.5} />
                        </g>
                      );
                    }
                    const last = toolPoints[toolPoints.length - 1];
                    if (toolHover && toolPoints.length < 3) {
                      segs.push(
                        <line key="live" x1={last.x} y1={last.y} x2={toolHover.x} y2={toolHover.y}
                          stroke={drawColor} strokeWidth={1.5} strokeDasharray="5 3" opacity={0.7} />
                      );
                    }
                    if (toolPoints.length === 2 && toolHover) {
                      const ang = angleDeg(toolPoints[0], toolPoints[1], toolHover);
                      return (
                        <>
                          {segs}
                          <text x={toolPoints[1].x + 10} y={toolPoints[1].y - 10}
                            fontSize={13} fontFamily="sans-serif" fontWeight="700"
                            stroke="white" strokeWidth={4} paintOrder="stroke" fill="white">
                            {ang.toFixed(1)}°
                          </text>
                          <text x={toolPoints[1].x + 10} y={toolPoints[1].y - 10}
                            fontSize={13} fontFamily="sans-serif" fontWeight="700" fill={drawColor}>
                            {ang.toFixed(1)}°
                          </text>
                        </>
                      );
                    }
                    return <>{segs}</>;
                  })()}

                  {/* POLYGON live preview */}
                  {activeTool === "polygon" && toolPoints.length >= 1 && (() => {
                    const segs = [];
                    for (let i = 0; i < toolPoints.length - 1; i++) {
                      segs.push(
                        <line key={`p${i}`} x1={toolPoints[i].x} y1={toolPoints[i].y}
                          x2={toolPoints[i + 1].x} y2={toolPoints[i + 1].y}
                          stroke={drawColor} strokeWidth={2} />
                      );
                    }
                    const last = toolPoints[toolPoints.length - 1];
                    if (toolHover) {
                      segs.push(
                        <line key="live" x1={last.x} y1={last.y} x2={toolHover.x} y2={toolHover.y}
                          stroke={drawColor} strokeWidth={2} strokeDasharray="5 3" opacity={0.7} />
                      );
                    }
                    if (toolPoints.length >= 3 && toolHover) {
                      // Visual cue for the close-target
                      segs.push(
                        <circle key="close" cx={toolPoints[0].x} cy={toolPoints[0].y} r={8}
                          fill="none" stroke={drawColor} strokeWidth={1.5} strokeDasharray="2 2" />
                      );
                    }
                    return <>{segs}</>;
                  })()}
                </g>
              </svg>
            )}

            {/* Drawing capture overlay (rect / freehand — drag-based) */}
            {activeTool && activeTool !== "measure" && activeTool !== "protractor" && activeTool !== "polygon" && (
              <div
                style={{ position: "absolute", inset: 0, zIndex: 999, cursor: "crosshair" }}
                onPointerDown={handleDrawStart}
              />
            )}

            {/* Multi-click capture overlay (measure / protractor / polygon) */}
            {(activeTool === "measure" || activeTool === "protractor" || activeTool === "polygon") && (
              <div
                style={{ position: "absolute", inset: 0, zIndex: 999, cursor: "crosshair" }}
                onPointerDown={handleToolPointerDown}
                onPointerMove={handleToolPointerMove}
                onDoubleClick={handleToolDoubleClick}
              />
            )}
          </div>

          {/* ── Scale bar — outside the scaled container, always visible ── */}
          <svg
            style={{
              position: "absolute", bottom: 0, left: 0,
              width: CANVAS_SIZE, height: 60,
              pointerEvents: "none", zIndex: 20,
            }}
          >
            <line x1={12} y1={38} x2={12 + barPx} y2={38} stroke="white" strokeWidth={4} />
            <line x1={12} y1={38} x2={12 + barPx} y2={38} stroke="black" strokeWidth={2} />
            <line x1={12} y1={32} x2={12} y2={44} stroke="white" strokeWidth={4} />
            <line x1={12} y1={32} x2={12} y2={44} stroke="black" strokeWidth={2} />
            <line x1={12 + barPx} y1={32} x2={12 + barPx} y2={44} stroke="white" strokeWidth={4} />
            <line x1={12 + barPx} y1={32} x2={12 + barPx} y2={44} stroke="black" strokeWidth={2} />
            <text x={12 + barPx / 2} y={24}
              textAnchor="middle" fontSize={11} fontFamily="sans-serif" fontWeight="600"
              stroke="white" strokeWidth={3} paintOrder="stroke" fill="white">
              {barLabel}
            </text>
            <text x={12 + barPx / 2} y={24}
              textAnchor="middle" fontSize={11} fontFamily="sans-serif" fontWeight="600"
              fill="black">
              {barLabel}
            </text>
          </svg>

        </div>
      </div>

      {/* ── Per-layer controls ── */}
      <div className="stackCanvasControls">
        <CanvasControls
          layer={activeLayer}
          displayModes={activeLayer ? getDisplayModes(activeLayer.id) : DEFAULT_DISPLAY_MODES}
          onToggleMode={(mode) => activeLayer && toggleDisplayMode(activeLayer.id, mode)}
          onSetDisplayColor={(key, value) => activeLayer && setDisplayColor(activeLayer.id, key, value)}
          onUpdateTransform={handleUpdateTransform}
        />
      </div>
    </div>
  );
}

export default StackCanvas;
