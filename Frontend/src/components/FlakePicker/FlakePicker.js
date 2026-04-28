import "./FlakePicker.css";
import { useState, useRef, useEffect } from "react";
import { Button, Text, Loader, SegmentedControl, Checkbox } from "@mantine/core";
import { IconSearch, IconLayersIntersect } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import FlakePickerFilter from "./FlakePickerFilter";
import FlakeCard from "./FlakeCard";
import FlakeInfoModal from "../StackComposer/FlakeInfoModal";
import { fetchFlakes, fetchUsedFlakeIds } from "../../utils/api";

const PAGE_SIZE = 10;

function FlakePicker({ onSelectFlake }) {
  // allFlakes holds the full result from the API; we paginate client-side
  const [allFlakes, setAllFlakes] = useState([]);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [imageMode, setImageMode] = useState("full"); // "full" | "crop"
  const [usedFlakeIds, setUsedFlakeIds] = useState(new Set());
  const [hideUsed, setHideUsed] = useState(true);
  const [infoFlake, setInfoFlake] = useState(null);

  const paramsRef = useRef({});

  useEffect(() => {
    fetchUsedFlakeIds()
      .then((ids) => setUsedFlakeIds(new Set(ids)))
      .catch(() => {});
  }, []);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const results = await fetchFlakes(paramsRef.current);
      setAllFlakes(results);
      setVisible(PAGE_SIZE);
      setHasSearched(true);
    } catch (err) {
      notifications.show({ color: "red", message: `Search failed: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFlake = (flake) => {
    setUsedFlakeIds((prev) => new Set([...prev, flake.flake_id]));
    onSelectFlake(flake);
  };

  const handleShowMore = () => setVisible((v) => v + PAGE_SIZE);

  const filtered = hideUsed ? allFlakes.filter((f) => !usedFlakeIds.has(f.flake_id)) : allFlakes;
  const shown = filtered.slice(0, visible);
  const hasMore = visible < filtered.length;

  return (
    <div className="flakePickerRoot">
      {/* Filter fields — scrollable */}
      <div className="flakePickerFilter">
        <FlakePickerFilter onChange={(params) => { paramsRef.current = params; }} />
      </div>

      {/* Search button + image mode toggle — always visible */}
      <div className="flakePickerSearchBar">
        <Button
          leftIcon={<IconSearch size="1rem" />}
          onClick={handleSearch}
          loading={loading}
          fullWidth
        >
          Apply Filter
        </Button>
        <SegmentedControl
          mt="xs"
          fullWidth
          size="xs"
          value={imageMode}
          onChange={setImageMode}
          data={[
            { label: "Full image", value: "full" },
            { label: "Cropped flake", value: "crop" },
          ]}
        />
        <Checkbox
          mt="xs"
          size="xs"
          label="Hide used flakes"
          checked={hideUsed}
          onChange={(e) => setHideUsed(e.currentTarget.checked)}
        />
      </div>

      {/* Results grid */}
      <div className="flakePickerGrid">
        {loading ? (
          <div className="flakePickerEmpty">
            <Loader size="sm" />
          </div>
        ) : !hasSearched ? (
          <div className="flakePickerEmpty">
            <IconLayersIntersect size={32} />
            <Text size="sm" mt="sm" align="center">
              Set filters and click Apply Filter
            </Text>
          </div>
        ) : allFlakes.length === 0 ? (
          <div className="flakePickerEmpty">
            <Text size="sm" color="dimmed">No flakes found</Text>
          </div>
        ) : (
          <>
            <Text size="xs" color="dimmed" px="xs" pt="xs" className="flakePickerGridHeader">
              Showing {shown.length} of {filtered.length}
              {hideUsed && allFlakes.length !== filtered.length
                ? ` (${allFlakes.length - filtered.length} used hidden)`
                : ""}
            </Text>
            {shown.map((flake) => (
              <FlakeCard
                key={flake.flake_id}
                flake={flake}
                onSelect={handleSelectFlake}
                onInfo={(f) => setInfoFlake({ ...f, flake_material: f.chip_material })}
                showCrop={imageMode === "crop"}
                isUsed={usedFlakeIds.has(flake.flake_id)}
              />
            ))}
            {hasMore && (
              <div className="flakePickerLoadMore">
                <Button variant="subtle" size="xs" fullWidth onClick={handleShowMore}>
                  Show more
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      <FlakeInfoModal
        layer={infoFlake}
        opened={infoFlake !== null}
        onClose={() => setInfoFlake(null)}
      />
    </div>
  );
}

export default FlakePicker;
