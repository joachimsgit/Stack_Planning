# Stack Planning API Reference

All endpoints are served by the Flask backend. The base URL is configured via `REACT_APP_STACK_BACKEND_URL` (default: `http://localhost:5000/`).

All responses are **gzip-compressed JSON**. Errors return `{"error": "message"}` with the appropriate HTTP status code.

---

## Health Check

### `GET /`

Returns service status.

**Response**
```json
{ "status": "ok", "service": "stack-planning" }
```

---

## Flake Proxy

These endpoints forward requests to the upstream 2DMatGMM backend and add CORS-safe image handling.

### `GET /proxy/flakes`

Returns a list of flakes from the GMM backend. All query parameters are forwarded, with two additional optional filters.

| Query Parameter | Type | Description |
|-----------------|------|-------------|
| `scan_time_min` | float (optional) | Filter flakes scanned after this Unix timestamp |
| `scan_time_max` | float (optional) | Filter flakes scanned before this Unix timestamp |
| *(any other param)* | — | Forwarded verbatim to GMM API |

**Response** — JSON array of flake objects, sorted by `flake_id` descending.

---

### `GET /proxy/materials`

Returns the list of available flake materials.

**Response** — JSON array of material name strings.

---

### `GET /proxy/combinations`

Returns unique material combinations available in the GMM database.

**Response** — JSON object with combination data.

---

### `GET /proxy/image`

Proxies a flake image from the GMM Nginx server (avoids browser ORB blocking).

| Query Parameter | Type | Description |
|-----------------|------|-------------|
| `flake_path` | string (required) | Path to the flake directory on the image server |
| `filename` | string (default: `"eval_img.jpg"`) | Image filename to fetch |

**Response** — Raw image bytes (JPEG or PNG). Returns a transparent 1×1 PNG placeholder if the image is not found.

---

### `GET /proxy/crop`

Returns a tightly-cropped RGBA PNG of a flake with a transparent background. Result is cached in memory.

| Query Parameter | Type | Description |
|-----------------|------|-------------|
| `flake_path` | string (required) | Path to the flake directory |
| `padding` | int (default: `30`) | Padding in pixels around the flake bounding box |

**Response** — RGBA PNG image.

---

### `GET /proxy/masked`

Returns a full-size RGBA PNG where flake pixels are opaque and the background is transparent (no crop). Result is cached in memory.

| Query Parameter | Type | Description |
|-----------------|------|-------------|
| `flake_path` | string (required) | Path to the flake directory |

**Response** — RGBA PNG image.

---

### `GET /proxy/outline`

Returns a full-size RGBA PNG with a yellow contour drawn around the flake on a transparent background. Result is cached in memory.

| Query Parameter | Type | Description |
|-----------------|------|-------------|
| `flake_path` | string (required) | Path to the flake directory |

**Response** — RGBA PNG image.

---

### `GET /proxy/centroid`

Returns centroid location and crop bounding box geometry for a flake. Result is cached in memory.

| Query Parameter | Type | Description |
|-----------------|------|-------------|
| `flake_path` | string (required) | Path to the flake directory |

**Response**
```json
{
  "cx_pct": 48.3,
  "cy_pct": 51.2,
  "crop_cx_pct": 50.0,
  "crop_cy_pct": 50.0,
  "crop_scale": 0.42,
  "bbox_left_pct": 30.1,
  "bbox_top_pct": 35.6,
  "bbox_right_pct": 69.9,
  "bbox_bottom_pct": 64.4
}
```

All values are percentages (0–100) relative to image dimensions.

---

## Users

### `GET /users`

Returns all users sorted by name.

**Response** — JSON array of user objects.

---

### `POST /users`

Creates a new user, or returns the existing user if the name already exists (idempotent).

**Request Body**
```json
{ "name": "Alice" }
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string (required) | Display name, whitespace-trimmed |

**Response**
```json
{
  "id": 1,
  "name": "Alice",
  "created_at": "2026-04-18T12:00:00"
}
```

**Status Codes**
- `201` — user created
- `200` — existing user returned
- `400` — name is empty

---

## Stacks

### `GET /stacks`

Returns all stacks, newest first.

**Response** — JSON array of stack objects.

---

### `POST /stacks`

Creates a new stack.

**Request Body**
```json
{
  "name": "My Stack",
  "notes": "Optional notes",
  "user_id": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string (required) | Stack name, whitespace-trimmed |
| `notes` | string (optional) | Free-text notes |
| `user_id` | int (optional) | Must reference an existing user |

**Response** — Stack object with `id`, `name`, `notes`, `user_id`, `created_at`, `updated_at`.

**Status Codes**
- `201` — stack created
- `400` — name is empty
- `404` — `user_id` not found

---

### `GET /stacks/<stack_id>`

Returns a single stack with its nested layers array.

**Status Codes** — `200` or `404`

---

### `PUT /stacks/<stack_id>`

Updates stack metadata.

**Request Body** (all fields optional)
```json
{
  "name": "Renamed Stack",
  "notes": "Updated notes"
}
```

**Response** — Updated stack object.

**Status Codes** — `200` or `404`

---

### `DELETE /stacks/<stack_id>`

Deletes a stack and all its layers.

**Response**
```json
{ "deleted": 3 }
```

**Status Codes** — `200` or `404`

---

## Layers

### `POST /stacks/<stack_id>/layers`

Adds a flake layer to a stack.

**Request Body**
```json
{
  "flake_id": 42,
  "flake_material": "Graphene",
  "flake_size": 15.3,
  "flake_thickness": 3,
  "flake_path": "/path/to/flake",
  "layer_index": 0,
  "pos_x": 0.0,
  "pos_y": 0.0,
  "rotation": 0.0,
  "opacity": 0.7,
  "brightness": 1.0,
  "contrast": 1.0,
  "image_filename": "eval_img.jpg"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `flake_id` | int (required) | ID of the flake in the GMM database |
| `flake_material` | string (optional) | Material label |
| `flake_size` | float (optional) | Flake size in µm² |
| `flake_thickness` | float (optional) | Flake thickness in layers |
| `flake_path` | string (optional) | If omitted, fetched automatically from GMM API |
| `layer_index` | int (optional) | Z-order position; defaults to max + 1 |
| `pos_x` | float (default: `0.0`) | Horizontal offset |
| `pos_y` | float (default: `0.0`) | Vertical offset |
| `rotation` | float (default: `0.0`) | Rotation in degrees |
| `opacity` | float (default: `0.7`) | 0.0–1.0 |
| `brightness` | float (default: `1.0`) | Brightness multiplier |
| `contrast` | float (default: `1.0`) | Contrast multiplier |
| `image_filename` | string (default: `"eval_img.jpg"`) | Which image file to display |

**Response** — Layer object with all properties.

**Status Codes** — `201` or `404` (stack not found)

---

### `PUT /stacks/<stack_id>/layers/<layer_id>`

Updates layer transform and display properties.

**Request Body** (all fields optional)
```json
{
  "pos_x": 10.5,
  "pos_y": -3.2,
  "rotation": 45.0,
  "opacity": 0.8,
  "brightness": 1.1,
  "contrast": 0.95,
  "layer_index": 2,
  "image_filename": "eval_img.jpg"
}
```

**Response** — Updated layer object.

**Status Codes** — `200` or `404`

---

### `DELETE /stacks/<stack_id>/layers/<layer_id>`

Removes a layer from a stack.

**Response**
```json
{ "deleted": 7 }
```

**Status Codes** — `200` or `404`

---

### `PUT /stacks/<stack_id>/layers/reorder`

Batch-updates the `layer_index` of multiple layers in a single request.

**Request Body**
```json
[
  { "id": 7, "layer_index": 0 },
  { "id": 8, "layer_index": 1 },
  { "id": 9, "layer_index": 2 }
]
```

**Response** — Updated stack object with all layers.

**Status Codes** — `200` or `404`

---

## Utilities

### `GET /used-flake-ids`

Returns the distinct set of flake IDs already used in any stack layer (useful for greying out already-placed flakes in the picker).

**Response**
```json
[1, 5, 42, 99]
```

---

## Frontend API Helpers (`src/utils/api.js`)

The frontend wraps every call through `apiFetch`, which prepends `REACT_APP_STACK_BACKEND_URL`.

### URL Builder Functions (no network request)

| Function | Returns |
|----------|---------|
| `flakeImageUrl(flakePath, filename?)` | `/proxy/image?flake_path=…&filename=…` |
| `flakeCropUrl(flakePath)` | `/proxy/crop?flake_path=…` |
| `flakeMaskedUrl(flakePath)` | `/proxy/masked?flake_path=…` |
| `flakeOutlineUrl(flakePath)` | `/proxy/outline?flake_path=…` |

### Fetch Functions

| Function | Method | Path |
|----------|--------|------|
| `fetchFlakes(params)` | GET | `/proxy/flakes` |
| `fetchMaterials()` | GET | `/proxy/materials` |
| `fetchCombinations()` | GET | `/proxy/combinations` |
| `fetchUsedFlakeIds()` | GET | `/used-flake-ids` |
| `fetchFlakeCentroid(flakePath)` | GET | `/proxy/centroid` |
| `fetchUsers()` | GET | `/users` |
| `createUser(name)` | POST | `/users` |
| `fetchStacks()` | GET | `/stacks` |
| `createStack(name, notes?, userId?)` | POST | `/stacks` |
| `fetchStack(id)` | GET | `/stacks/{id}` |
| `updateStack(id, data)` | PUT | `/stacks/{id}` |
| `deleteStack(id)` | DELETE | `/stacks/{id}` |
| `addLayer(stackId, layerData)` | POST | `/stacks/{stackId}/layers` |
| `updateLayer(stackId, layerId, data)` | PUT | `/stacks/{stackId}/layers/{layerId}` |
| `deleteLayer(stackId, layerId)` | DELETE | `/stacks/{stackId}/layers/{layerId}` |
| `reorderLayers(stackId, order)` | PUT | `/stacks/{stackId}/layers/reorder` |

`fetchFlakeCentroid` falls back to `{ cx_pct: 50, cy_pct: 50 }` on error rather than throwing.

---

## Upstream GMM API (internal, called by Backend)

The backend calls these endpoints on the 2DMatGMM service (`flake_api_url` from `config.json`):

| Function | Method | Remote Path | Timeout |
|----------|--------|-------------|---------|
| `get_flakes(config, query_params)` | GET | `/flakes` | 30 s |
| `get_flake(config, flake_id)` | GET | `/flakes?flake_id={id}` | 10 s |
| `get_materials(config)` | GET | `/stats/materials` | 10 s |
| `get_combinations(config)` | GET | `/stats/uniqueCombinations` | 10 s |

Image proxy endpoints fetch from `image_url` (also from `config.json`) with a 15 s timeout.
