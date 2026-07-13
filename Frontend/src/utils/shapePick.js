// Click-to-select hit testing for shape layers (rectangles, polygons,
// freehand drawings, lines, text, and the distance/angle ruler tools) drawn
// on the canvas. Mirrors utils/flakePick.js's role for flake silhouettes:
// given a canvas-space point, pickShapeAt() resolves which shape (if any)
// the user meant to click, so shapes are selectable directly from the
// canvas the same way flakes already are, not only via the sidebar layer list.
//
// Shape geometry here (translation, rotation pivot, bbox math) is kept in
// sync with the rendering in components/StackCanvas/ShapeLayer.js.

const CANVAS_SIZE = 700;

// Extra padding (canvas px) added around a shape's own stroke width so thin
// strokes/rulers are still easy to click.
const HIT_SLOP = 5;

function rotateIntoLocal(px, py, cx, cy, rotationDeg) {
  if (!rotationDeg) return { x: px, y: py };
  const theta = (-rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq > 1e-9 ? ((px - ax) * abx + (py - ay) * aby) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

function pointInPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const intersect = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function hitPolyline(p, pts, closed, tol) {
  for (let i = 0; i < pts.length - 1; i++) {
    if (distToSegment(p.x, p.y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= tol) return true;
  }
  if (closed && pts.length > 2) {
    const a = pts[pts.length - 1];
    const b = pts[0];
    if (distToSegment(p.x, p.y, a[0], a[1], b[0], b[1]) <= tol) return true;
  }
  return false;
}

function hitRect(point, layer, tol) {
  const { x1, y1, x2, y2 } = layer.shape_data || {};
  if (x1 == null || y1 == null || x2 == null || y2 == null) return false;
  const dx = layer.pos_x || 0;
  const dy = layer.pos_y || 0;
  const sx1 = Math.min(x1, x2) + dx;
  const sy1 = Math.min(y1, y2) + dy;
  const sx2 = Math.max(x1, x2) + dx;
  const sy2 = Math.max(y1, y2) + dy;
  const cx = (sx1 + sx2) / 2;
  const cy = (sy1 + sy2) / 2;
  const p = rotateIntoLocal(point.x, point.y, cx, cy, layer.rotation || 0);
  return p.x >= sx1 - tol && p.x <= sx2 + tol && p.y >= sy1 - tol && p.y <= sy2 + tol;
}

function hitPath(point, layer, tol, closed) {
  const raw = layer.shape_data?.points || [];
  if (raw.length < 2) return false;
  const dx = layer.pos_x || 0;
  const dy = layer.pos_y || 0;
  const pts = raw.map((pt) => [pt[0] + dx, pt[1] + dy]);
  const xs = pts.map((pt) => pt[0]);
  const ys = pts.map((pt) => pt[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const p = rotateIntoLocal(point.x, point.y, cx, cy, layer.rotation || 0);
  if (closed && pointInPolygon(p.x, p.y, pts)) return true;
  return hitPolyline(p, pts, closed, tol);
}

function hitText(point, layer) {
  const { text, fontSize = 16 } = layer.shape_data || {};
  if (!text) return false;
  const dx = layer.pos_x || 0;
  const dy = layer.pos_y || 0;
  const cx0 = CANVAS_SIZE / 2 + dx;
  const cy0 = CANVAS_SIZE / 2 + dy;
  const lines = text.split("\n");
  const approxCharW = fontSize * 0.6;
  const lineH = fontSize * 1.4;
  const approxW = Math.max(...lines.map((l) => l.length)) * approxCharW || 40;
  const approxH = lines.length * lineH;
  const minX = cx0;
  const minY = cy0 - fontSize;
  const maxX = cx0 + approxW;
  const maxY = minY + approxH;
  const rcx = cx0 + approxW / 2;
  const rcy = cy0 - fontSize / 2;
  const p = rotateIntoLocal(point.x, point.y, rcx, rcy, layer.rotation || 0);
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

function hitAngle(point, layer, tol) {
  const pts = layer.shape_data?.points || [];
  if (pts.length !== 3) return false;
  const dx = layer.pos_x || 0;
  const dy = layer.pos_y || 0;
  const [p1, p2, p3] = pts.map((pt) => [pt[0] + dx, pt[1] + dy]);
  // ShapeLayer rotates the angle marker about its vertex (p2), not the bbox center.
  const p = rotateIntoLocal(point.x, point.y, p2[0], p2[1], layer.rotation || 0);
  return (
    distToSegment(p.x, p.y, p1[0], p1[1], p2[0], p2[1]) <= tol ||
    distToSegment(p.x, p.y, p2[0], p2[1], p3[0], p3[1]) <= tol
  );
}

function hitShape(point, layer, zoom) {
  const sw = layer.shape_stroke_width || 2;
  switch (layer.shape_type) {
    case "rect":
      return hitRect(point, layer, HIT_SLOP + sw);
    case "polygon":
      return hitPath(point, layer, HIT_SLOP + sw, true);
    case "freehand":
    case "line":
      return hitPath(point, layer, HIT_SLOP + sw, false);
    // Distance/angle rulers render their stroke width divided by zoom so they
    // stay a constant on-screen size — match that here for the hit tolerance.
    case "distance":
      return hitPath(point, layer, (HIT_SLOP + sw) / (zoom || 1), false);
    case "angle":
      return hitAngle(point, layer, (HIT_SLOP + sw) / (zoom || 1));
    case "text":
      return hitText(point, layer);
    default:
      return false;
  }
}

/**
 * Pick the topmost shape layer covering `point` (canvas-space px), i.e. the
 * highest layer_index among rect / polygon / freehand / line / text /
 * distance / angle shapes whose geometry contains the point. Returns the
 * shape's id, or null if none match.
 */
export function pickShapeAt(layers, point, zoom) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!layer.is_shape) continue;
    if (hitShape(point, layer, zoom)) return layer.id;
  }
  return null;
}
