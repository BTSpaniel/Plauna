# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Export the current Plauna source and browser runtime without a full Engine SDK.

Run under the project's storage coordinator after admission. The destination must
be a new or empty directory; this producer never overwrites an existing artifact.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import logging
import os
import re
import struct
import zlib
from pathlib import Path
from urllib.parse import unquote, urlsplit

from . import builder, emitter
from .config import load_cyclic_baseline
from .graph import ModuleGraph
from .parser import _iter_code_tokens
from .plauna_assets import plauna_runtime_asset_manifest
from .release_validation import _safe_release_relative_path
from .security_fs import safe_read_bytes

LOG = logging.getLogger(__name__)
FORMAT = "plauna-library/v1"
ENTRY = "plauna/index.js"
DEFAULT_MAX_BYTES = 100_000_000
MAX_FILES = 10_000
EXCLUDED_PARTS = frozenset({
    ".git", ".cache", "__pycache__", ".pytest_cache", "node_modules",
    "build", "dist", "outputs", "artifacts", "reports", "logs",
})
MODULE_SUFFIXES = frozenset({".js", ".mjs"})
URL_RESOURCE = re.compile(
    r"\bnew\s+URL\(\s*(['\"])([^'\"\r\n]+)\1\s*,\s*import\.meta\.url\s*\)"
)
CSS_RESOURCE = re.compile(
    r"(?:@import\s+(?:url\(\s*)?|url\(\s*)['\"]?([^'\"\s);]+)", re.I
)
COPYRIGHT = "2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>"
REBUILD_MODULES = (
    "__init__.py", "plauna.py", "plauna_assets.py", "builder.py", "config.py",
    "graph.py", "emitter.py", "parser.py", "transform.py", "textscan.py",
    "scan_import_paths.py", "release_validation.py", "security_fs.py",
)
VALIDATION_FILES = (
    "bundler/tests/__init__.py", "bundler/tests/test_plauna_export.py",
    "bundler/tests/test_plauna_distribution_browser.py",
    "tests/plauna_browser_support.py", "tests/storage/performance_run_lock.py",
    "tests/test_plauna_button_browser.py", "tests/test_plauna_faces_bars_parity.py",
    "tests/test_plauna_focus_ring_parity.py", "tests/test_plauna_gpu_input.py",
    "tests/test_plauna_layout_paint_parity.py", "tests/test_plauna_layout_scrollbars.py",
    "tests/test_plauna_native_paint_parity.py", "tests/test_plauna_native_well.py",
    "tests/test_plauna_real_scaling.py", "tests/test_plauna_style_fields_scrollbars.py",
    "tests/test_plauna_surface_sticky.py", "tests/test_plauna_text_features.py",
    "tests/plauna-gpu-input.html", "tests/plauna-gpu-input.js",
    "tests/plauna-layout-parity.html", "tests/plauna-layout-parity.test.js",
)
MEDIA_NAMES = (
    "showcase-overview.png", "showcase-controls.png", "showcase-theme.png",
    "showcase-rendering.png", "plauna-showcase.mp4",
)
MEDIA_MAX_BYTES = 40_000_000
MEDIA_FILE_LIMITS = {".png": 6_000_000, ".mp4": 25_000_000}
MEDIA_MARKER = "<!-- plauna-release-media -->"
MEDIA_SECTION = """## See Plauna in action

[![Plauna's source widget gallery in the dark theme. Select to play the video.](assets/showcase-overview.png)](assets/plauna-showcase.mp4)

[Play the Plauna showcase video (MP4)](assets/plauna-showcase.mp4).

| Source Button playground | Compiled Donut Chart | Compiled GPU Bar Chart |
| --- | --- | --- |
| ![Gradient Button in the dark DOM playground](assets/showcase-controls.png) | ![Donut Chart in the light DOM playground](assets/showcase-theme.png) | ![Multicolour Bar Chart painted by the GPU in the dark theme](assets/showcase-rendering.png) |
"""
LICENSE_SCOPE = b"""Plauna standalone distribution: license scope

The MIT license below applies to the Plauna code marked SPDX-License-Identifier:
MIT. Included Particle Engine support modules and Python build tools retain
their own per-file license identifiers. The Particle Realms Alpha terms are in
LICENSES/LicenseRef-ParticleRealms-Alpha.txt. Third-party notices are in
NOTICE.md. The MIT grant for Plauna does not relicense these dependencies.

"""


def _json_bytes(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _record(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def _is_link(path):
    return path.is_symlink() or getattr(path, "is_junction", lambda: False)()


def _secure_path(root, relative):
    relative = _safe_release_relative_path(relative, "Plauna export")
    current = root
    for part in relative.parts:
        current = current / part
        if _is_link(current):
            raise ValueError(f"Linked export input is forbidden: {current}")
    if not current.resolve().is_relative_to(root):
        raise ValueError(f"Export path escapes source root: {relative}")
    return current


def _authored_files(root, folder):
    start = _secure_path(root, folder)
    if not start.is_dir():
        raise FileNotFoundError(f"Required source directory is missing: {start}")
    result = []
    for directory, children, names in os.walk(start, followlinks=False):
        children[:] = sorted(name for name in children if name not in EXCLUDED_PARTS)
        for name in children:
            if _is_link(Path(directory) / name):
                raise ValueError(f"Linked source directory is forbidden: {Path(directory) / name}")
        for name in sorted(names):
            path = Path(directory) / name
            if path.suffix.lower() in {".pyc", ".pyo"}:
                continue
            relative = path.relative_to(root).as_posix()
            _secure_path(root, relative)
            result.append(relative)
            if len(result) > MAX_FILES:
                raise ValueError("Plauna source file limit exceeded")
    return tuple(sorted(result))


class SourceSnapshot:
    """Bounded immutable bytes, with an explicit concurrent-edit rejection gate."""

    def __init__(self, root, max_bytes):
        self.root = root
        self.max_bytes = max_bytes
        self.files = {}
        self.total_bytes = 0

    def read(self, relative):
        relative = _safe_release_relative_path(relative, "snapshot input").as_posix()
        if relative in self.files:
            return self.files[relative]
        if len(self.files) >= MAX_FILES:
            raise ValueError("Plauna input file limit exceeded")
        path = _secure_path(self.root, relative)
        remaining = self.max_bytes - self.total_bytes
        size = path.stat().st_size
        if size > remaining:
            raise ValueError(f"Plauna input byte limit exceeded by {relative}")
        data = safe_read_bytes(self.root, relative, max_bytes=size)
        if len(data) > remaining:
            raise ValueError(f"Plauna input byte limit exceeded by {relative}")
        self.files[relative] = data
        self.total_bytes += len(data)
        return data

    def verify(self):
        for relative, expected in self.files.items():
            path = _secure_path(self.root, relative)
            if not path.is_file() or path.stat().st_size != len(expected):
                raise ValueError(f"Source changed during Plauna export: {relative}")
            actual = safe_read_bytes(self.root, relative, max_bytes=len(expected))
            if actual != expected:
                raise ValueError(f"Source changed during Plauna export: {relative}")

    def records(self):
        return {name: _record(data) for name, data in sorted(self.files.items())}


class _SnapshotGraph(ModuleGraph):
    """Feed the existing resolver bounded, pinned bytes for every visited module."""

    def __init__(self, snapshot, baseline):
        super().__init__(snapshot.root, cyclic_baseline=baseline)
        self.snapshot = snapshot

    def _visit(self, physical, source_override=None):
        if physical not in self.visited and source_override is None:
            raw = self.snapshot.read(self.mod_id(physical))
            source_override = raw.decode("utf-8", errors="strict").replace("\r\n", "\n").replace("\r", "\n")
        return super()._visit(physical, source_override)

    def resolve_import(self, from_file, specifier):
        if specifier.startswith((".", "/")):
            base = self.root if specifier.startswith("/") else Path(from_file).parent
            lexical = Path(os.path.abspath(base / specifier.lstrip("/")))
            if not lexical.is_relative_to(self.root):
                raise ValueError(f"Import escapes source root: {self.mod_id(from_file)}: {specifier}")
            if lexical != self.root:
                _secure_path(self.root, lexical.relative_to(self.root).as_posix())
        return super().resolve_import(from_file, specifier)


def _resource_path(root, owner, value):
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc or not parsed.path or value.startswith("#"):
        return None
    path_text = unquote(parsed.path)
    candidate = ((root / path_text.lstrip("/")) if path_text.startswith("/")
                 else root / Path(owner).parent / path_text)
    lexical = Path(os.path.abspath(candidate))
    if not lexical.is_relative_to(root):
        raise ValueError(f"Resource escapes source root: {owner}: {value}")
    if lexical == root:
        return None
    relative = lexical.relative_to(root).as_posix()
    resolved = _secure_path(root, relative)
    if resolved.is_dir():
        # Directory base URLs (the theme loader, for example) are not files.
        return None
    if not resolved.is_file():
        raise FileNotFoundError(f"Missing Plauna runtime resource: {owner}: {value}")
    return relative


def _resources(root, relative, data):
    suffix = Path(relative).suffix.lower()
    if suffix not in MODULE_SUFFIXES | {".css"}:
        return ()
    source = data.decode("utf-8", errors="strict")
    if suffix == ".css":
        source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
        values = [match.group(1) for match in CSS_RESOURCE.finditer(source)]
    else:
        # Existing code tokens exclude comments, regexes, and quoted examples.
        matches = tuple(URL_RESOURCE.finditer(source))
        if not matches:
            return ()
        starts = {token.start for token in _iter_code_tokens(source) if token.value == "new"}
        values = [match.group(2) for match in matches if match.start() in starts]
    return tuple(filter(None, (_resource_path(root, relative, value) for value in values)))


def _version(snapshot):
    source = snapshot.read("engine/version.js").decode("utf-8", errors="strict")
    values = {}
    for name in ("PLAUNA_VERSION", "BUILD_TAG"):
        matches = re.findall(rf"export\s+const\s+{name}\s*=\s*['\"]([^'\"]+)['\"]", source)
        if len(matches) != 1:
            raise ValueError(f"Expected exactly one canonical {name}")
        values[name] = matches[0]
    if not re.fullmatch(r"\d+\.\d+\.\d+", values["PLAUNA_VERSION"]):
        raise ValueError("Invalid canonical Plauna version")
    if not re.fullmatch(r"[0-9A-Za-z.-]+", values["BUILD_TAG"]):
        raise ValueError("Invalid canonical Plauna build tag")
    values["PLAUNA_FULL"] = f"v{values['PLAUNA_VERSION']}-{values['BUILD_TAG']}"
    return values


def _validate_png(data, name):
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError(f"Invalid PNG signature: {name}")
    offset, chunks, image_bytes = 8, [], 0
    while offset < len(data):
        if len(data) - offset < 12:
            raise ValueError(f"Truncated PNG chunk: {name}")
        length, kind = struct.unpack_from(">I4s", data, offset)
        end = offset + 12 + length
        if end > len(data):
            raise ValueError(f"Invalid PNG chunk length: {name}")
        payload = data[offset + 8:end - 4]
        crc = struct.unpack_from(">I", data, end - 4)[0]
        if zlib.crc32(kind + payload) != crc:
            raise ValueError(f"Invalid PNG chunk checksum: {name}")
        if not chunks:
            if kind != b"IHDR" or length != 13:
                raise ValueError(f"Missing PNG image header: {name}")
            width, height = struct.unpack_from(">II", payload)
            if not (1 <= width <= 8192 and 1 <= height <= 8192):
                raise ValueError(f"PNG dimensions outside release bounds: {name}")
        if kind == b"IDAT":
            image_bytes += length
        if kind == b"IEND" and (length or end != len(data)):
            raise ValueError(f"Invalid PNG end marker: {name}")
        chunks.append(kind)
        offset = end
    if not chunks or chunks[-1] != b"IEND" or image_bytes == 0:
        raise ValueError(f"Incomplete PNG image: {name}")


def _validate_mp4(data, name):
    offset, boxes = 0, {}
    while offset < len(data):
        if len(data) - offset < 8:
            raise ValueError(f"Truncated MP4 box: {name}")
        length, kind = struct.unpack_from(">I4s", data, offset)
        header = 8
        if length == 1:
            if len(data) - offset < 16:
                raise ValueError(f"Truncated extended MP4 box: {name}")
            length, header = struct.unpack_from(">Q", data, offset + 8)[0], 16
        elif length == 0:
            length = len(data) - offset
        if length < header or offset + length > len(data):
            raise ValueError(f"Invalid MP4 box length: {name}")
        if not boxes and (kind != b"ftyp" or length < header + 8):
            raise ValueError(f"Missing MP4 file type header: {name}")
        if kind == b"ftyp":
            payload = data[offset + header:offset + length]
            brands = [payload[:4], *[payload[i:i + 4] for i in range(8, len(payload), 4)]]
            if len(payload) % 4 or not any(brand.startswith((b"iso", b"mp4")) or brand in {b"avc1", b"M4V "} for brand in brands):
                raise ValueError(f"Unrecognized MP4 container brand: {name}")
        boxes[kind] = boxes.get(kind, 0) + length - header
        offset += length
    if not boxes.get(b"moov") or not boxes.get(b"mdat"):
        raise ValueError(f"MP4 must contain movie metadata and sample data: {name}")


def _release_media(media_root, max_bytes):
    root = Path(os.path.abspath(media_root))
    if any(_is_link(part) for part in (root, *root.parents)):
        raise ValueError("Linked media root is forbidden")
    root = root.resolve(strict=True)
    snapshot = SourceSnapshot(root, min(MEDIA_MAX_BYTES, max_bytes))
    for name in MEDIA_NAMES:
        path = _secure_path(root, name)
        suffix = path.suffix.lower()
        if not path.is_file() or path.stat().st_size > MEDIA_FILE_LIMITS[suffix]:
            raise ValueError(f"Missing or oversized release media: {name}")
        data = snapshot.read(name)
        if len(data) > MEDIA_FILE_LIMITS[suffix]:
            raise ValueError(f"Oversized release media: {name}")
        (_validate_png if suffix == ".png" else _validate_mp4)(data, name)
    snapshot.verify()
    return snapshot


def collect_sources(root, max_bytes):
    """Preserve every Plauna module and its exact external/resource closure."""
    snapshot = SourceSnapshot(root, max_bytes)
    authored = _authored_files(root, "plauna")
    baseline_path = root / "bundler/cyclic_baseline.json"
    baseline = []
    if baseline_path.is_file():
        snapshot.read("bundler/cyclic_baseline.json")
        baseline = load_cyclic_baseline(baseline_path)
    graph = _SnapshotGraph(snapshot, baseline)
    copies = {relative: relative for relative in authored}
    for source, destination in plauna_runtime_asset_manifest(root):
        _safe_release_relative_path(destination, "Plauna asset destination")
        if destination in copies and copies[destination] != source:
            raise ValueError(f"Conflicting Plauna asset destination: {destination}")
        copies[destination] = source
    pending = set(copies.values())
    scanned = set()
    checked_modules = set()
    while pending:
        relative = min(pending)
        pending.remove(relative)
        if relative in scanned:
            continue
        data = snapshot.read(relative)
        scanned.add(relative)
        if Path(relative).suffix.lower() in MODULE_SUFFIXES:
            graph.walk(relative)
            if graph.errors:
                raise ValueError("Plauna import closure failed: " + "; ".join(graph.errors[:12]))
            for physical, raw in graph.raw_modules.items():
                if physical in checked_modules:
                    continue
                module = graph.mod_id(physical)
                actual = snapshot.read(module)
                if actual.decode("utf-8", errors="strict").replace("\r\n", "\n").replace("\r", "\n") != raw:
                    raise ValueError(f"Source changed while resolving imports: {module}")
                for specifier in graph._extract_import_paths(raw):
                    if not specifier.startswith("."):
                        raise ValueError(f"Non-portable static import in {module}: {specifier}")
                copies.setdefault(module, module)
                checked_modules.add(physical)
                if module not in scanned:
                    pending.add(module)
        for resource in _resources(root, relative, data):
            copies.setdefault(resource, resource)
            if resource not in scanned:
                pending.add(resource)
    for relative in ("LICENSES/LicenseRef-ParticleRealms-Alpha.txt", "NOTICE.md", "AUTHORS"):
        snapshot.read(relative)
        copies[relative] = relative
    # Any third-party license beside, or above, a shipped dependency is required.
    for relative in tuple(copies.values()):
        if relative.startswith(("plauna/", "engine/", "webgpu-os/")):
            continue
        parent = (root / relative).parent
        while parent != root:
            for path in sorted(parent.glob("*")):
                if path.is_file() and re.match(r"^(?:LICENSE|COPYING|NOTICE)(?:[._-].*)?$", path.name, re.I):
                    license_name = path.relative_to(root).as_posix()
                    snapshot.read(license_name)
                    copies[license_name] = license_name
            parent = parent.parent
    if ENTRY not in copies:
        raise ValueError("Plauna public entry point is missing")
    snapshot.verify()
    return snapshot, graph, copies, authored


def _compiled_runtime(graph, root, version):
    # Use the canonical lexical import.meta transform, with a bundle-local base.
    # Host Engine globals and source strings/comments remain untouched.
    compiled_graph = copy.copy(graph)
    compiled_graph.modules = graph.modules.copy()
    for path, source in graph.modules.items():
        expression = f"(new URL({json.dumps(graph.mod_id(path))},__plaunaRoot).href)"
        rewritten, _ = emitter._transform_import_meta(source, expression, f"({{url:{expression}}})")
        compiled_graph.modules[path] = rewritten
    runtime = builder.build_bundle(compiled_graph, root, entry_ids=[ENTRY], eager=False)
    publication = "global.ParticleEngine = PE;\nglobal.PE = PE;"
    if runtime.count(publication) != 1:
        raise ValueError("Canonical bundler publication contract changed")
    runtime = runtime.replace(publication, "global.Plauna = __primary;")
    return (f"// Plauna {version['PLAUNA_FULL']} | MIT Plauna + Alpha Engine dependencies\n"
            "(function () {\n'use strict';\n"
            "const script = document.currentScript;\n"
            "if (!script || !script.src) throw new Error('Load dist/plauna.js as an external classic script');\n"
            "const __plaunaRoot = new URL('../', script.src).href;\n"
            + runtime + "\n})();\n").encode("utf-8")


def _destination(root, destination):
    absolute = Path(os.path.abspath(destination))
    for part in (absolute, *absolute.parents):
        if _is_link(part):
            raise ValueError(f"Linked export destination is forbidden: {part}")
    destination = absolute.resolve()
    if destination == root or destination.is_relative_to(root) or root.is_relative_to(destination):
        raise ValueError("Plauna export destination must be outside its source tree")
    if destination.exists() and (not destination.is_dir() or any(destination.iterdir())):
        raise ValueError("Plauna export destination must be a new or empty directory")
    return destination


def _verify_candidate_inputs(snapshot, authored, templates, media):
    snapshot.verify()
    if media:
        media.verify()
    if (_authored_files(snapshot.root, "plauna") != authored
            or _authored_files(snapshot.root, "bundler/plauna_templates") != templates):
        raise ValueError("Source inventory changed during Plauna export")


def export_plauna(root, destination, *, max_output_bytes=DEFAULT_MAX_BYTES, media_root=None):
    """Write one admitted, bounded candidate and return its verified manifest."""
    if type(max_output_bytes) is not int or max_output_bytes <= 0:
        raise ValueError("max_output_bytes must be a positive integer")
    root = Path(root).resolve(strict=True)
    destination = _destination(root, destination)
    media = _release_media(media_root, max_output_bytes) if media_root is not None else None
    LOG.info("Plauna export begin source=%s destination=%s limit=%d", root, destination, max_output_bytes)
    snapshot, graph, copies, authored = collect_sources(root, max_output_bytes)
    version = _version(snapshot)
    outputs = {target: snapshot.read(source) for target, source in copies.items()}
    outputs["LICENSE"] = LICENSE_SCOPE + snapshot.read("plauna/LICENSE")
    outputs["index.js"] = (f"// SPDX-FileCopyrightText: {COPYRIGHT}\n"
                           "// SPDX-License-Identifier: MIT\n"
                           "export * from './plauna/index.js';\n").encode("utf-8")
    outputs["dist/plauna.js"] = _compiled_runtime(graph, root, version)
    template_names = _authored_files(root, "bundler/plauna_templates")
    for relative in template_names:
        snapshot.read(relative)
    for filename in REBUILD_MODULES:
        relative = "bundler/" + filename
        outputs[relative] = snapshot.read(relative)
        copies[relative] = relative
    for relative in VALIDATION_FILES:
        outputs[relative] = snapshot.read(relative)
        copies[relative] = relative
    baseline = "bundler/cyclic_baseline.json"
    if baseline in snapshot.files:
        outputs[baseline] = snapshot.read(baseline)
        copies[baseline] = baseline
    # Templates remain authored inputs so a clean checkout can rebuild itself.
    for relative in template_names:
        outputs[relative] = snapshot.read(relative)
        copies[relative] = relative
    input_records = snapshot.records()
    source_digest = hashlib.sha256(_json_bytes(input_records)).hexdigest()
    replacements = {**version, "SOURCE_DIGEST": source_digest}
    for relative in template_names:
        target = relative.removeprefix("bundler/plauna_templates/")
        if target in outputs or target == "plauna-manifest.json":
            raise ValueError(f"Plauna template collides with runtime input: {target}")
        source = snapshot.read(relative).decode("utf-8", errors="strict")
        for name, value in replacements.items():
            source = source.replace("{{" + name + "}}", value)
        if target == "README.md":
            if media and source.count(MEDIA_MARKER) != 1:
                raise ValueError("Media publication needs exactly one README release-media marker")
            source = source.replace(MEDIA_MARKER, MEDIA_SECTION if media else "")
        if re.search(r"\{\{(?:PLAUNA_|SOURCE_DIGEST|BUILD_TAG)", source):
            raise ValueError(f"Unresolved release template value: {relative}")
        outputs[target] = source.encode("utf-8")
    if media:
        for name in MEDIA_NAMES:
            target = f"assets/{name}"
            if target in outputs:
                raise ValueError(f"Release media collides with authored asset: {target}")
            outputs[target] = media.files[name]
    manifest = {
        "format": FORMAT,
        "version": version["PLAUNA_VERSION"],
        "build_tag": version["BUILD_TAG"],
        "full_version": version["PLAUNA_FULL"],
        "entry": "index.js",
        "compiled_entry": "dist/plauna.js",
        "compiled_global": "Plauna",
        "source_snapshot_sha256": source_digest,
        "source_inputs": input_records,
        "output_sources": dict(sorted(copies.items())),
        "generated": ["LICENSE", "index.js", "dist/plauna.js", *[name.removeprefix("bundler/plauna_templates/") for name in template_names]],
        "release_media": media.records() if media else {},
        "licenses": {"plauna/": "MIT", "engine/": "LicenseRef-ParticleRealms-Alpha", "webgpu-os/": "LicenseRef-ParticleRealms-Alpha"},
        "files": {name: _record(data) for name, data in sorted(outputs.items())},
        "runtime_module_count": len(graph.modules),
        "validation_files": list(VALIDATION_FILES),
        "max_output_bytes": max_output_bytes,
    }
    manifest_data = _json_bytes(manifest)
    total = sum(map(len, outputs.values())) + len(manifest_data)
    if total > max_output_bytes:
        raise ValueError(f"Plauna output byte limit exceeded: {total} > {max_output_bytes}")
    _verify_candidate_inputs(snapshot, authored, template_names, media)
    destination.mkdir(parents=True, exist_ok=True)
    if any(destination.iterdir()):
        raise ValueError("Plauna output was populated by another writer")
    for relative, data in sorted(outputs.items()):
        target = _secure_path(destination, relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as stream:
            stream.write(data)
    _verify_candidate_inputs(snapshot, authored, template_names, media)
    with (destination / "plauna-manifest.json").open("xb") as stream:
        stream.write(manifest_data)
    verify_export(destination, max_output_bytes=max_output_bytes)
    LOG.info("Plauna export complete version=%s files=%d modules=%d bytes=%d", version["PLAUNA_FULL"], len(outputs) + 1, len(graph.modules), total)
    return manifest


def verify_export(destination, *, max_output_bytes=DEFAULT_MAX_BYTES):
    """Verify every output byte and reject unlisted files or path escapes."""
    destination = Path(destination).resolve(strict=True)
    if type(max_output_bytes) is not int or max_output_bytes <= 0:
        raise ValueError("max_output_bytes must be a positive integer")
    manifest = json.loads(safe_read_bytes(destination, "plauna-manifest.json", max_bytes=min(max_output_bytes, 16_000_000)))
    if not isinstance(manifest, dict) or manifest.get("format") != FORMAT:
        raise ValueError("Unknown Plauna manifest format")
    if type(manifest.get("max_output_bytes")) is not int or not 0 < manifest["max_output_bytes"] <= max_output_bytes:
        raise ValueError("Invalid Plauna manifest byte limit")
    files, inputs, sources = (manifest.get(name) for name in ("files", "source_inputs", "output_sources"))
    if not all(isinstance(item, dict) for item in (files, inputs, sources)):
        raise ValueError("Invalid Plauna manifest inventories")
    if hashlib.sha256(_json_bytes(inputs)).hexdigest() != manifest.get("source_snapshot_sha256"):
        raise ValueError("Invalid Plauna source snapshot digest")
    for target, source in sources.items():
        if target not in files or source not in inputs or files[target] != inputs[source]:
            raise ValueError(f"Plauna source/output identity mismatch: {target}")
    metadata = manifest.get("release_media")
    if not isinstance(metadata, dict) or (metadata and set(metadata) != set(MEDIA_NAMES)):
        raise ValueError("Invalid Plauna media inventory")
    for name, record in metadata.items():
        if files.get(f"assets/{name}") != record:
            raise ValueError(f"Plauna media/output identity mismatch: {name}")
    if manifest.get("validation_files") != list(VALIDATION_FILES) or not set(VALIDATION_FILES).issubset(files):
        raise ValueError("Plauna validation payload is incomplete")
    expected = set(files) | {"plauna-manifest.json"}
    actual = set()
    total = 0
    for directory, children, names in os.walk(destination, followlinks=False):
        if Path(directory) == destination and ".git" in children:
            git = destination / ".git"
            if _is_link(git) or _is_link(git / "HEAD") or not (git / "HEAD").is_file():
                raise ValueError("Invalid Git metadata directory in Plauna output")
            head = safe_read_bytes(git, "HEAD", max_bytes=1024).strip()
            if not re.fullmatch(rb"ref: refs/[^\x00-\x20]+|[a-f0-9]{40}|[a-f0-9]{64}", head):
                raise ValueError("Invalid Git HEAD in Plauna output")
            children.remove(".git")
        for name in children:
            if _is_link(Path(directory) / name):
                raise ValueError("Linked directory in Plauna output")
        for name in names:
            path = Path(directory) / name
            relative = path.relative_to(destination).as_posix()
            path = _secure_path(destination, relative)
            actual.add(relative)
            total += path.stat().st_size
            if total > manifest["max_output_bytes"]:
                raise ValueError("Plauna output exceeds its byte limit")
            if relative != "plauna-manifest.json":
                expected_record = files.get(relative)
                if not isinstance(expected_record, dict) or expected_record.get("bytes") != path.stat().st_size:
                    raise ValueError(f"Plauna output integrity mismatch: {relative}")
                if _record(safe_read_bytes(destination, relative, max_bytes=expected_record["bytes"])) != expected_record:
                    raise ValueError(f"Plauna output integrity mismatch: {relative}")
    if actual != expected:
        raise ValueError(f"Plauna output inventory mismatch: missing={sorted(expected - actual)[:10]}")
    version = _version(SourceSnapshot(destination, manifest["max_output_bytes"]))
    if (manifest.get("version"), manifest.get("build_tag"), manifest.get("full_version")) != (
            version["PLAUNA_VERSION"], version["BUILD_TAG"], version["PLAUNA_FULL"]):
        raise ValueError("Plauna release metadata disagrees with engine/version.js")
    readme = safe_read_bytes(destination, "README.md", max_bytes=manifest["max_output_bytes"]).decode("utf-8")
    if MEDIA_MARKER in readme or any((f"assets/{name}" in readme) != bool(metadata) for name in MEDIA_NAMES):
        raise ValueError("Plauna README/media inventory mismatch")
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--max-output-bytes", type=int, default=DEFAULT_MAX_BYTES)
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--media-root", type=Path, help="Verified screenshots and MP4 prepared for release")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
    try:
        manifest = (verify_export(args.output_root, max_output_bytes=args.max_output_bytes) if args.verify_only else
                    export_plauna(args.source_root, args.output_root, max_output_bytes=args.max_output_bytes, media_root=args.media_root))
    except (OSError, ValueError, UnicodeError) as error:
        LOG.error("Plauna export failed: %s", error)
        return 1
    print(json.dumps({"version": manifest["full_version"], "files": len(manifest["files"]) + 1,
                      "source_snapshot_sha256": manifest["source_snapshot_sha256"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
