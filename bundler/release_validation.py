# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Shared fail-closed release paths and JSON validation."""

import json
import math
from pathlib import Path, PurePosixPath
from .security_fs import safe_read_bytes


def _reject_non_json_constant(token):
    raise ValueError(f"non-JSON numeric token {token!r}")


def _parse_finite_json_float(token):
    value = float(token)
    if not math.isfinite(value):
        raise ValueError(f"JSON number {token!r} exceeds the finite runtime range")
    return value


def _reject_duplicate_json_members(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON object member {key!r}")
        result[key] = value
    return result


def _safe_release_relative_path(value, label):
    """Normalize one source/deployment path and reject traversal or drive syntax."""
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError(f"Invalid {label} path: {value!r}")
    path = PurePosixPath(value)
    if (
        path.is_absolute()
        or not path.parts
        or any(part in {"", ".", ".."} or ":" in part for part in path.parts)
    ):
        raise ValueError(f"Unsafe {label} path: {value!r}")
    return path


def _strict_json_file(path, label, *, read_bytes=None):
    path = Path(path)
    if read_bytes is None:
        read_bytes = lambda value: safe_read_bytes(value.parent, value.name, max_bytes=16_000_000)
    try:
        return json.loads(
            read_bytes(path),
            parse_constant=_reject_non_json_constant,
            parse_float=_parse_finite_json_float,
            object_pairs_hook=_reject_duplicate_json_members,
        )
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as error:
        raise ValueError(f"Invalid {label} JSON: {path}: {error}") from error


