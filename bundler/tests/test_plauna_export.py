# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Standalone Plauna packaging contracts, including integrity and race gates."""
import struct
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest import mock

from bundler import plauna


def write(root, name, data):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data.encode("utf-8") if isinstance(data, str) else data)
    return path


def fixture(root):
    write(root, "plauna/index.js", "export { answer } from '../engine/math.js';\n"
          "export { workerURL } from './render/Host.js';\n"
          "export { PLAUNA_VERSION, PLAUNA_FULL } from '../engine/version.js';\n")
    write(root, "plauna/render/Host.js", "export const workerURL = new URL('./Worker.js', import.meta.url).href;\n"
          "// new URL('./not-a-resource.js', import.meta.url)\n")
    write(root, "plauna/render/Worker.js", "import { value } from '../../engine/worker-support.js';\n"
          "globalThis.onmessage = () => postMessage(value);\n")
    write(root, "plauna/render/Secondary.js", "export { feature } from '../../engine/secondary.js';\n")
    write(root, "engine/math.js", "export const answer = 42;\n")
    write(root, "engine/worker-support.js", "export const value = 7;\n")
    write(root, "engine/secondary.js", "export const feature = 'retained';\n")
    write(root, "engine/unrelated.js", "export const unrelated = true;\n")
    write(root, "engine/version.js", "export const ENGINE_VERSION = '0.8.1';\n"
          "export const PLAUNA_VERSION = '0.3.0';\nexport const BUILD_TAG = 'alpha';\n"
          "export const PLAUNA_FULL = `v${PLAUNA_VERSION}-${BUILD_TAG}`;\n")
    write(root, "plauna/styles/plauna.css", "body { background-image: url('../images/tile.png'); }\n")
    write(root, "plauna/images/tile.png", b"\x89PNG\r\n\x1a\n")
    write(root, "plauna/themes/index.json", '{"themes":["test"]}')
    write(root, "plauna/themes/test/theme.json", '{"name":"test"}')
    write(root, "plauna/LICENSE", "MIT License\n")
    write(root, "LICENSES/LicenseRef-ParticleRealms-Alpha.txt", "Particle Realms Alpha\n")
    write(root, "NOTICE.md", "Engine dependencies retain Alpha terms.\n")
    write(root, "AUTHORS", "Jake Wehmeier\n")
    write(root, "bundler/plauna_templates/README.md", "# Plauna {{PLAUNA_FULL}}\n{{SOURCE_DIGEST}}\n<!-- plauna-release-media -->\n")
    for filename in plauna.REBUILD_MODULES:
        write(root, "bundler/" + filename, (Path(plauna.__file__).parent / filename).read_bytes())
    for filename in plauna.VALIDATION_FILES:
        write(root, filename, (Path(plauna.__file__).parent.parent / filename).read_bytes())


def media_fixture(root):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    pixel = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
             + chunk(b"IDAT", zlib.compress(b"\0\0\0\0")) + chunk(b"IEND", b""))
    for name in plauna.MEDIA_NAMES[:-1]:
        write(root, name, pixel)
    def box(kind, data):
        return struct.pack(">I4s", 8 + len(data), kind) + data
    movie = box(b"ftyp", b"isom\0\0\0\1isom") + box(b"moov", b"metadata") + box(b"mdat", b"samples")
    write(root, plauna.MEDIA_NAMES[-1], movie)


class PlaunaExportTests(unittest.TestCase):
    def test_complete_current_tree_workers_resources_and_narrow_engine_closure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, output = Path(temporary) / "source", Path(temporary) / "candidate"
            fixture(root)
            write(root, "plauna/__pycache__/ignored.pyc", b"disposable cache")
            result = plauna.export_plauna(root, output, max_output_bytes=5_000_000)
            self.assertEqual(result["full_version"], "v0.3.0-alpha")
            for name in ("engine/worker-support.js", "engine/secondary.js", "plauna/render/Secondary.js",
                         "plauna/render/Worker.js", "plauna/images/tile.png", "bundler/plauna.py"):
                self.assertEqual((output / name).read_bytes(), (root / name).read_bytes())
            self.assertFalse((output / "engine/unrelated.js").exists())
            self.assertFalse((output / "plauna/__pycache__").exists())
            self.assertTrue((output / "LICENSE").read_bytes().endswith((root / "plauna/LICENSE").read_bytes()))
            self.assertIn("LicenseRef-ParticleRealms-Alpha", (output / "LICENSE").read_text())
            self.assertEqual(result["release_media"], {})
            self.assertNotIn("showcase-overview.png", (output / "README.md").read_text())
            self.assertEqual(result, plauna.verify_export(output))
            self.assertEqual(len([name for name in result['validation_files']
                                  if name.startswith('tests/test_plauna_')]), 12)
            for name in ('tests/plauna-gpu-input.html', 'tests/plauna-gpu-input.js',
                         'tests/plauna-layout-parity.html', 'tests/plauna-layout-parity.test.js'):
                self.assertEqual(result['files'][name], result['source_inputs'][name])
            compiled = (output / "dist/plauna.js").read_text(encoding="utf-8")
            self.assertIn("global.Plauna = __primary;", compiled)
            self.assertNotIn("global.PE = PE;", compiled)
            self.assertNotIn("global.ParticleEngine = PE;", compiled)
            self.assertIn('new URL("plauna/render/Host.js",__plaunaRoot)', compiled)
            self.assertIn("v0.3.0-alpha", (output / "README.md").read_text(encoding="utf-8"))

    def test_changed_source_during_compilation_cannot_publish_a_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, output = Path(temporary) / "source", Path(temporary) / "candidate"
            fixture(root)
            original = plauna._compiled_runtime

            def mutate(graph, source_root, version):
                runtime = original(graph, source_root, version)
                write(root, "engine/math.js", "export const answer = 43;\n")
                return runtime

            with mock.patch.object(plauna, "_compiled_runtime", side_effect=mutate):
                with self.assertRaisesRegex(ValueError, "Source changed"):
                    plauna.export_plauna(root, output, max_output_bytes=5_000_000)
            self.assertFalse(output.exists())

    def test_missing_worker_dependency_fails_before_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, output = Path(temporary) / "source", Path(temporary) / "candidate"
            fixture(root)
            (root / "engine/worker-support.js").unlink()
            with self.assertRaisesRegex(ValueError, "Unresolved release import"):
                plauna.export_plauna(root, output, max_output_bytes=5_000_000)
            self.assertFalse(output.exists())

    def test_existing_destination_and_source_descendant_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, output = Path(temporary) / "source", Path(temporary) / "candidate"
            fixture(root)
            marker = write(output, "user.txt", "preserve")
            for destination in (output, root / "new-output", root.parent):
                with self.subTest(destination=destination):
                    with self.assertRaises(ValueError):
                        plauna.export_plauna(root, destination, max_output_bytes=5_000_000)
            self.assertEqual(marker.read_text(), "preserve")

    def test_resource_traversal_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, output = Path(temporary) / "source", Path(temporary) / "candidate"
            fixture(root)
            write(root, "plauna/render/Host.js", "export const url = new URL('../../../outside.js', import.meta.url);\n")
            write(root.parent, "outside.js", "export const value = 1;\n")
            with self.assertRaisesRegex(ValueError, "escapes source root"):
                plauna.export_plauna(root, output, max_output_bytes=5_000_000)

    def test_byte_limit_stops_before_destination_creation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, output = Path(temporary) / "source", Path(temporary) / "candidate"
            fixture(root)
            with self.assertRaisesRegex(ValueError, "byte limit exceeded"):
                plauna.export_plauna(root, output, max_output_bytes=100)
            self.assertFalse(output.exists())

    def test_deterministic_exports_and_tamper_or_extra_file_rejection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "source"
            fixture(root)
            first, second = Path(temporary) / "first", Path(temporary) / "second"
            left = plauna.export_plauna(root, first, max_output_bytes=5_000_000)
            right = plauna.export_plauna(root, second, max_output_bytes=5_000_000)
            self.assertEqual(left, right)
            write(first, ".git/HEAD", "ref: refs/heads/main\n")
            self.assertEqual(plauna.verify_export(first), left)
            write(first, "plauna/render/Secondary.js", "changed")
            with self.assertRaisesRegex(ValueError, "integrity mismatch"):
                plauna.verify_export(first)
            write(second, "unexpected.txt", "unlisted")
            with self.assertRaisesRegex(ValueError, "integrity mismatch"):
                plauna.verify_export(second)

    def test_qualified_media_is_pinned_and_embedded_only_when_supplied(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, media, output = (Path(temporary) / name for name in ("source", "media", "candidate"))
            fixture(root)
            media_fixture(media)
            result = plauna.export_plauna(root, output, max_output_bytes=5_000_000, media_root=media)
            readme = (output / "README.md").read_text(encoding="utf-8")
            self.assertNotIn(plauna.MEDIA_MARKER, readme)
            for name in plauna.MEDIA_NAMES:
                target = f"assets/{name}"
                self.assertIn(target, readme)
                self.assertEqual(result["files"][target], result["release_media"][name])
                self.assertEqual((output / target).read_bytes(), (media / name).read_bytes())

    def test_incomplete_or_invalid_release_media_fails_before_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, media, output = (Path(temporary) / name for name in ("source", "media", "candidate"))
            fixture(root)
            media_fixture(media)
            write(media, plauna.MEDIA_NAMES[-1], b"not an MP4")
            with self.assertRaisesRegex(ValueError, "MP4"):
                plauna.export_plauna(root, output, max_output_bytes=5_000_000, media_root=media)
            self.assertFalse(output.exists())
            media_fixture(media)
            write(media, plauna.MEDIA_NAMES[0], b"not a PNG")
            with self.assertRaisesRegex(ValueError, "PNG"):
                plauna.export_plauna(root, output, max_output_bytes=5_000_000, media_root=media)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
