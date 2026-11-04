# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Serve exactly one build tree in Chrome without importing the SDK rebuild tooling."""
import os
import shutil
import sys
import threading
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent / 'storage'))
from performance_run_lock import performance_run_lock


def contained_request_path(root, raw_path, mount='/'):
    """Resolve a request once and reject traversal, symlinks and foreign routes."""
    path = unquote(urlsplit(raw_path).path, errors='strict')
    if not path.startswith(mount) or '\\' in path or '\0' in path:
        raise ValueError('Request is outside the SDK mount')
    relative = path[len(mount):]
    if '..' in PurePosixPath(relative).parts or '%' in relative:
        raise ValueError('SDK request contains traversal or multiple encoding')
    root = Path(root).resolve()
    candidate = root.joinpath(*PurePosixPath(relative).parts).resolve()
    if not candidate.is_relative_to(root):
        raise ValueError('SDK request escaped its serving root')
    return candidate


class SDKHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript', '.mjs': 'text/javascript',
        '.wasm': 'application/wasm', '.json': 'application/json',
    }

    def __init__(self, *args, sdk_root, mount='/', observations, **kwargs):
        self.sdk_root = Path(sdk_root).resolve()
        self.mount = mount
        self.observations = observations
        self.resolved_path = None
        super().__init__(*args, directory=str(self.sdk_root), **kwargs)

    def _resolve(self):
        try:
            self.resolved_path = contained_request_path(self.sdk_root, self.path, self.mount)
            return True
        except (ValueError, UnicodeError):
            self.send_error(404, 'SDK route unavailable')
            return False

    def do_GET(self):
        if self._resolve():
            super().do_GET()

    def do_HEAD(self):
        if self._resolve():
            super().do_HEAD()

    def translate_path(self, path):
        return str(self.resolved_path)

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_request(self, code='-', size='-'):
        self.observations.append({'path': self.path, 'status': int(code), 'bytes': size})

    def log_message(self, format, *args):
        pass


class SDKHTTPServer(ThreadingHTTPServer):
    # Browser module graphs and credentialless frames can open separate pools.
    request_queue_size = 128
    daemon_threads = True


@contextmanager
def sdk_server(root, mount='/', *, handler_class=SDKHandler):
    observations = []
    handler = partial(handler_class, sdk_root=root, mount=mount, observations=observations)
    server = SDKHTTPServer(('127.0.0.1', 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}', observations
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)



def chrome_path(explicit=None):
    candidates = [explicit, os.environ.get('CHROME_PATH')]
    if os.name == 'nt':
        candidates.extend([
            'C:/Program Files/Google/Chrome/Application/chrome.exe',
            'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
            str(Path(os.environ.get('LOCALAPPDATA', '')) / 'Google/Chrome/Application/chrome.exe'),
        ])
    else:
        candidates.extend(shutil.which(name) for name in ('google-chrome', 'chromium', 'chromium-browser'))
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(Path(candidate).resolve())
    raise ValueError('Installed Chromium is required; pass --chrome PATH')
