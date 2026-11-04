# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Particle Engine runtime bundler (modular package).

The former monolithic bundle_engine.py now lives here, split into
cohesive submodules. Public entry point: bundler.cli.main.
"""

__all__ = ["main"]


def __getattr__(name):
    """Load the full platform CLI only when its public entry is requested.

    Narrow library exporters import graph/emitter modules without importing
    platform packaging, signing, native-build, and site-publication machinery.
    """
    if name == "main":
        from importlib.util import find_spec
        if find_spec(f"{__name__}.cli") is None:
            # The standalone Plauna distribution ships its own complete CLI.
            from .plauna import main
        else:
            from .cli import main
        return main
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
