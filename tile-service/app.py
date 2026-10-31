"""
Serves Deep Zoom (DZI) tiles straight from the original slide file (.svs/.tif/.tiff),
so an uploaded slide can be viewed without converting it first.

Only Express talks to this service (it handles login, permissions and share links), so it
listens on localhost and does no authorisation of its own.

URLs mirror what vips dzsave produced, so OpenSeadragon needs no changes:
    GET /<name>.dzi
    GET /<name>_files/<level>/<col>_<row>.jpg
    GET /<name>/info          slide size and magnification, used after an upload
    GET /health
<name> is the source file name without its extension.
"""
import logging
import os
import threading
import time
from collections import OrderedDict
from io import BytesIO
from pathlib import Path

import openslide
from flask import Flask, abort, jsonify, request, Response
from openslide.deepzoom import DeepZoomGenerator

ROOT_DIR = Path(__file__).resolve().parent.parent


def env_path(name, default):
    value = os.environ.get(name)
    return (ROOT_DIR / value).resolve() if value else default


SOURCE_DIR = env_path('SLIDE_SOURCE_DIR', ROOT_DIR / 'uploads')
CACHE_DIR = env_path('TILE_CACHE_DIR', ROOT_DIR / 'storage' / 'tile-cache')
HOST = os.environ.get('TILE_SERVICE_HOST', '127.0.0.1')
PORT = int(os.environ.get('TILE_SERVICE_PORT', '3100'))
THREADS = int(os.environ.get('TILE_SERVICE_THREADS', '8'))
# 254 + 1px overlap on both sides gives 256px tiles, the size OpenSlide recommends.
TILE_SIZE = 254
OVERLAP = 1
JPEG_QUALITY = int(os.environ.get('TILE_JPEG_QUALITY', '80'))
# 0 disables the disk cache; tiles are then rendered on every request.
CACHE_MAX_BYTES = int(float(os.environ.get('TILE_CACHE_MAX_GB', '5')) * 1024 ** 3)
CACHE_CLEANUP_INTERVAL_S = 10 * 60
# Opening a slide reads its whole TIFF directory, so keep recently used ones open.
OPEN_SLIDE_LIMIT = 10
SOURCE_EXTENSIONS = ('.svs', '.tif', '.tiff')

logging.basicConfig(level=logging.INFO, format='%(asctime)s [tile-service] %(levelname)s %(message)s')
log = logging.getLogger('tile-service')

app = Flask(__name__)


class SlideCache:
    """Keeps the most recently used slides open, closing the oldest past the limit."""

    def __init__(self, limit):
        self.limit = limit
        self.lock = threading.Lock()
        self.entries = OrderedDict()

    def get(self, path):
        # The file's mtime is part of the key, so a replaced file is opened afresh.
        key = (str(path), path.stat().st_mtime_ns)
        with self.lock:
            entry = self.entries.get(key)
            if entry:
                self.entries.move_to_end(key)
                return entry

        slide = openslide.OpenSlide(str(path))
        entry = (slide, DeepZoomGenerator(slide, tile_size=TILE_SIZE, overlap=OVERLAP, limit_bounds=False))

        with self.lock:
            existing = self.entries.get(key)
            if existing:
                # Another request opened it meanwhile; keep theirs.
                slide.close()
                return existing
            self.entries[key] = entry
            while len(self.entries) > self.limit:
                _, (old_slide, _) = self.entries.popitem(last=False)
                old_slide.close()
        return entry

    def forget(self, path):
        with self.lock:
            for key in [key for key in self.entries if key[0] == str(path)]:
                self.entries.pop(key)[0].close()


slides = SlideCache(OPEN_SLIDE_LIMIT)


def find_source(name):
    """Maps a slide name to its source file, refusing anything outside SOURCE_DIR."""
    if not name or '/' in name or '\\' in name or name.startswith('.'):
        abort(400, 'Invalid slide name')
    for extension in SOURCE_EXTENSIONS:
        path = (SOURCE_DIR / f'{name}{extension}').resolve()
        if path.parent != SOURCE_DIR:
            abort(400, 'Invalid slide name')
        if path.is_file():
            return path
    abort(404, 'Slide not found')


def open_slide(name):
    path = find_source(name)
    try:
        return slides.get(path)
    except (openslide.OpenSlideError, openslide.OpenSlideUnsupportedFormatError) as error:
        log.warning('Cannot open %s: %s', path.name, error)
        abort(415, 'Unsupported or damaged slide file')


def magnification(slide):
    try:
        value = float(slide.properties.get(openslide.PROPERTY_NAME_OBJECTIVE_POWER, ''))
    except ValueError:
        return None
    return round(value) if value > 0 else None


@app.get('/health')
def health():
    return jsonify(status='ok', sourceDir=str(SOURCE_DIR), cacheDir=str(CACHE_DIR))


@app.get('/<name>/info')
def slide_info(name):
    slide, dz = open_slide(name)
    width, height = slide.dimensions
    mpp_x = slide.properties.get(openslide.PROPERTY_NAME_MPP_X)
    return jsonify(
        width=width,
        height=height,
        levels=dz.level_count,
        magnification=magnification(slide),
        mppX=float(mpp_x) if mpp_x else None,
        vendor=slide.properties.get(openslide.PROPERTY_NAME_VENDOR),
    )


@app.get('/<name>.dzi')
def dzi(name):
    _, dz = open_slide(name)
    # The viewer builds tile URLs from Format, so it must match the .jpg route below.
    response = Response(dz.get_dzi('jpg'), mimetype='application/xml')
    response.headers['Cache-Control'] = 'no-cache'
    return response


@app.get('/<name>_files/<int:level>/<int:col>_<int:row>.jpg')
def tile(name, level, col, row):
    source = find_source(name)
    cache_path = CACHE_DIR / name / str(level) / f'{col}_{row}.jpg'

    if CACHE_MAX_BYTES and cache_path.is_file():
        try:
            data = cache_path.read_bytes()
            # The cleanup removes the least recently used tiles first.
            os.utime(cache_path)
            return tile_response(data, 'hit')
        except OSError:
            pass  # removed by the cleanup meanwhile; render it again

    _, dz = open_slide(name)
    try:
        image = dz.get_tile(level, (col, row))
    except ValueError:
        abort(404, 'Tile out of range')

    buffer = BytesIO()
    image.save(buffer, 'jpeg', quality=JPEG_QUALITY)
    data = buffer.getvalue()

    if CACHE_MAX_BYTES and source.is_file():
        write_cache(cache_path, data)
    return tile_response(data, 'miss')


def tile_response(data, cache_state):
    response = Response(data, mimetype='image/jpeg')
    response.headers['Cache-Control'] = 'private, max-age=2592000, immutable'
    response.headers['X-Tile-Cache'] = cache_state
    return response


def write_cache(path, data):
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Write then rename so a request never reads a half-written tile.
        temp_path = path.with_name(f'{path.name}.{threading.get_ident()}.tmp')
        temp_path.write_bytes(data)
        os.replace(temp_path, path)
    except OSError as error:
        log.warning('Failed to cache tile %s: %s', path, error)


@app.delete('/<name>')
def forget_slide(name):
    """Closes a deleted slide and removes its cached tiles. Called by Express."""
    if not name or '/' in name or '\\' in name or name.startswith('.'):
        abort(400, 'Invalid slide name')
    for extension in SOURCE_EXTENSIONS:
        slides.forget((SOURCE_DIR / f'{name}{extension}').resolve())
    remove_tree(CACHE_DIR / name)
    return '', 204


def remove_tree(path):
    if not path.exists():
        return
    for child in sorted(path.rglob('*'), key=lambda item: len(item.parts), reverse=True):
        try:
            child.rmdir() if child.is_dir() else child.unlink()
        except OSError:
            pass
    try:
        path.rmdir()
    except OSError:
        pass


def trim_cache():
    """Deletes the least recently used tiles until the cache fits in CACHE_MAX_BYTES."""
    files = []
    total = 0
    for path in CACHE_DIR.rglob('*.jpg'):
        try:
            stat = path.stat()
        except OSError:
            continue
        files.append((stat.st_mtime, stat.st_size, path))
        total += stat.st_size
    if total <= CACHE_MAX_BYTES:
        return

    # Trim to 90% so the next cleanup does not start straight away.
    target = CACHE_MAX_BYTES * 0.9
    removed = 0
    for _, size, path in sorted(files):
        if total <= target:
            break
        try:
            path.unlink()
            total -= size
            removed += 1
        except OSError:
            pass
    log.info('Cache trimmed: %d tiles removed, %.1f GB left', removed, total / 1024 ** 3)


def cleanup_loop():
    while True:
        try:
            trim_cache()
        except Exception:
            log.exception('Cache cleanup failed')
        time.sleep(CACHE_CLEANUP_INTERVAL_S)


@app.after_request
def log_slow_requests(response):
    elapsed = time.perf_counter() - request.environ.get('tile.started', time.perf_counter())
    if elapsed > 1:
        log.warning('Slow request %s took %.1fs', request.path, elapsed)
    return response


@app.before_request
def mark_start():
    request.environ['tile.started'] = time.perf_counter()


def main():
    from waitress import serve

    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    if CACHE_MAX_BYTES:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        threading.Thread(target=cleanup_loop, daemon=True).start()
    log.info('Listening on http://%s:%d (slides: %s, cache: %s)', HOST, PORT, SOURCE_DIR,
             CACHE_DIR if CACHE_MAX_BYTES else 'disabled')
    serve(app, host=HOST, port=PORT, threads=THREADS)


if __name__ == '__main__':
    main()
