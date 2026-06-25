import { useEffect, useRef, useState } from "react";
import { Paper, Text, Group, Loader } from "@mantine/core";
import { IconLayersIntersect } from "@tabler/icons-react";
import { computeOverlap, layerHasSilhouette } from "../../utils/overlap";

// Format an area in µm² with precision that scales to magnitude.
function fmtArea(um2) {
  if (um2 == null) return "—";
  const decimals = um2 >= 100 ? 0 : um2 >= 10 ? 1 : 2;
  return `${um2.toFixed(decimals)} µm²`;
}

function flakeLabel(layer) {
  if (layer.flake_id) return `#${layer.flake_id}`;
  return layer.flake_material || "flake";
}

// Floating readout of the contact (overlap) area between two selected flakes.
// Recomputes (debounced) whenever either flake's transform or mask changes.
function OverlapReadout({ layerA, layerB }) {
  const [state, setState] = useState({ status: "computing" });
  const aRef = useRef(layerA);
  const bRef = useRef(layerB);
  aRef.current = layerA;
  bRef.current = layerB;
  const tokenRef = useRef(0);

  // Only the fields that affect the result belong in the recompute signature, so
  // unrelated parent re-renders (zoom, tool changes) don't trigger recomputes.
  const sig = [
    layerA.id,
    layerB.id,
    layerA.pos_x,
    layerA.pos_y,
    layerA.rotation,
    layerB.pos_x,
    layerB.pos_y,
    layerB.rotation,
    layerA.canvas_base_filename,
    layerB.canvas_base_filename,
    JSON.stringify(layerA.masks || {}),
    JSON.stringify(layerB.masks || {}),
  ].join("|");

  useEffect(() => {
    const a = aRef.current;
    const b = bRef.current;
    if (!layerHasSilhouette(a) || !layerHasSilhouette(b)) {
      setState({ status: "unavailable" });
      return;
    }
    const token = ++tokenRef.current;
    setState((prev) => (prev.status === "ready" ? prev : { status: "computing" }));
    // Debounce so a drag/rotate gesture computes once it settles.
    const timer = setTimeout(async () => {
      try {
        const res = await computeOverlap(a, b);
        if (tokenRef.current !== token) return;
        setState(res ? { status: "ready", ...res } : { status: "unavailable" });
      } catch {
        if (tokenRef.current === token) setState({ status: "error" });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [sig]);

  return (
    <Paper
      shadow="sm"
      radius="sm"
      p="xs"
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        zIndex: 30,
        minWidth: 150,
        background: "rgba(255,255,255,0.94)",
        pointerEvents: "none",
      }}
    >
      <Group spacing={6} mb={4} noWrap>
        <IconLayersIntersect size={15} />
        <Text size="xs" weight={600} style={{ whiteSpace: "nowrap" }}>
          Contact area
        </Text>
      </Group>

      <Text size="xs" color="dimmed" mb={6} style={{ whiteSpace: "nowrap" }}>
        {flakeLabel(layerA)} ∩ {flakeLabel(layerB)}
      </Text>

      {state.status === "ready" ? (
        <>
          <Text size="lg" weight={700} style={{ lineHeight: 1.1 }}>
            {fmtArea(state.overlapUm2)}
          </Text>
          <Text size="xs" color="dimmed" mt={2}>
            {(state.fractionOfSmaller * 100).toFixed(0)}% of smaller flake
          </Text>
        </>
      ) : state.status === "computing" ? (
        <Group spacing={6} noWrap>
          <Loader size="xs" />
          <Text size="xs" color="dimmed">
            Computing…
          </Text>
        </Group>
      ) : state.status === "unavailable" ? (
        <Text size="xs" color="dimmed">
          Needs a mask on both flakes.
        </Text>
      ) : (
        <Text size="xs" color="red">
          Couldn’t compute overlap.
        </Text>
      )}
    </Paper>
  );
}

export default OverlapReadout;
