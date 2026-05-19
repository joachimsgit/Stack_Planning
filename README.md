# Stack Planning

A web app for planning 2D-material heterostructure stacks. Researchers browse
flakes from the 2DMatGMM catalogue, pick them layer-by-layer, and visually
compose a stack by overlaying, dragging, rotating, and adjusting the contrast
of microscope images.

Stack Planning runs alongside the existing **2DMatGMM** website and reuses its
flake database via a thin proxy. A separate local SQLite database stores the
stacks and layers created here so they survive independently of GMM.

---

## Companion services

| Service | URL |
|---------|-----|
| 2DMatGMM Flake Database | <http://134.61.8.242/> |
| MaskTerial Training Frontend | <http://134.61.8.242:8000/> |
| Stack Planning (production) | served by the `nginx` container, default port `8080` |

The header bar inside the app links to the Flake Database and the MaskTerial
Training frontend.

---

## Project layout

```
Stack_Planning/
├── Backend/              Flask API (Python)
│   ├── app.py            entry point
│   ├── services/         flake proxy, watershed segmentation, ...
│   ├── database/         SQLAlchemy models + SQLite file location
│   ├── requirements.txt
│   └── Dockerfile
├── Frontend/             React + Mantine UI
│   ├── src/
│   │   ├── pages/        HomePage, StackEditorPage, NotFound
│   │   ├── components/   AppHeader, FlakePicker, StackCanvas, StackComposer
│   │   └── utils/        API client
│   ├── package.json
│   └── Dockerfile
├── etc/                  nginx config for the production container
├── docker-compose.yml    Backend + frontend build + nginx
├── API.md                Full backend API reference
└── README.md             You are here
```

---

## Architecture overview

- **Backend** (Flask, port `5000` in development) exposes a small REST API
  documented in [`API.md`](API.md). It proxies the upstream GMM API for flake
  metadata and images, stores stacks/layers in SQLite via SQLAlchemy, and
  serves locally uploaded images.
- **Frontend** (React + Mantine, dev port `3001`) renders the stack composer.
  The canvas uses HTML `<img>` elements with CSS transforms (not `<canvas>`)
  for overlay compositing, which keeps image quality crisp at any zoom level.
- **Persistence**: only the stack data lives locally. Flake metadata is
  cached into `StackLayer` rows at save-time so stacks survive deletions in
  the GMM catalogue.

---

## Running in development

### Backend

```sh
cd Backend
python -m venv venv
source venv/bin/activate          # PowerShell: .\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py                     # http://localhost:5000
```

Environment variables (with sensible defaults for local dev):

| Variable | Purpose | Default |
|----------|---------|---------|
| `GMM_API_URL` | Upstream 2DMatGMM API base URL | `http://134.61.8.242:4999` |
| `GMM_IMAGE_URL` | Upstream image server base URL | `http://134.61.8.242/images/` |
| `DATABASE_PATH` | SQLite file path | `./stacks.db` |
| `FS_ROOT` | Where uploaded images are stored | `./data` |
| `SCANS_ROOT` | Read-only mount for scan images | `./scans` |

### Frontend

```sh
cd Frontend
npm install
npm start                         # http://localhost:3001
```

Set `REACT_APP_STACK_BACKEND_URL` if your backend is not on
`http://localhost:5000/`.

---

## Running in production (Docker)

The included `docker-compose.yml` builds the frontend, runs the backend, and
serves the bundled SPA + reverse-proxied API behind nginx on port `8080`.

```sh
docker compose up -d --build
```

The compose file expects the external network `2dmatgmm-website-dev_default`
to exist so the backend container can reach the GMM API by service name. The
SQLite database and uploaded images are bind-mounted to
`/data/NVME_4TB/stack_planning_database` on the host.

---

## Using the app

1. **Create a stack** from the home page and assign it to a user.
2. **Add layers** by picking a flake from the database, typing a 6-digit
   flake ID, importing a local image, or drawing a shape.
3. **Compose the stack** by dragging, rotating, and adjusting opacity /
   contrast of each layer.
4. **Refine masks** via the built-in watershed editor when GMM's automatic
   segmentation needs tightening.
5. **Back up the database** any time from the **Options** menu in the header.

A more detailed walk-through is available in-app from the **Help** button in
the top bar.

### Keyboard shortcuts

| Keys | Action |
|------|--------|
| `Z` + scroll wheel | Zoom canvas in / out |
| `R` + scroll wheel | Rotate active layer |
| `T` + scroll wheel | Cycle through layers |
| `Ctrl` + `J` | Toggle colour scheme |

---

## API reference

The complete list of backend endpoints (stacks, layers, flake proxy, image
uploads, watershed segmentation, backup) is documented in [`API.md`](API.md).
