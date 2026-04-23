import { useRef, useCallback, useState, useEffect } from "react";
import { flakeImageUrl, flakeMaskedUrl, flakeOutlineUrl, fetchFlakeCentroid, resolveLocalImageUrl } from "../../utils/api";

function LayerImage({ layer, isActive, isBottom, displayModes, zoom, onSelect, onUpdateTransform, hidden, inGroup, getGroupSnapshot, onUpdateManyLayers }) {
  const dragStart = useRef(null);
  const pivotRef = useRef(null);
  const [centroid, setCentroid] = useState({
    cx_pct: 50, cy_pct: 50,
    bbox_left_pct: 10, bbox_top_pct: 10, bbox_right_pct: 90, bbox_bottom_pct: 90,
  });

  useEffect(() => {
    if (layer.is_local) return;
    const controller = new AbortController();
    fetchFlakeCentroid(layer.flake_path, controller.signal)
      .then(setCentroid)
      .catch(() => {});
    return () => controller.abort();
  }, [layer.flake_path, layer.is_local]);

  const originX = layer.is_local ? 50 : centroid.cx_pct;
  const originY = layer.is_local ? 50 : centroid.cy_pct;
  const displayWidth = 900;

  const transform = [
    `translate(calc(-${originX}% + ${layer.pos_x}px), calc(-${originY}% + ${layer.pos_y}px))`,
    `rotate(${layer.rotation}deg)`,
  ].join(" ");

  const containerStyle = {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: `${displayWidth}px`,
    transformOrigin: `${originX}% ${originY}%`,
    transform,
    opacity: layer.opacity,
    filter: `brightness(${layer.brightness}) contrast(${layer.contrast})`,
    mixBlendMode: isBottom ? "normal" : "multiply",
    zIndex: layer.layer_index + 1,
    userSelect: "none",
    WebkitUserDrag: "none",
    touchAction: "none",
    pointerEvents: isActive || inGroup ? "auto" : "none",
    cursor: isActive || inGroup ? "grab" : "default",
    outline: isActive
      ? "2px dashed rgba(51,154,240,0.7)"
      : inGroup
      ? "2px dashed rgba(116,192,252,0.7)"
      : "none",
    lineHeight: 0,
    display: hidden ? "none" : undefined,
  };

  const onPointerDown = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation(); // prevent bubbling to container's pan/deselect handler
      onSelect();

      const groupSnap = inGroup && getGroupSnapshot ? getGroupSnapshot() : null;

      dragStart.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        startX: layer.pos_x,
        startY: layer.pos_y,
        groupSnap,
      };

      const onMove = (moveEvent) => {
        if (!dragStart.current) return;
        // Screen-space deltas must be divided by zoom to get canvas-space deltas,
        // because the container is CSS-scaled so 1 canvas px = zoom screen px.
        const dx = (moveEvent.clientX - dragStart.current.clientX) / (zoom ?? 1);
        const dy = (moveEvent.clientY - dragStart.current.clientY) / (zoom ?? 1);
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

  const onRotatePointerDown = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!pivotRef.current) return;

      // The zero-size pivot element sits exactly at the transform origin,
      // so its screen-space position is the rotation center regardless of current rotation.
      const pivotRect = pivotRef.current.getBoundingClientRect();
      const pivotX = pivotRect.x;
      const pivotY = pivotRect.y;

      const startAngle = Math.atan2(e.clientY - pivotY, e.clientX - pivotX);
      const startRotation = layer.rotation || 0;
      const groupSnap = inGroup && getGroupSnapshot ? getGroupSnapshot() : null;

      const onMove = (me) => {
        const angle = Math.atan2(me.clientY - pivotY, me.clientX - pivotX);
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
    },
    [layer.rotation, onUpdateTransform, inGroup, getGroupSnapshot, onUpdateManyLayers]
  );

  const rotateHandle = isActive && (
    <>
      {/* Zero-size element at the transform origin — getBoundingClientRect() gives exact screen pivot */}
      <div
        ref={pivotRef}
        style={{ position: "absolute", left: `${originX}%`, top: `${originY}%`, width: 0, height: 0, pointerEvents: "none" }}
      />
      {/* Connector line from pivot to handle */}
      <div
        style={{
          position: "absolute",
          left: `${originX}%`,
          top: `calc(${originY}% - 30px)`,
          width: 1,
          height: 30,
          background: "rgba(51,154,240,0.8)",
          transform: "translateX(-50%)",
          pointerEvents: "none",
        }}
      />
      {/* Rotation handle circle */}
      <div
        style={{
          position: "absolute",
          left: `${originX}%`,
          top: `calc(${originY}% - 30px)`,
          transform: "translate(-50%, -50%)",
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "white",
          border: "2px solid rgba(51,154,240,0.9)",
          cursor: "grab",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          lineHeight: 1,
          color: "rgba(51,154,240,1)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
          zIndex: 10,
        }}
        onPointerDown={onRotatePointerDown}
      >
        ↻
      </div>
    </>
  );

  // ── Local image (imported file) ──────────────────────────────────────────
  if (layer.is_local) {
    return (
      <div style={containerStyle} onPointerDown={onPointerDown}>
        <img
          src={resolveLocalImageUrl(layer.local_image_url)}
          alt="Local"
          draggable={false}
          style={{ width: "100%", display: "block" }}
        />
        {rotateHandle}
      </div>
    );
  }

  const rawUrl     = flakeImageUrl(layer.flake_path, "raw_img.png");
  const maskedUrl  = flakeMaskedUrl(layer.flake_path);
  const outlineUrl = flakeOutlineUrl(layer.flake_path, displayModes.outline_color);
  const bboxColor  = displayModes.bbox_color || "#ffdd00";

  const bbox = {
    left:   centroid.bbox_left_pct   ?? 10,
    top:    centroid.bbox_top_pct    ?? 10,
    right:  centroid.bbox_right_pct  ?? 90,
    bottom: centroid.bbox_bottom_pct ?? 90,
  };

  const overlayImgStyle = {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    display: "block",
  };

  return (
    <div style={containerStyle} draggable={false} onPointerDown={onPointerDown}>
      {/* Layout anchor — always in flow so the div gets a height.
          Visible only when background mode is on; otherwise hidden but still sets size. */}
      <img
        src={rawUrl}
        alt=""
        draggable={false}
        style={{
          width: "100%",
          display: "block",
          visibility: displayModes.background ? "visible" : "hidden",
        }}
      />

      {/* Flake: full-size RGBA with transparent background */}
      {displayModes.flake && (
        <img src={maskedUrl} alt="" draggable={false} style={overlayImgStyle} />
      )}

      {/* Bounding box: SVG rectangle using bbox percentages */}
      {displayModes.bbox && (
        <svg
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            overflow: "visible",
            pointerEvents: "none",
          }}
        >
          <rect
            x={`${bbox.left}%`}
            y={`${bbox.top}%`}
            width={`${bbox.right - bbox.left}%`}
            height={`${bbox.bottom - bbox.top}%`}
            fill="none"
            stroke={bboxColor}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}

      {/* Outline: yellow contour of the flake */}
      {displayModes.outline && (
        <img src={outlineUrl} alt="" draggable={false} style={overlayImgStyle} />
      )}

      {rotateHandle}
    </div>
  );
}

export default LayerImage;
