# Tile service

Serves Deep Zoom tiles straight from the uploaded slide file (.svs/.tif/.tiff) with
OpenSlide, so a slide can be viewed right after upload without a conversion step.
Express proxies to it; it listens on localhost only and does no authorisation itself.

## Setup

```powershell
cd tile-service
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```

## Run

```powershell
.venv\Scripts\python app.py
```

## Endpoints

| URL | Returns |
|---|---|
| `GET /<name>.dzi` | DZI descriptor |
| `GET /<name>_files/<level>/<col>_<row>.jpg` | One tile (header `X-Tile-Cache: hit/miss`) |
| `GET /<name>/info` | Width, height, magnification, mpp, vendor |
| `DELETE /<name>` | Closes the slide and removes its cached tiles |
| `GET /health` | Status and configured folders |

`<name>` is the source file name without its extension.

## Configuration (environment variables)

| Variable | Default | |
|---|---|---|
| `SLIDE_SOURCE_DIR` | `uploads` | Folder with the source slides, relative to the project root |
| `TILE_CACHE_DIR` | `storage/tile-cache` | Rendered tile cache |
| `TILE_CACHE_MAX_GB` | `5` | Least recently used tiles are removed past this size; `0` disables the cache |
| `TILE_SERVICE_HOST` | `127.0.0.1` | |
| `TILE_SERVICE_PORT` | `3100` | |
| `TILE_SERVICE_THREADS` | `8` | |
| `TILE_JPEG_QUALITY` | `80` | |
