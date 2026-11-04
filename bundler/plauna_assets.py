# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Plauna assets shared by standalone and platform distributions."""

from pathlib import Path
from .release_validation import _safe_release_relative_path, _strict_json_file


def plauna_runtime_asset_manifest(root, *, read_json=_strict_json_file):
    """Validate Plauna theme/widget assets without full-platform dependencies."""
    root = Path(root).resolve()
    copies = [("plauna/styles/plauna.css", "plauna/styles/plauna.css")]
    theme_index_path = root / "plauna" / "themes" / "index.json"
    theme_index = read_json(theme_index_path, "Plauna theme registry")
    theme_names = theme_index.get("themes") if isinstance(theme_index, dict) else None
    if (
        not isinstance(theme_names, list)
        or not theme_names
        or any(not isinstance(name, str) or not name for name in theme_names)
        or len(theme_names) != len(set(theme_names))
    ):
        raise ValueError("Plauna theme registry must contain a unique, non-empty themes list")
    for name in theme_names:
        normalized = _safe_release_relative_path(name, "Plauna theme name")
        if len(normalized.parts) != 1:
            raise ValueError(f"Plauna theme name must be one folder: {name!r}")
    discovered_themes = {
        path.parent.name
        for path in (root / "plauna" / "themes").glob("*/theme.json")
        if path.is_file()
    }
    if set(theme_names) != discovered_themes:
        raise ValueError(
            "Plauna theme registry/directory mismatch: "
            f"missing={sorted(set(theme_names) - discovered_themes)}, "
            f"unindexed={sorted(discovered_themes - set(theme_names))}"
        )
    copies.append(("plauna/themes/index.json", "plauna/themes/index.json"))
    copies.extend(
        (f"plauna/themes/{name}/theme.json", f"plauna/themes/{name}/theme.json")
        for name in theme_names
    )

    # Plauna widgets now style through CSS variables and appearance tones; the
    # plauna-modular.css index and per-widget stylesheets were removed. Any
    # widget stylesheet that does exist still ships beside its widget.
    widget_sources = sorted(
        path.relative_to(root).as_posix()
        for path in (root / "plauna" / "widgets").rglob("*.css")
        if path.is_file()
    )
    copies.extend((path, path) for path in widget_sources)

    for source_name, _ in copies:
        relative = _safe_release_relative_path(source_name, "Plauna asset")
        path = root.joinpath(*relative.parts)
        if not path.resolve().is_relative_to(root):
            raise ValueError(f"Plauna asset escapes source root: {source_name}")
        if not path.is_file():
            raise FileNotFoundError(f"Required Plauna asset is missing: {source_name}")
        if path.suffix.lower() == ".json":
            read_json(path, "Plauna asset")
    return tuple(sorted(set(copies)))


