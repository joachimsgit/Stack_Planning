import "./FlakeCard.css";
import { Badge, Text, Group } from "@mantine/core";
import { IconStar, IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import { flakeImageUrl, flakeCropUrl } from "../../utils/api";

const MATERIAL_COLORS = {
  Graphene: "gray",
  hBN: "yellow",
  WSe2: "green",
  MoS2: "blue",
  MoSe2: "cyan",
  WS2: "teal",
};

function formatScanDate(unixTs) {
  if (!unixTs) return null;
  return new Date(unixTs * 1000).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

function FlakeCard({ flake, onSelect, onInfo, showCrop = false, isUsed = false }) {
  const material = flake.chip_material || "Unknown";
  const color = MATERIAL_COLORS[material] || "violet";
  const imgUrl = showCrop
    ? flakeCropUrl(flake.flake_path)
    : flakeImageUrl(flake.flake_path, "eval_img.jpg");
  const scanDate = formatScanDate(flake.scan_time);
  const fpProb = flake.flake_false_positive_probability;
  const highFP = fpProb != null && fpProb > 0.3;

  return (
    <div className="flakeCard" onClick={() => onSelect(flake)}>
      <div className={`flakeCardImageWrap${showCrop ? " flakeCardImageWrapCrop" : ""}`}>
        {imgUrl ? (
          <img
            className="flakeCardImage"
            src={imgUrl}
            alt={`Flake ${flake.flake_id}`}
            loading="lazy"
            onError={(e) => console.error("Image failed to load:", e.target.src)}
          />
        ) : (
          <span className="flakeCardNoImage">No image</span>
        )}
        {flake.flake_favorite && (
          <span className="flakeCardFavBadge" title="Favorite">
            <IconStar size={14} fill="currentColor" />
          </span>
        )}
        {onInfo && (
          <span
            className="flakeCardInfoBtn"
            title="Flake info"
            onClick={(e) => { e.stopPropagation(); onInfo(flake); }}
          >
            <IconInfoCircle size={18} />
          </span>
        )}
      </div>
      <div className="flakeCardInfo">
        <Group position="apart" spacing={4}>
          <Group spacing={4}>
            <Badge color={color} variant="light" size="sm">{material}</Badge>
            {isUsed && <Badge color="gray" variant="outline" size="sm">Used</Badge>}
          </Group>
          <Text size="xs" color="dimmed">#{flake.flake_id}</Text>
        </Group>

        <Group spacing={6} mt={4}>
          <Text size="xs">
            {flake.flake_size ? `${flake.flake_size.toFixed(0)} μm²` : "—"}
          </Text>
          {flake.flake_thickness && (
            <Text size="xs" color="dimmed">· {flake.flake_thickness}</Text>
          )}
          {flake.flake_aspect_ratio && (
            <Text size="xs" color="dimmed">· AR {flake.flake_aspect_ratio}</Text>
          )}
        </Group>

        <Group position="apart" mt={4}>
          <Text size="xs" color="dimmed">
            {flake.scan_name || "—"}
            {scanDate ? ` · ${scanDate}` : ""}
          </Text>
          {highFP && (
            <span className="flakeCardFpWarning" title={`FP probability: ${(fpProb * 100).toFixed(0)}%`}>
              <IconAlertTriangle size={13} />
              {(fpProb * 100).toFixed(0)}%
            </span>
          )}
        </Group>
      </div>
    </div>
  );
}

export default FlakeCard;
