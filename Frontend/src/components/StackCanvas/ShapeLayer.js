import { useRef, useCallback } from "react";

const CANVAS_SIZE = 700;
const HANDLE_R = 9;
const HANDLE_OFFSET = 30; // px above the selection box top edge

function ShapeLayer({ layer, isActive, zoom, onSelect, onUpdateTransform, hidden }) {
  const dragStart = useRef(null);
  const svgRef = useRef(null);

  const onPointerDown = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      onSelect();
      dragStart.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        startX: layer.pos_x,
        startY: layer.pos_y,
      };
      const onMove = (me) => {
        if (!dragStart.current) return;
        onUpdateTransform({
          pos_x: dragStart.current.startX + (me.clientX - dragStart.current.clientX) / (zoom ?? 1),
          pos_y: dragStart.current.startY + (me.clientY - dragStart.current.clientY) / (zoom ?? 1),
        });
      };
      const onUp = () => {
        dragStart.current = null;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [layer.pos_x, layer.pos_y, onSelect, onUpdateTransform]
  );

  // Returns a pointerdown handler for the rotation handle.
  // cx/cy are the shape's rotation center in SVG/canvas coordinates.
  const makeRotateHandler = (cx, cy) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const svgEl = svgRef.current;
    if (!svgEl) return;

    // getBoundingClientRect accounts for CSS zoom/scale on the canvas container,
    // so we can map SVG coords → screen coords via the rendered size ratio.
    const rect = svgEl.getBoundingClientRect();
    const scale = rect.width / CANVAS_SIZE;
    const screenCX = rect.left + cx * scale;
    const screenCY = rect.top + cy * scale;

    const startAngle = Math.atan2(e.clientY - screenCY, e.clientX - screenCX);
    const startRotation = layer.rotation || 0;

    const onMove = (me) => {
      const angle = Math.atan2(me.clientY - screenCY, me.clientX - screenCX);
      const delta = (angle - startAngle) * 180 / Math.PI;
      onUpdateTransform({ rotation: startRotation + delta });
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const color = layer.shape_color || "#2196f3";
  const sw = layer.shape_stroke_width || 2;
  const dx = layer.pos_x || 0;
  const dy = layer.pos_y || 0;

  const rotation = layer.rotation || 0;
  let group = null;

  if (layer.shape_type === "rect") {
    const { x1, y1, x2, y2 } = layer.shape_data;
    const rx = Math.min(x1, x2) + dx;
    const ry = Math.min(y1, y2) + dy;
    const rw = Math.abs(x2 - x1);
    const rh = Math.abs(y2 - y1);
    // Rotate around the rectangle's own center
    const cx = rx + rw / 2;
    const cy = ry + rh / 2;
    const selTop = ry - 4;
    const handleY = selTop - HANDLE_OFFSET;
    group = (
      <g transform={`rotate(${rotation}, ${cx}, ${cy})`}>
        <rect
          x={rx} y={ry} width={rw} height={rh}
          fill={`${color}26`} stroke={color} strokeWidth={sw}
          style={{ cursor: isActive ? "grab" : "pointer" }}
          onPointerDown={onPointerDown}
        />
        {isActive && (
          <>
            <rect x={rx - 4} y={ry - 4} width={rw + 8} height={rh + 8}
              fill="none" stroke="rgba(51,154,240,0.7)" strokeWidth={1}
              strokeDasharray="4 2" pointerEvents="none"
            />
            {/* Connector line */}
            <line
              x1={cx} y1={selTop} x2={cx} y2={handleY + HANDLE_R}
              stroke="rgba(51,154,240,0.8)" strokeWidth={1} pointerEvents="none"
            />
            {/* Rotation handle */}
            <circle
              cx={cx} cy={handleY} r={HANDLE_R}
              fill="white" stroke="rgba(51,154,240,0.9)" strokeWidth={2}
              style={{ cursor: "grab" }}
              onPointerDown={makeRotateHandler(cx, cy)}
            />
            <text
              x={cx} y={handleY} textAnchor="middle" dominantBaseline="central"
              fontSize={11} fill="rgba(51,154,240,1)" pointerEvents="none"
            >↻</text>
          </>
        )}
      </g>
    );
  } else if (layer.shape_type === "freehand") {
    const pts = layer.shape_data.points;
    if (pts && pts.length > 1) {
      const d = pts
        .map((p, i) => `${i === 0 ? "M" : "L"}${p[0] + dx},${p[1] + dy}`)
        .join(" ");
      const xs = pts.map((p) => p[0] + dx);
      const ys = pts.map((p) => p[1] + dy);
      const minX = Math.min(...xs), minY = Math.min(...ys);
      const maxX = Math.max(...xs), maxY = Math.max(...ys);
      // Rotate around the bounding-box center of the path
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const selTop = minY - 4;
      const handleY = selTop - HANDLE_OFFSET;
      group = (
        <g transform={`rotate(${rotation}, ${cx}, ${cy})`}>
          <path
            d={d} fill="none" stroke={color} strokeWidth={sw}
            strokeLinecap="round" strokeLinejoin="round"
            style={{ cursor: isActive ? "grab" : "pointer" }}
            onPointerDown={onPointerDown}
          />
          {isActive && (
            <>
              <rect x={minX - 4} y={minY - 4} width={maxX - minX + 8} height={maxY - minY + 8}
                fill="none" stroke="rgba(51,154,240,0.7)" strokeWidth={1}
                strokeDasharray="4 2" pointerEvents="none"
              />
              {/* Connector line */}
              <line
                x1={cx} y1={selTop} x2={cx} y2={handleY + HANDLE_R}
                stroke="rgba(51,154,240,0.8)" strokeWidth={1} pointerEvents="none"
              />
              {/* Rotation handle */}
              <circle
                cx={cx} cy={handleY} r={HANDLE_R}
                fill="white" stroke="rgba(51,154,240,0.9)" strokeWidth={2}
                style={{ cursor: "grab" }}
                onPointerDown={makeRotateHandler(cx, cy)}
              />
              <text
                x={cx} y={handleY} textAnchor="middle" dominantBaseline="central"
                fontSize={11} fill="rgba(51,154,240,1)" pointerEvents="none"
              >↻</text>
            </>
          )}
        </g>
      );
    }
  }

  if (!group) return null;

  return (
    <svg
      ref={svgRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: `${CANVAS_SIZE}px`,
        height: `${CANVAS_SIZE}px`,
        overflow: "visible",
        zIndex: layer.layer_index + 1,
        opacity: layer.opacity,
        pointerEvents: isActive ? "auto" : "none",
        display: hidden ? "none" : undefined,
      }}
    >
      {group}
    </svg>
  );
}

export default ShapeLayer;
