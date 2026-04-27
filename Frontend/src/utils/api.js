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

// Local uploads live on the Stack Planning backend. `local_image_url` is stored
// as a server-relative path (e.g. "/uploads/<hex>.png"); resolve it to a full
// URL the browser can load. Blob and data URLs pass through unchanged so legacy
// client-only layers still render during a session.
export function resolveLocalImageUrl(url) {
  if (!url) return null;
  if (/^(https?:|blob:|data:)/i.test(url)) return url;
  return `${BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

export async function uploadImage(file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${BASE}/uploads`, { method: "POST", body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// `layerId` + `imageFilename` are optional; when both are present and the layer
// has a user-painted mask for that base image, the backend swaps in the user
// mask and the appropriate base image automatically.
function _withUserMaskParams(qs, { layerId, imageFilename } = {}) {
  if (layerId != null && imageFilename) {
    qs.set("layer_id", String(layerId));
    qs.set("image_filename", imageFilename);
  }
  return qs;
}

export function flakeCropUrl(flakePath, opts) {
  if (!flakePath) return null;
  const qs = new URLSearchParams({ flake_path: flakePath });
  _withUserMaskParams(qs, opts);
  return `${BASE}/proxy/crop?${qs.toString()}`;
}

export function flakeMaskedUrl(flakePath, opts) {
  if (!flakePath) return null;
  const qs = new URLSearchParams({ flake_path: flakePath });
  _withUserMaskParams(qs, opts);
  return `${BASE}/proxy/masked?${qs.toString()}`;
}

export function flakeOutlineUrl(flakePath, color, opts) {
  if (!flakePath) return null;
  const qs = new URLSearchParams({ flake_path: flakePath });
  if (color) qs.set("color", color.replace(/^#/, ""));
  _withUserMaskParams(qs, opts);
  return `${BASE}/proxy/outline?${qs.toString()}`;
}

export async function fetchFlakeCentroid(flakePath, optsOrSignal, maybeSignal) {
  if (!flakePath) return { cx_pct: 50, cy_pct: 50 };
  // Backwards-compat: older callers pass (flakePath, signal). Newer callers pass
  // (flakePath, {layerId, imageFilename}, signal).
  let opts, signal;
  if (optsOrSignal && typeof optsOrSignal === "object" && !(optsOrSignal instanceof AbortSignal)) {
    opts = optsOrSignal;
    signal = maybeSignal;
  } else {
    signal = optsOrSignal;
  }
  const qs = new URLSearchParams({ flake_path: flakePath });
  _withUserMaskParams(qs, opts);
  try {
    const r = await fetch(`${BASE}/proxy/centroid?${qs.toString()}`, { signal });
    return await r.json();
  } catch {
    return { cx_pct: 50, cy_pct: 50 };
  }
}

// ---------------------------------------------------------------------------
// User-painted watershed masks (per layer, per base image)
// ---------------------------------------------------------------------------

export function createWatershedMask(stackId, layerId, body) {
  return apiFetch(`/stacks/${stackId}/layers/${layerId}/watershed`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchLayerMasks(stackId, layerId) {
  return apiFetch(`/stacks/${stackId}/layers/${layerId}/masks`);
}

export function deleteLayerMask(stackId, layerId, imageFilename) {
  return apiFetch(
    `/stacks/${stackId}/layers/${layerId}/masks/${encodeURIComponent(imageFilename)}`,
    { method: "DELETE" }
  );
}

/** Returns {filename: bool} for each high-mag image — whether it exists on the GMM server. */
export function fetchAvailableImages(flakePath) {
  return apiFetch(`/proxy/available-images?flake_path=${encodeURIComponent(flakePath)}`);
}

/** Auto-generate watershed masks for all available high-mag images of a layer. */
export function autoWatershedMasks(stackId, layerId) {
  return apiFetch(`/stacks/${stackId}/layers/${layerId}/auto-watershed`, { method: "POST" });
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

export function saveFlakeNotes(flakeId, payload) {
  // payload may contain { notes } and/or { user_override }
  const body = typeof payload === "string" ? { notes: payload } : payload;
  return apiFetch(`/flakes/${flakeId}/notes`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}
