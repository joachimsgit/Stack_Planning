import { useState, useEffect } from "react";
import { Modal, Text, Badge, Grid, Loader, Group, Button, SimpleGrid, Textarea } from "@mantine/core";
import { IconStar, IconAlertTriangle } from "@tabler/icons-react";
import { fetchFlakes, flakeImageUrl, fetchFlakeNotes, saveFlakeNotes } from "../../utils/api";

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

function FlakeInfoModal({ layer, opened, onClose }) {
  const [flake, setFlake] = useState(null);
  const [loading, setLoading] = useState(false);
  const [magIndex, setMagIndex] = useState(0);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [notes, setNotes] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  useEffect(() => {
    if (!opened || !layer) return;
    setFlake(null);
    setLoading(true);
    setNotes("");
    setNotesSaved(false);
    fetchFlakes({ flake_id: layer.flake_id })
      .then((results) => setFlake(results?.[0] ?? null))
      .catch(() => setFlake(null))
      .finally(() => setLoading(false));
    fetchFlakeNotes(layer.flake_id)
      .then((data) => setNotes(data.notes || ""))
      .catch(() => {});
  }, [opened, layer]);

  // Reset image state when switching magnification or flake
  useEffect(() => {
    setImgLoaded(false);
    setImgError(false);
  }, [magIndex, layer]);

  function handleSaveNotes() {
    setNotesSaving(true);
    saveFlakeNotes(layer.flake_id, notes)
      .then(() => { setNotesSaved(true); setTimeout(() => setNotesSaved(false), 2000); })
      .catch(() => {})
      .finally(() => setNotesSaving(false));
  }

  if (!layer) return null;

  const f = flake;
  const material = f?.chip_material || layer.flake_material || "Unknown";
  const color = MATERIAL_COLORS[material] || "violet";
  const scanDate = f?.scan_time
    ? new Date(f.scan_time * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;

  const currentMag = MAGNIFICATIONS[magIndex];
  const imgUrl = flakeImageUrl(layer.flake_path, currentMag.file);

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
          <Group spacing={4} mb="xs">
            {MAGNIFICATIONS.map((m, i) => (
              <Button
                key={m.file}
                size="xs"
                compact
                variant={i === magIndex ? "filled" : "default"}
                onClick={() => setMagIndex(i)}
              >
                {m.label}
              </Button>
            ))}
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

    </Modal>
  );
}

export default FlakeInfoModal;
