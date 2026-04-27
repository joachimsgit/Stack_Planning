import { useState, useEffect } from "react";
import { Modal, Text, Badge, Loader, Group, Button, SimpleGrid, Textarea } from "@mantine/core";
import { IconBrush, IconX } from "@tabler/icons-react";
import { fetchFlakes, flakeImageUrl, fetchFlakeNotes, saveFlakeNotes, fetchAvailableImages } from "../../utils/api";
import WatershedEditor from "./WatershedEditor";

const MATERIAL_COLORS = {
  Graphene: "gray", hBN: "yellow", WSe2: "green",
  MoS2: "blue", MoSe2: "cyan", WS2: "teal",
};

const MAGNIFICATIONS = [
  { label: "Overview", file: "overview_marked.jpg" },
  { label: "Eval",     file: "eval_img.jpg" },
  { label: "2.5×",    file: "2.5x.png" },
  { label: "5×",      file: "5x.png" },
  { label: "20×",     file: "20x.png" },
  { label: "50×",     file: "50x.png" },
  { label: "100×",    file: "100x.png" },
];

function InfoRow({ label, value }) {
  if (value == null || value === "") return null;
  return (
    <>
      <Text size="xs" color="dimmed" style={{ fontWeight: 600 }}>{label}</Text>
      <Text size="xs">{value}</Text>
    </>
  );
}

function FlakeInfoModal({ layer, opened, onClose, stackId, onMasksChanged }) {
  const [flake, setFlake] = useState(null);
  const [loading, setLoading] = useState(false);
  const [magIndex, setMagIndex] = useState(0);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [notes, setNotes] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [watershedOpen, setWatershedOpen] = useState(false);
  // imageExists: null = not yet fetched, {} = results { "20x.png": true/false, ... }
  const [imageExists, setImageExists] = useState(null);
  // const [autoRunning, setAutoRunning] = useState(false); // reserved for auto-watershed

  useEffect(() => {
    if (!opened || !layer) return;
    setFlake(null);
    setLoading(true);
    setNotes("");
    setNotesSaved(false);
    setImageExists(null);
    fetchFlakes({ flake_id: layer.flake_id })
      .then((results) => setFlake(results?.[0] ?? null))
      .catch(() => setFlake(null))
      .finally(() => setLoading(false));
    fetchFlakeNotes(layer.flake_id)
      .then((data) => { setNotes(data.notes || ""); })
      .catch(() => {});
    if (layer.flake_path) {
      fetchAvailableImages(layer.flake_path)
        .then((data) => setImageExists(data))
        .catch(() => setImageExists({}));
    }
  }, [opened, layer]);

  // Reset image state when switching magnification or flake
  useEffect(() => {
    setImgLoaded(false);
    setImgError(false);
  }, [magIndex, layer]);

  function handleSaveNotes() {
    setNotesSaving(true);
    saveFlakeNotes(layer.flake_id, { notes })
      .then(() => { setNotesSaved(true); setTimeout(() => setNotesSaved(false), 2000); })
      .catch(() => {})
      .finally(() => setNotesSaving(false));
  }

  // Auto-watershed disabled — marker heuristic needs refinement.
  // function handleAutoWatershed() {
  //   if (!stackId || !layer) return;
  //   setAutoRunning(true);
  //   autoWatershedMasks(stackId, layer.id)
  //     .then(() => { if (onMasksChanged) onMasksChanged(layer.id); })
  //     .catch(() => {})
  //     .finally(() => setAutoRunning(false));
  // }

  if (!layer) return null;

  const f = flake;
  const material = f?.chip_material || layer.flake_material || "Unknown";
  const color = MATERIAL_COLORS[material] || "violet";
  const scanDate = f?.scan_time
    ? new Date(f.scan_time * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;

  const currentMag = MAGNIFICATIONS[magIndex];
  const imgUrl = flakeImageUrl(layer.flake_path, currentMag.file);
  // imageExists[file] is true/false once fetched; null/undefined means still loading (treat as available)
  const currentImageAvailable = imageExists === null || imageExists[currentMag.file] !== false;
  const isOverview = currentMag.file === "overview_marked.jpg";
  const canPaintMask = Boolean(stackId) && !isOverview && currentImageAvailable;
  const hasMaskForMag = Boolean(layer.masks && layer.masks[currentMag.file]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group spacing="xs">
          <Badge color={color} variant="light">{material}</Badge>
          <Text weight={600}>Flake #{layer.flake_id}</Text>
        </Group>
      }
      size="1100px"
      padding="md"
    >
      <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>

        {/* ── Image panel ── */}
        <div style={{ flex: "0 0 640px" }}>
          <Group spacing={4} mb="xs" position="apart" noWrap>
            <Group spacing={4} noWrap>
              {MAGNIFICATIONS.map((m, i) => {
                const hasMask = Boolean(layer.masks && layer.masks[m.file]);
                const imgAvail = imageExists === null || imageExists[m.file] !== false;
                return (
                  <Button
                    key={m.file}
                    size="xs"
                    compact
                    variant={i === magIndex ? "filled" : "default"}
                    onClick={() => setMagIndex(i)}
                    style={!imgAvail ? { opacity: 0.45, textDecoration: "line-through" } : undefined}
                    title={!imgAvail ? "Image not available" : hasMask ? "User mask available" : undefined}
                  >
                    {m.label}{hasMask ? " •" : ""}
                  </Button>
                );
              })}
            </Group>
            <Group spacing={4} noWrap>
              {Boolean(stackId) && !isOverview && (
                currentImageAvailable ? (
                  <Button
                    size="xs"
                    compact
                    leftIcon={<IconBrush size={12} />}
                    variant={hasMaskForMag ? "filled" : "light"}
                    color="grape"
                    onClick={() => setWatershedOpen(true)}
                    title="Paint foreground/background scribbles to build a watershed mask"
                  >
                    {hasMaskForMag ? "Edit mask" : "Generate mask"}
                  </Button>
                ) : (
                  <Button
                    size="xs"
                    compact
                    leftIcon={<IconX size={12} />}
                    variant="light"
                    color="gray"
                    disabled
                    title="Image not available — cannot generate mask"
                  >
                    No image
                  </Button>
                )
              )}
              {/* Auto masks button disabled — marker heuristic needs refinement.
              {Boolean(stackId) && (
                <Button
                  size="xs"
                  compact
                  leftIcon={<IconSparkles size={12} />}
                  variant="light"
                  color="violet"
                  loading={autoRunning}
                  onClick={handleAutoWatershed}
                  title="Auto-generate watershed masks for all available high-magnification images"
                >
                  Auto masks
                </Button>
              )}
              */}
            </Group>
          </Group>

          <div style={{ position: "relative", background: "#111", borderRadius: 6, overflow: "hidden", minHeight: 200 }}>
            {!imgLoaded && !imgError && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Loader size="sm" />
              </div>
            )}
            {imgError ? (
              <div style={{ padding: "2rem", textAlign: "center" }}>
                <Text size="xs" color="dimmed">Image not available</Text>
              </div>
            ) : (
              <img
                key={imgUrl}
                src={imgUrl}
                alt={currentMag.label}
                style={{ width: "100%", display: imgLoaded ? "block" : "none" }}
                onLoad={() => setImgLoaded(true)}
                onError={() => { setImgError(true); setImgLoaded(false); }}
              />
            )}
          </div>
        </div>

        {/* ── Metadata panel ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {loading ? (
            <Loader size="sm" />
          ) : (
            <SimpleGrid cols={2} spacing={4} verticalSpacing={2}>
              <InfoRow label="Flake ID"       value={layer.flake_id} />
              <InfoRow label="Material"       value={material} />
              <InfoRow label="Thickness"      value={f?.flake_thickness ?? layer.flake_thickness} />
              <InfoRow label="Size"           value={f?.flake_size != null ? `${f.flake_size.toFixed(1)} μm²` : layer.flake_size != null ? `${layer.flake_size.toFixed(1)} μm²` : null} />
              <InfoRow label="Aspect ratio"   value={f?.flake_aspect_ratio != null ? f.flake_aspect_ratio.toFixed(2) : null} />
              <InfoRow label="Max sidelength" value={f?.flake_max_sidelength != null ? `${f.flake_max_sidelength.toFixed(1)} μm` : null} />
              <InfoRow label="Min sidelength" value={f?.flake_min_sidelength != null ? `${f.flake_min_sidelength.toFixed(1)} μm` : null} />
              <InfoRow label="Entropy"        value={f?.flake_entropy != null ? f.flake_entropy.toFixed(3) : null} />
              <InfoRow label="FP probability" value={f?.flake_false_positive_probability != null ? `${(f.flake_false_positive_probability * 100).toFixed(1)}%` : null} />
              <InfoRow label="Favorite"       value={f?.flake_favorite != null ? (f.flake_favorite ? "Yes" : "No") : null} />
              <InfoRow label="Used"           value={f?.flake_used != null ? (f.flake_used ? "Yes" : "No") : null} />
              <InfoRow label="Chip ID"        value={f?.chip_id} />
              <InfoRow label="Scan name"      value={f?.scan_name} />
              <InfoRow label="Scan user"      value={f?.scan_user} />
              <InfoRow label="Scan date"      value={scanDate} />
              <InfoRow label="Scan ID"        value={f?.scan_id} />
            </SimpleGrid>
          )}
        </div>

      </div>

      {/* ── Notes section ── */}
      <div style={{ marginTop: "1rem" }}>
        <Text size="xs" weight={600} color="dimmed" mb={4}>Notes</Text>
        <Textarea
          value={notes}
          onChange={(e) => { setNotes(e.currentTarget.value); setNotesSaved(false); }}
          placeholder="Add notes about this flake…"
          minRows={3}
          autosize
        />
        <Group position="right" mt={6}>
          {notesSaved && <Text size="xs" color="green">Saved</Text>}
          <Button size="xs" loading={notesSaving} onClick={handleSaveNotes}>
            Save notes
          </Button>
        </Group>
      </div>

      <WatershedEditor
        opened={watershedOpen}
        onClose={() => {
          setWatershedOpen(false);
          if (onMasksChanged && layer) onMasksChanged(layer.id);
        }}
        stackId={stackId}
        layer={layer}
        imageFilename={currentMag.file}
        onSaved={() => {
          if (onMasksChanged && layer) onMasksChanged(layer.id);
        }}
      />
    </Modal>
  );
}

export default FlakeInfoModal;
