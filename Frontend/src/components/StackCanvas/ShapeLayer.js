import { useRef, useCallback } from "react";

const CANVAS_SIZE = 700;
const HANDLE_R = 9;
const HANDLE_OFFSET = 30; // px above the selection box top edge

// Kept in sync with StackCanvas.js — see the calibration block there.
const UM_PER_PX = 0.3844;
const NATIVE_IMAGE_WIDTH_PX = 1944;
const DISPLAY_IMAGE_WIDTH = 900;
const UM_PER_CANVAS_PX = (UM_PER_PX * NATIVE_IMAGE_WIDTH_PX) / DISPLAY_IMAGE_WIDTH;

function ShapeLayer({ layer, isActive, zoom, onSelect, onUpdateTransform, hidden, inGroup, getGroupSnapshot, onUpdateManyLayers }) {
  const dragStart = useRef(null);
  const svgRef = useRef(null);

  const onPointerDown = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      onSelect();
      const groupSnap = inGroup && getGroupSnapshot ? getGroupSnapshot() : null;
      dragStart.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        startX: layer.pos_x,
        startY: layer.pos_y,
        groupSnap,
      };
      const onMove = (me) => {
        if (!dragStart.current) return;
        const dx = (me.clientX - dragStart.current.clientX) / (zoom ?? 1);
        const dy = (me.clientY - dragStart.current.clientY) / (zoom ?? 1);
        if (dragStart.current.groupSnap && onUpdateManyLayers) {
          onUpdateManyLayers(
            dragStart.current.groupSnap.map((s) => ({
              id: s.id, pos_x: s.pos_x + dx, pos_y: s.pos_y + dy,
            }))
          );
        } else {
          onUpdateTransform({
            pos_x: dragStart.current.startX + dx,
            pos_y: dragStart.current.startY + dy,
          });
        }
      };
      const onUp = () => {
        dragStart.current = null;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [layer.pos_x, layer.pos_y, onSelect, onUpdateTransform, zoom, inGroup, getGroupSnapshot, onUpdateManyLayers]
  );

  // Returns a pointerdown handler for the rotation handle.
  // cx/cy are the shape's rotation center in SVG/canvas coordinates.
  const makeRotateHandler = (cx, cy) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const rect = svgEl.getBoundingClientRect();
    const scale = rect.width / CANVAS_SIZE;
    const screenCX = rect.left + cx * scale;
    const screenCY = rect.top + cy * scale;

    const startAngle = Math.atan2(e.clientY - screenCY, e.clientX - screenCX);
    const startRotation = layer.rotation || 0;
    const groupSnap = inGroup && getGroupSnapshot ? getGroupSnapshot() : null;

    const onMove = (me) => {
      const angle = Math.atan2(me.clientY - screenCY, me.clientX - screenCX);
      const delta = (angle - startAngle) * 180 / Math.PI;
      if (groupSnap && onUpdateManyLayers) {
        onUpdateManyLayers(
          groupSnap.map((s) => ({ id: s.id, rotation: s.rotation + delta }))
        );
      } else {
        onUpdateTransform({ rotation: startRotation + delta });
      }
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

  // ── Helpers: selection overlay + rotation handle ──
  const selectionOverlay = (minX, minY, maxX, maxY, cx, cy) => {
    const selTop = minY - 4;
    const handleY = selTop - HANDLE_OFFSET;
    return (
      <>
        <rect x={minX - 4} y={minY - 4}
          width={maxX - minX + 8} height={maxY - minY + 8}
          fill="none" stroke="rgba(51,154,240,0.7)" strokeWidth={1}
          strokeDasharray="4 2" pointerEvents="none"
        />
        <line x1={cx} y1={selTop} x2={cx} y2={handleY + HANDLE_R}
          stroke="rgba(51,154,240,0.8)" strokeWidth={1} pointerEvents="none"
        />
        <circle cx={cx} cy={handleY} r={HANDLE_R}
          fill="white" stroke="rgba(51,154,240,0.9)" strokeWidth={2}
          style={{ cursor: "grab" }}
          onPointerDown={makeRotateHandler(cx, cy)}
        />
        <text x={cx} y={handleY} textAnchor="middle" dominantBaseline="central"
          fontSize={11} fill="rgba(51,154,240,1)" pointerEvents="none"
        >↻</text>
      </>
    );
  };

  let group = null;

  if (layer.shape_type === "rect") {
    const { x1, y1, x2, y2 } = layer.shape_data;
    const rx = Math.min(x1, x2) + dx;
    const ry = Math.min(y1, y2) + dy;
    const rw = Math.abs(x2 - x1);
    const rh = Math.abs(y2 - y1);
    const cx = rx + rw / 2;
    const cy = ry + rh / 2;
    group = (
      <g transform={`rotate(${rotation}, ${cx}, ${cy})`}>
        <rect
          x={rx} y={ry} width={rw} height={rh}
          fill={`${color}26`} stroke={color} strokeWidth={sw}
          style={{ cursor: isActive ? "grab" : "pointer" }}
          onPointerDown={onPointerDown}
        />
        {isActive && selectionOverlay(rx, ry, rx + rw, ry + rh, cx, cy)}
      </g>
    );
  } else if (layer.shape_type === "freehand" || layer.shape_type === "polygon") {
    const pts = (layer.shape_data?.points) || [];
    if (pts.length > 1) {
      const closed = layer.shape_type === "polygon";
      const d = pts
        .map((p, i) => `${i === 0 ? "M" : "L"}${p[0] + dx},${p[1] + dy}`)
        .join(" ") + (closed ? " Z" : "");
      const xs = pts.map((p) => p[0] + dx);
      const ys = pts.map((p) => p[1] + dy);
      const minX = Math.min(...xs), minY = Math.min(...ys);
      const maxX = Math.max(...xs), maxY = Math.max(...ys);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      group = (
        <g transform={`rotate(${rotation}, ${cx}, ${cy})`}>
          <path
            d={d}
            fill={closed ? `${color}26` : "none"}
            stroke={color} strokeWidth={sw}
            strokeLinecap="round" strokeLinejoin="round"
            style={{ cursor: isActive ? "grab" : "pointer" }}
            onPointerDown={onPointerDown}
          />
          {isActive && selectionOverlay(minX, minY, maxX, maxY, cx, cy)}
        </g>
      );
    }
  } else if (layer.shape_type === "distance") {
    const pts = (layer.shape_data?.points) || [];
    if (pts.length === 2) {
      const [p1, p2] = pts;
      const ax = p1[0] + dx, ay = p1[1] + dy;
      const bx = p2[0] + dx, by = p2[1] + dy;
      const distPx = Math.hypot(bx - ax, by - ay);
      const distUm = distPx * UM_PER_CANVAS_PX;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      // Offset the label perpendicular to the line
      const angle = Math.atan2(by - ay, bx - ax);
      const perp = angle - Math.PI / 2;
      const lx = mx + Math.cos(perp) * 14;
      const ly = my + Math.sin(perp) * 14;
      const minX = Math.min(ax, bx), minY = Math.min(ay, by);
      const maxX = Math.max(ax, bx), maxY = Math.max(ay, by);
      group = (
        <g transform={`rotate(${rotation}, ${mx}, ${my})`}>
          <line x1={ax} y1={ay} x2={bx} y2={by}
            stroke="white" strokeWidth={sw + 2}
            style={{ cursor: isActive ? "grab" : "pointer" }}
            onPointerDown={onPointerDown}
          />
          <line x1={ax} y1={ay} x2={bx} y2={by}
            stroke={color} strokeWidth={sw} pointerEvents="none"
          />
          {[p1, p2].map((p, i) => (
            <g key={i}>
              <circle cx={p[0] + dx} cy={p[1] + dy} r={4} fill="white" pointerEvents="none" />
              <circle cx={p[0] + dx} cy={p[1] + dy} r={3} fill={color} pointerEvents="none" />
            </g>
          ))}
          <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
            fontSize={13} fontFamily="sans-serif" fontWeight="700"
            stroke="white" strokeWidth={4} paintOrder="stroke" fill="white"
            pointerEvents="none"
          >
            {distUm.toFixed(2)} µm
          </text>
          <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
            fontSize={13} fontFamily="sans-serif" fontWeight="700" fill={color}
            pointerEvents="none"
          >
            {distUm.toFixed(2)} µm
          </text>
          {isActive && selectionOverlay(minX, minY, maxX, maxY, mx, my)}
        </g>
      );
    }
  } else if (layer.shape_type === "angle") {
    const pts = (layer.shape_data?.points) || [];
    if (pts.length === 3) {
      const [p1, p2, p3] = pts;
      const ax = p1[0] + dx, ay = p1[1] + dy;
      const bx = p2[0] + dx, by = p2[1] + dy; // vertex
      const cx2 = p3[0] + dx, cy2 = p3[1] + dy;

      const v1x = ax - bx, v1y = ay - by;
      const v2x = cx2 - bx, v2y = cy2 - by;
      const m1 = Math.hypot(v1x, v1y);
      const m2 = Math.hypot(v2x, v2y);
      const dot = v1x * v2x + v1y * v2y;
      const angleRad = (m1 > 1e-6 && m2 > 1e-6)
        ? Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2))))
        : 0;
      const angleDeg = angleRad * 180 / Math.PI;

      const arcR = Math.min(28, Math.min(m1, m2) * 0.6);
      const a1 = Math.atan2(v1y, v1x);
      const a2 = Math.atan2(v2y, v2x);
      // Draw the arc along the short angular direction so it visually spans the angle
      let da = a2 - a1;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const sweep = da > 0 ? 1 : 0;
      const arcStart = [bx + Math.cos(a1) * arcR, by + Math.sin(a1) * arcR];
      const arcEnd   = [bx + Math.cos(a2) * arcR, by + Math.sin(a2) * arcR];
      const arcPath = `M ${arcStart[0]} ${arcStart[1]} A ${arcR} ${arcR} 0 0 ${sweep} ${arcEnd[0]} ${arcEnd[1]}`;

      const midA = a1 + da / 2;
      const lx = bx + Math.cos(midA) * (arcR + 14);
      const ly = by + Math.sin(midA) * (arcR + 14);

      const xs = [ax, bx, cx2], ys = [ay, by, cy2];
      const minX = Math.min(...xs), minY = Math.min(...ys);
      const maxX = Math.max(...xs), maxY = Math.max(...ys);

      group = (
        <g transform={`rotate(${rotation}, ${bx}, ${by})`}>
          {/* Invisible hit target along each arm for easy grabbing */}
          <line x1={ax} y1={ay} x2={bx} y2={by}
            stroke="transparent" strokeWidth={10}
            style={{ cursor: isActive ? "grab" : "pointer" }}
            onPointerDown={onPointerDown}
          />
          <line x1={bx} y1={by} x2={cx2} y2={cy2}
            stroke="transparent" strokeWidth={10}
            style={{ cursor: isActive ? "grab" : "pointer" }}
            onPointerDown={onPointerDown}
          />
          <line x1={ax} y1={ay} x2={bx} y2={by}
            stroke="white" strokeWidth={sw + 2} pointerEvents="none" />
          <line x1={ax} y1={ay} x2={bx} y2={by}
            stroke={color} strokeWidth={sw} pointerEvents="none" />
          <line x1={bx} y1={by} x2={cx2} y2={cy2}
            stroke="white" strokeWidth={sw + 2} pointerEvents="none" />
          <line x1={bx} y1={by} x2={cx2} y2={cy2}
            stroke={color} strokeWidth={sw} pointerEvents="none" />
          <path d={arcPath} fill="none" stroke={color} strokeWidth={sw} pointerEvents="none" />
          {[p1, p2, p3].map((p, i) => (
            <g key={i}>
              <circle cx={p[0] + dx} cy={p[1] + dy} r={4} fill="white" pointerEvents="none" />
              <circle cx={p[0] + dx} cy={p[1] + dy} r={3} fill={color} pointerEvents="none" />
            </g>
          ))}
          <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
            fontSize={13} fontFamily="sans-serif" fontWeight="700"
            stroke="white" strokeWidth={4} paintOrder="stroke" fill="white"
            pointerEvents="none"
          >
            {angleDeg.toFixed(1)}°
          </text>
          <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
            fontSize={13} fontFamily="sans-serif" fontWeight="700" fill={color}
            pointerEvents="none"
          >
            {angleDeg.toFixed(1)}°
          </text>
          {isActive && selectionOverlay(minX, minY, maxX, maxY, bx, by)}
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
        pointerEvents: isActive || inGroup ? "auto" : "none",
        display: hidden ? "none" : undefined,
      }}
    >
      {group}
    </svg>
  );
}

export default ShapeLayer;
