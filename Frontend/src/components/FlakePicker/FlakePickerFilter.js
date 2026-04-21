import { useState, useEffect } from "react";
import {
  Stack,
  Select,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Group,
  Text,
  Divider,
} from "@mantine/core";
import { fetchCombinations, fetchScanUsers } from "../../utils/api";

function FlakePickerFilter({ onChange }) {
  const [combinations, setCombinations] = useState({});
  const [scanUsers, setScanUsers] = useState([]);
  const [material, setMaterial] = useState(null);
  const [thicknesses, setThicknesses] = useState([]);
  const [scanUser, setScanUser] = useState(null);
  const [sizeMin, setSizeMin] = useState("");
  const [sizeMax, setSizeMax] = useState("");
  const [aspectMin, setAspectMin] = useState("");
  const [aspectMax, setAspectMax] = useState("");
  const [fpMax, setFpMax] = useState("");
  const [flakeId, setFlakeId] = useState("");
  const [favorite, setFavorite] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    fetchCombinations()
      .then((data) => setCombinations(data || {}))
      .catch(() => {});
    fetchScanUsers()
      .then((users) => setScanUsers(users || []))
      .catch(() => {});
  }, []);

  // Notify parent of current params whenever any field changes
  useEffect(() => {
    const params = {};
    if (material) params.chip_material = material;
    if (thicknesses.length > 0) params.flake_thickness = thicknesses[0];
    if (scanUser) params.scan_user = scanUser;
    if (sizeMin !== "") params.flake_size_min = sizeMin;
    if (sizeMax !== "") params.flake_size_max = sizeMax;
    if (aspectMin !== "") params.flake_aspect_ratio_min = aspectMin;
    if (aspectMax !== "") params.flake_aspect_ratio_max = aspectMax;
    if (fpMax !== "") params.flake_false_positive_probability_max = fpMax;
    if (flakeId !== "") params.flake_id = flakeId;
    if (favorite === "favorites") params.flake_favorite = true;
    if (dateFrom !== "") params.scan_time_min = Math.floor(new Date(dateFrom).getTime() / 1000);
    if (dateTo !== "") {
      const d = new Date(dateTo);
      d.setUTCHours(23, 59, 59, 999);
      params.scan_time_max = Math.floor(d.getTime() / 1000);
    }
    onChange(params);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material, thicknesses, scanUser, sizeMin, sizeMax, aspectMin, aspectMax, fpMax, flakeId, favorite, dateFrom, dateTo]);

  const materialOptions = Object.keys(combinations).map((m) => ({ value: m, label: m }));

  const thicknessOptions =
    material && combinations[material]
      ? combinations[material].map((t) => ({ value: t, label: t }))
      : [];

  const userOptions = scanUsers.map((u) => ({ value: u, label: u }));

  const dateInputStyle = {
    width: "100%", height: 28, padding: "0 6px",
    border: "1px solid var(--mantine-color-gray-4, #ced4da)",
    borderRadius: 4, fontSize: 12,
    background: "var(--mantine-color-body, white)",
    color: "inherit",
  };

  return (
    <Stack spacing={6} style={{ padding: "0.5rem 0.75rem" }}>
      <Text weight={600} size="xs">Filter Flakes</Text>
      <Divider />

      <Group grow spacing={6}>
        <Select
          label="Material"
          placeholder="Any"
          data={materialOptions}
          value={material}
          onChange={(val) => { setMaterial(val); setThicknesses([]); }}
          clearable
          searchable
          size="xs"
        />
        <MultiSelect
          label="Thickness"
          placeholder="Any"
          data={thicknessOptions}
          value={thicknesses}
          onChange={setThicknesses}
          disabled={!material}
          clearable
          size="xs"
        />
      </Group>

      <Select
        label="User"
        placeholder="Any user"
        data={userOptions}
        value={scanUser}
        onChange={setScanUser}
        clearable
        searchable
        size="xs"
      />

      <Group grow spacing={6}>
        <NumberInput
          label="Size min (μm²)"
          placeholder="0"
          min={0}
          value={sizeMin}
          onChange={setSizeMin}
          hideControls
          size="xs"
        />
        <NumberInput
          label="Size max (μm²)"
          placeholder="∞"
          min={0}
          value={sizeMax}
          onChange={setSizeMax}
          hideControls
          size="xs"
        />
      </Group>

      <Group grow spacing={6}>
        <NumberInput
          label="Aspect min"
          placeholder="1"
          min={1}
          step={0.1}
          precision={1}
          value={aspectMin}
          onChange={setAspectMin}
          hideControls
          size="xs"
        />
        <NumberInput
          label="Aspect max"
          placeholder="∞"
          min={1}
          step={0.1}
          precision={1}
          value={aspectMax}
          onChange={setAspectMax}
          hideControls
          size="xs"
        />
      </Group>

      <Group grow spacing={6}>
        <NumberInput
          label="Flake ID"
          placeholder="Any"
          min={1}
          value={flakeId}
          onChange={setFlakeId}
          hideControls
          size="xs"
        />
        <NumberInput
          label="Max FP prob."
          placeholder="1.0"
          min={0}
          max={1}
          step={0.05}
          precision={2}
          value={fpMax}
          onChange={setFpMax}
          hideControls
          size="xs"
        />
      </Group>

      <div>
        <Text size="xs" weight={500} mb={2}>Favorites</Text>
        <SegmentedControl
          fullWidth
          size="xs"
          value={favorite}
          onChange={setFavorite}
          data={[
            { label: "All", value: "all" },
            { label: "Favorites only", value: "favorites" },
          ]}
        />
      </div>

      <Group grow spacing={6}>
        <div>
          <Text size="xs" weight={500} mb={2}>Date from</Text>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={dateInputStyle} />
        </div>
        <div>
          <Text size="xs" weight={500} mb={2}>Date to</Text>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={dateInputStyle} />
        </div>
      </Group>
    </Stack>
  );
}

export default FlakePickerFilter;
