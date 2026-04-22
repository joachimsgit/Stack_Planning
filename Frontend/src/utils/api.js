const BASE = (process.env.REACT_APP_STACK_BACKEND_URL || "http://localhost:5000/").replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Image URL helper — routed through the local Flask backend to avoid ORB blocking.
// ---------------------------------------------------------------------------

export function flakeImageUrl(flakePath, filename = "eval_img.jpg") {
  if (!flakePath) return null;
  return `${BASE}/proxy/image?flake_path=${encodeURIComponent(flakePath)}&filename=${encodeURIComponent(filename)}`;
}

export function flakeCropUrl(flakePath) {
  if (!flakePath) return null;
  return `${BASE}/proxy/crop?flake_path=${encodeURIComponent(flakePath)}`;
}

export function flakeMaskedUrl(flakePath) {
  if (!flakePath) return null;
  return `${BASE}/proxy/masked?flake_path=${encodeURIComponent(flakePath)}`;
}

export function flakeOutlineUrl(flakePath, color) {
  if (!flakePath) return null;
  const qs = new URLSearchParams({ flake_path: flakePath });
  if (color) qs.set("color", color.replace(/^#/, ""));
  return `${BASE}/proxy/outline?${qs.toString()}`;
}

export async function fetchFlakeCentroid(flakePath, signal) {
  if (!flakePath) return { cx_pct: 50, cy_pct: 50 };
  try {
    const r = await fetch(`${BASE}/proxy/centroid?flake_path=${encodeURIComponent(flakePath)}`, { signal });
    return await r.json();
  } catch {
    return { cx_pct: 50, cy_pct: 50 };
  }
}

// ---------------------------------------------------------------------------
// Stack CRUD
// ---------------------------------------------------------------------------

export function fetchStacks() {
  return apiFetch("/stacks");
}

export function createStack(name, notes = "", userId = null) {
  return apiFetch("/stacks", {
    method: "POST",
    body: JSON.stringify({ name, notes, ...(userId != null ? { user_id: userId } : {}) }),
  });
}

export function fetchUsers() {
  return apiFetch("/users");
}

export function createUser(name) {
  return apiFetch("/users", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function fetchStack(id) {
  return apiFetch(`/stacks/${id}`);
}

export function updateStack(id, data) {
  return apiFetch(`/stacks/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteStack(id) {
  return apiFetch(`/stacks/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Layer CRUD
// ---------------------------------------------------------------------------

export function addLayer(stackId, layerData) {
  return apiFetch(`/stacks/${stackId}/layers`, {
    method: "POST",
    body: JSON.stringify(layerData),
  });
}

export function updateLayer(stackId, layerId, data) {
  return apiFetch(`/stacks/${stackId}/layers/${layerId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteLayer(stackId, layerId) {
  return apiFetch(`/stacks/${stackId}/layers/${layerId}`, { method: "DELETE" });
}

export function reorderLayers(stackId, order) {
  return apiFetch(`/stacks/${stackId}/layers/reorder`, {
    method: "PUT",
    body: JSON.stringify(order),
  });
}

// ---------------------------------------------------------------------------
// Flake proxy (via Stack Planning backend → GMM backend)
// ---------------------------------------------------------------------------

export function fetchFlakes(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return apiFetch(`/proxy/flakes${qs ? "?" + qs : ""}`);
}

export function fetchMaterials() {
  return apiFetch("/proxy/materials");
}

export function fetchCombinations() {
  return apiFetch("/proxy/combinations");
}

export function fetchScanUsers() {
  return apiFetch("/proxy/scan-users");
}

export function fetchUsedFlakeIds() {
  return apiFetch("/used-flake-ids");
}

// ---------------------------------------------------------------------------
// Flake notes
// ---------------------------------------------------------------------------

export function fetchFlakeNotes(flakeId) {
  return apiFetch(`/flakes/${flakeId}/notes`);
}

export function saveFlakeNotes(flakeId, notes) {
  return apiFetch(`/flakes/${flakeId}/notes`, {
    method: "PUT",
    body: JSON.stringify({ notes }),
  });
}
