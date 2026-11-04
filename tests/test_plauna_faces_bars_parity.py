# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""What the GPU painter draws in Chrome's place, DOM against GPU, at real
device scale factors (--force-device-scale-factor, no emulated viewport):

- z-index hoisting: paint order per CSS 2.1 Appendix E
- classic scrollbars (visible, headless): auto and thin, light and dark,
  scrollbar-color, hover and pressed parts, ::-webkit-scrollbar parts and
  their states, under CSS zoom (body zoom, the OS UI scale)
- native faces: checkbox, radio, range, progress, meter; every state, the
  dark scheme, accent-color, slider, progress and meter pseudo-elements
- native text fields: the theme's face only without author background or
  border declarations
- -webkit-text-fill-color (and decoration colours), image-rendering, holes
  (setHole)

Each case is rendered in a DOM page and a GPU page (the same markup mounted in
a RenderSurface on a bare page), put in its state with real input, and the
area round the element must match: no channel off by more than the case's
tolerance. Static cases of a group share one page per mode. Run with
PLAUNA_FACES_ONLY=<substring> to run some (PLAUNA_FACES_SKIP=<substring> to leave
some out); PLAUNA_FACES_SCALES=1,2 to pick
scales; PLAUNA_FACES_SHOW=1 to print every case's numbers;
PLAUNA_FACES_DIR=<dir> to save differing crops; PLAUNA_FACES_NOLOCK=1 to run
without the shared machine lock (scratch runs); PLAUNA_FACES_SWAP=<file> to paint
with another DisplayList.js (A/B).
"""

import io
import os
import sys
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path
from unittest import SkipTest, TestCase, main

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from plauna_browser_support import chrome_path, performance_run_lock, sdk_server  # noqa: E402

PAGE = "/__plauna_faces_bars__.html"
HTML = "<!doctype html><meta charset=utf-8><body></body>"
ALL = (1, 1.25, 1.5, 2)
TOLERANCE = 24
INNER = '<div style="width:600px;height:900px;background:#fde"></div>'
TALL = '<div style="width:10px;height:6000px"></div>'


def checker_png():
    """A 3x3 PNG of hard-edged colours (a data URL), built here so the test has no binary file."""
    import base64
    import struct
    import zlib
    rows = [[(255, 0, 0), (0, 255, 0), (0, 0, 255)],
            [(255, 255, 0), (0, 0, 0), (255, 255, 255)],
            [(255, 0, 255), (0, 255, 255), (128, 128, 128)]]
    raw = b"".join(b"\0" + bytes(c for px in row for c in px) for row in rows)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 3, 3, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    return "data:image/png;base64," + base64.b64encode(png).decode()


CHECKER = checker_png()


def scroller(style, inner=INNER):
    return f'<div id="t" style="width:200px;height:150px;overflow:scroll;{style}">{inner}</div>'


# A 12px custom bar for the part-state cases
CUSTOM_HOVER = "#t::-webkit-scrollbar{width:12px}#t::-webkit-scrollbar-thumb{background:#556}"


@dataclass(frozen=True)
class Case:
    name: str
    html: str
    css: str = ""
    # none | hover | active | key, at `at`: a CSS px point from the target's top left
    state: str = "none"
    at: tuple = None
    script: str = ""            # run after mounting, before the state (scroll, set a property)
    scales: tuple = ALL
    bars: bool = False          # classic scrollbars shown
    pad: int = 6
    tolerance: int = TOLERANCE
    # pixels past the tolerance a case may keep (a named cause): a number, or
    # ((scale, pixels), ...) for the most measured at each scale plus a margin
    allow: object = 0
    crop: tuple = None          # compare only this (x, y, w, h) from the target's top left, in CSS px
    worker: bool = False        # the GPU page paints on a worker
    zoom: float = 1             # CSS zoom on the body (the OS UI scale)


def allowance(case, scale):
    return dict(case.allow).get(scale, 0) if isinstance(case.allow, tuple) else case.allow


# z-index hoisting ──────────────────────────────────────────────────────────
ORDER = [
    Case("z popover over a later wrapper", '<div id="t"><div style="position:relative;width:200px;height:40px;background:#eee">'
         '<div style="position:absolute;top:30px;left:10px;width:120px;height:80px;background:#c33;z-index:10"></div></div>'
         '<div style="position:relative;width:200px;height:60px;background:#33c"></div></div>'),
    Case("z absolute child of a flex item", '<div id="t" style="display:flex"><div style="width:100px;height:40px;background:#eee">'
         '<div style="position:absolute;margin-top:20px;width:150px;height:60px;background:#c33"></div></div>'
         '<div style="width:100px;height:80px;background:#33c"></div></div>'),
    Case("z negative under a block", '<div id="t"><div style="position:relative"><div style="position:absolute;z-index:-1;left:20px;width:100px;height:50px;background:#c33"></div></div>'
         '<div style="height:30px;width:200px;background:rgba(0,0,255,.5)"></div><div style="height:40px"></div></div>'),
    Case("z absolute child of an inline-block", '<div id="t"><span style="display:inline-block;width:80px;height:30px;background:#eee">'
         '<span style="position:absolute;margin-top:10px;width:100px;height:40px;background:#c33"></span></span>'
         '<span style="display:inline-block;width:80px;height:50px;background:#33c"></span></div>'),
    Case("z stays in its stacking context", '<div id="t"><div style="position:relative;z-index:1"><div style="position:relative"><div style="position:absolute;z-index:50;top:10px;width:100px;height:60px;background:#c33"></div></div></div>'
         '<div style="position:relative;z-index:2;width:160px;height:50px;background:#33c"></div></div>'),
    Case("z tree order among z-auto", '<div id="t"><div style="position:relative"><div style="position:absolute;top:0;left:0;width:60px;height:60px;background:#c33"></div>'
         '<div style="position:relative;left:30px;top:30px;width:60px;height:60px;background:#3c3"></div></div>'
         '<div style="position:relative;top:-60px;left:15px;width:60px;height:60px;background:#33c"></div></div>'),
    Case("z hoisted through several wrappers", '<div id="t"><div style="position:relative"><div><div style="position:relative"><div style="position:absolute;z-index:3;width:120px;height:90px;background:#c33"></div></div></div></div>'
         '<div style="position:relative;z-index:2;width:90px;height:60px;background:#3c3"></div>'
         '<div style="position:relative;width:60px;height:60px;background:#33c"></div></div>'),
    # A z-auto wrapper's flex items stop being compositor layers (their animation is held at 0
    # ms): the wrapper, which left them to the context, paints them again (the Spinner's dots)
    Case("z wrapper paints children that stop being layers",
         '<div id="t" style="position:relative;width:64px;height:64px"><div style="display:flex;gap:4px;align-items:center;justify-content:center;width:100%;height:100%">'
         '<div class="d"></div><div class="d" style="animation-delay:.16s"></div><div class="d" style="animation-delay:.32s"></div></div></div>',
         css="@keyframes dotb{0%,80%,100%{transform:scale(0)}40%{transform:scale(1)}}"
             ".d{width:25%;height:25%;background:#36c;border-radius:50%;animation:dotb 1.4s ease-in-out infinite}",
         script="for (const a of document.getAnimations()) { a.playbackRate = 0; a.currentTime = 0; } window.__surface.invalidate(true);"),
]

# Scrollbars ────────────────────────────────────────────────────────────────
# scrollbar-color cases: the most measured at each scale plus 5 (the arrow glyph, see below)
BAR_COLOR_ALLOW = ((1, 34), (1.25, 40), (1.5, 31), (2, 37))
BARS = [
    Case("bars auto light", scroller(""), bars=True),
    Case("bars auto dark", scroller("color-scheme:dark"), bars=True),
    Case("bars thin light", scroller("scrollbar-width:thin"), bars=True),
    Case("bars thin dark", scroller("scrollbar-width:thin;color-scheme:dark"), bars=True),
    Case("bars scrolled", scroller(""), bars=True, script="t.scrollTop = 300; t.scrollLeft = 150;"),
    Case("bars scrolled to the ends", scroller(""), bars=True, script="t.scrollTop = 99999; t.scrollLeft = 99999;"),
    Case("bars vertical only", scroller("overflow-x:hidden"), bars=True),
    Case("bars horizontal only", scroller("overflow-y:hidden"), bars=True),
    Case("bars auto overflow", scroller("overflow:auto"), bars=True),
    Case("bars auto no overflow", scroller("overflow:auto", '<div style="height:20px"></div>'), bars=True),
    Case("bars scroll no overflow", scroller("", '<div style="height:20px"></div>'), bars=True),
    Case("bars border", scroller("border:3px solid #48c"), bars=True),
    Case("bars min thumb", scroller("overflow-x:hidden", TALL), bars=True),
    Case("bars thin min thumb", scroller("overflow-x:hidden;scrollbar-width:thin", TALL), bars=True),
    Case("bars short", '<div id="t" style="width:200px;height:30px;overflow:scroll">' + INNER + '</div>', bars=True),
    Case("bars very short", '<div id="t" style="width:30px;height:20px;overflow:scroll">' + INNER + '</div>', bars=True),
    Case("bars at a fraction", '<div id="t" style="position:relative;left:.4px;top:.3px;width:200.3px;height:150.6px;overflow:scroll">' + INNER + '</div>', bars=True),
    Case("bars rtl", scroller("direction:rtl"), bars=True),
    # Only the bars: right to left, the scrolled content itself lands elsewhere in GPU mode (a layout gap)
    Case("bars rtl scrolled at a fraction", '<div id="t" style="direction:rtl;width:200.4px;height:150.6px;overflow:scroll">' + INNER + '</div>', bars=True,
         script="t.scrollLeft = -150; t.scrollTop = 300;", crop=(16, 136, 184, 14), pad=0),
    Case("bars rtl scrolled at a fraction (vertical)", '<div id="t" style="direction:rtl;width:200.4px;height:150.6px;overflow:scroll">' + INNER + '</div>', bars=True,
         script="t.scrollLeft = -150; t.scrollTop = 300;", crop=(0, 0, 14, 135), pad=0),
    Case("bars rounded box", scroller("border-radius:14px;background:#eef"), bars=True),
    # The arrow glyph is sampled in Chrome and analytic here; saturated colours show it past the
    # tolerance: the most measured at each scale (15 to 59 pixels over these cases) plus 5
    Case("bars color", scroller("scrollbar-color:#c00 #0c0"), bars=True, allow=BAR_COLOR_ALLOW),
    Case("bars color translucent", scroller("scrollbar-color:rgba(200,0,0,.5) rgba(0,200,0,.5)"), bars=True),
    Case("bars color inherited", '<div style="scrollbar-color:#06c #fed">' + scroller("") + '</div>', bars=True, allow=((1, 34), (1.25, 64), (1.5, 35), (2, 42))),
    Case("bars thumb hover", scroller("overflow-x:hidden"), state="hover", at=(192, 30), bars=True),
    Case("bars thumb press", scroller("overflow-x:hidden"), state="active", at=(192, 30), bars=True),
    Case("bars track hover", scroller("overflow-x:hidden"), state="hover", at=(192, 100), bars=True),
    Case("bars arrow hover", scroller("overflow-x:hidden"), state="hover", at=(192, 142), bars=True),
    # Pressed, the arrow scrolls (its thumb moves in time): only the arrow is compared
    Case("bars arrow press", scroller("overflow-x:hidden"), state="active", at=(192, 142), bars=True, crop=(185, 132, 15, 18), pad=0),
    Case("bars disabled arrow hover", scroller("overflow-x:hidden"), state="hover", at=(192, 7), bars=True),
    Case("bars horizontal thumb hover", scroller("overflow-y:hidden"), state="hover", at=(30, 142), bars=True),
    # allow: at 1.5x Skia's scan of the arrow glyph's tip (dark) and of the thin thumb's round ends is
    # not symmetric, as no analytic coverage is; dark and hot inks show it past the tolerance (2 and 6 px)
    Case("bars dark thumb hover", scroller("overflow-x:hidden;color-scheme:dark"), state="hover", at=(192, 30), bars=True, allow=3),
    Case("bars thin thumb hover", scroller("overflow-x:hidden;scrollbar-width:thin"), state="hover", at=(195, 30), bars=True, allow=8),
    Case("bars color thumb hover", scroller("overflow-x:hidden;scrollbar-color:#c00 #0c0"), state="hover", at=(192, 30), bars=True, allow=((1, 20), (1.25, 20), (1.5, 29), (2, 37))),
    Case("bars color light thumb hover", scroller("overflow-x:hidden;scrollbar-color:#fff #000"), state="hover", at=(192, 30), bars=True, allow=((1, 25), (1.25, 22), (1.5, 44), (2, 35))),
    Case("bars color arrow hover", scroller("overflow-x:hidden;scrollbar-color:#808080 #fff"), state="hover", at=(192, 142), bars=True),
    # ::-webkit-scrollbar parts: each case its own page so one sheet's rules do not reach the next
    Case("bars custom", scroller("", INNER), css="#t::-webkit-scrollbar{width:10px;height:10px}#t::-webkit-scrollbar-track{background:#ddd}#t::-webkit-scrollbar-thumb{background:#778;border-radius:5px}#t::-webkit-scrollbar-corner{background:#fa0}", bars=True),
    Case("bars custom no corner rule", scroller("", INNER), css="#t::-webkit-scrollbar{width:10px;height:10px}#t::-webkit-scrollbar-thumb{background:#778}", bars=True),
    Case("bars custom thin clip", scroller("overflow-x:hidden", INNER), css="#t::-webkit-scrollbar{width:7px}#t::-webkit-scrollbar-thumb{background:#556;border-radius:999px;border:2px solid transparent;background-clip:content-box}#t::-webkit-scrollbar-track{background:transparent}", bars=True),
    Case("bars custom fractional width", scroller("overflow-x:hidden", INNER), css="#t::-webkit-scrollbar{width:7.5px}#t::-webkit-scrollbar-thumb{background:#556}", bars=True),
    Case("bars custom scrolled", scroller("", INNER), css="#t::-webkit-scrollbar{width:9px;height:9px}#t::-webkit-scrollbar-thumb{background:#556}#t::-webkit-scrollbar-track{background:#eee}", bars=True, script="t.scrollTop = 400; t.scrollLeft = 120;"),
    Case("bars custom hidden", scroller("", INNER), css="#t::-webkit-scrollbar{display:none}", bars=True),
    Case("bars custom thumb hover", scroller("overflow-x:hidden", INNER), css="#t::-webkit-scrollbar{width:12px}#t::-webkit-scrollbar-thumb{background:#556}#t::-webkit-scrollbar-thumb:hover{background:#e33}#t::-webkit-scrollbar-track{background:#eee}", state="hover", at=(194, 30), bars=True),
    Case("bars custom thumb press", scroller("overflow-x:hidden", INNER), css="#t::-webkit-scrollbar{width:12px}#t::-webkit-scrollbar-thumb{background:#556}#t::-webkit-scrollbar-thumb:active{background:#3a3}#t::-webkit-scrollbar-track{background:#eee}", state="active", at=(194, 30), bars=True),
    # A state reaches the bar from any of its parts, the track from a piece or the thumb, other parts
    # from themselves (SelectorChecker); the pointer finds pieces whether they are styled or not
    Case("bars custom track hover, pointer on the track", scroller("overflow-x:hidden", INNER), css=CUSTOM_HOVER + "#t::-webkit-scrollbar-track{background:#eee}#t::-webkit-scrollbar-track:hover{background:#e33}", state="hover", at=(194, 100), bars=True),
    Case("bars custom bar hover, pointer on the track", scroller("overflow-x:hidden", INNER), css="#t::-webkit-scrollbar{width:12px;background:#ccc}#t::-webkit-scrollbar:hover{background:#3a3}#t::-webkit-scrollbar-thumb{background:#556}", state="hover", at=(194, 100), bars=True),
    Case("bars custom piece hover, pointer on the track", scroller("overflow-x:hidden", INNER), css=CUSTOM_HOVER + "#t::-webkit-scrollbar-track-piece{background:#fc9}#t::-webkit-scrollbar-track-piece:hover{background:#e33}", state="hover", at=(194, 100), bars=True),
    Case("bars custom thumb hover rule, pointer on the track", scroller("overflow-x:hidden", INNER), css=CUSTOM_HOVER + "#t::-webkit-scrollbar-track{background:#eee}#t::-webkit-scrollbar-thumb:hover{background:#e33}", state="hover", at=(194, 100), bars=True),
    Case("bars custom piece hover, only the back piece", scroller("overflow-x:hidden", INNER), css=CUSTOM_HOVER + "#t::-webkit-scrollbar-track-piece{background:#fc9}#t::-webkit-scrollbar-track-piece:hover{background:#e33}", state="hover", at=(194, 20), bars=True, script="t.scrollTop = 400;"),
    Case("bars custom track hover, pointer on the thumb", scroller("overflow-x:hidden", INNER), css=CUSTOM_HOVER + "#t::-webkit-scrollbar-track{background:#eee}#t::-webkit-scrollbar-track:hover{background:#e33}", state="hover", at=(194, 5), bars=True),
    Case("bars custom track and bar hover, pointer on a button", scroller("overflow-x:hidden", INNER), css="#t::-webkit-scrollbar{width:12px;background:#ccc}#t::-webkit-scrollbar:hover{background:#3a3}#t::-webkit-scrollbar-thumb{background:#556}#t::-webkit-scrollbar-button{height:11px}#t::-webkit-scrollbar-track{background:#eee}#t::-webkit-scrollbar-track:hover{background:#e33}", state="hover", at=(194, 145), bars=True),
    Case("bars custom track and bar hover, pointer in a piece margin", scroller("overflow-x:hidden", INNER), css="#t::-webkit-scrollbar{width:12px;background:#ccc}#t::-webkit-scrollbar:hover{background:#3a3}#t::-webkit-scrollbar-thumb{background:#556}#t::-webkit-scrollbar-track-piece{margin:10px 0}#t::-webkit-scrollbar-track{background:#eee}#t::-webkit-scrollbar-track:hover{background:#e33}", state="hover", at=(194, 5), bars=True),
    Case("bars custom button hover on a bar that cannot scroll", scroller("overflow-x:hidden", '<div style="height:20px"></div>'), css="#t::-webkit-scrollbar{width:12px;background:#ccc}#t::-webkit-scrollbar:hover{background:#3a3}#t::-webkit-scrollbar-button{height:11px;background:#9cf}#t::-webkit-scrollbar-button:hover{background:#e33}", state="hover", at=(194, 145), bars=True),
    Case("bars custom track and bar active, pressing the thumb", scroller("overflow-x:hidden", INNER), css="#t::-webkit-scrollbar{width:12px;background:#ccc}#t::-webkit-scrollbar:active{background:#3a3}#t::-webkit-scrollbar-thumb{background:#556}#t::-webkit-scrollbar-track{background:#eee;margin:0 0 20px}#t::-webkit-scrollbar-track:active{background:#e33}", state="active", at=(194, 5), bars=True),
    Case("bars custom track pieces", scroller("overflow-x:hidden", INNER), css="#t::-webkit-scrollbar{width:12px}#t::-webkit-scrollbar-thumb{background:#556}#t::-webkit-scrollbar-track-piece{background:#fc9;margin:6px 0}", bars=True, script="t.scrollTop = 200;"),
    Case("bars custom buttons", scroller("overflow-x:hidden", INNER), css="#t::-webkit-scrollbar{width:12px}#t::-webkit-scrollbar-thumb{background:#556}#t::-webkit-scrollbar-button{background:#9cf;height:11px}#t::-webkit-scrollbar-track{background:#eee}", bars=True),
    # Part lengths and margins (LayoutCustomScrollbarPart): a thumb with no length is at least the native
    # one (17 px scaled, truncated); lengths truncate, margins round, percent margins are none
    Case("bars custom thumb least length", scroller("overflow-x:hidden", TALL), css="#t::-webkit-scrollbar{width:10px}#t::-webkit-scrollbar-thumb{background:#556}#t::-webkit-scrollbar-track{background:#eee}", bars=True),
    Case("bars custom thumb percent length", scroller("overflow-x:hidden", TALL), css="#t::-webkit-scrollbar{width:10px}#t::-webkit-scrollbar-thumb{background:#556;height:10%}#t::-webkit-scrollbar-track{background:#eee}", bars=True),
    Case("bars custom thumb height over max", scroller("overflow-x:hidden", TALL), css="#t::-webkit-scrollbar{width:10px}#t::-webkit-scrollbar-thumb{background:#556;height:40px;max-height:22.5px}#t::-webkit-scrollbar-track{background:#eee}", bars=True),
    Case("bars custom button auto length", scroller("overflow-x:hidden", INNER), css="#t::-webkit-scrollbar{width:12px}#t::-webkit-scrollbar-thumb{background:#556}#t::-webkit-scrollbar-button{background:#9cf}#t::-webkit-scrollbar-track{background:#9c9}", bars=True),
    Case("bars custom button min length", scroller("overflow-x:hidden", INNER), css="#t::-webkit-scrollbar{width:12px}#t::-webkit-scrollbar-thumb{background:#556}#t::-webkit-scrollbar-button{background:#9cf;height:7.5px;min-height:9px}#t::-webkit-scrollbar-track{background:#9c9}", bars=True),
    Case("bars custom track margin", scroller("overflow-x:hidden", INNER), css="#t::-webkit-scrollbar{width:12px}#t::-webkit-scrollbar-thumb{background:#556}#t::-webkit-scrollbar-track{background:#9c9;margin:5px 0}", bars=True),
    Case("bars custom track margin buttons", scroller("overflow-x:hidden", INNER), css="#t::-webkit-scrollbar{width:12px}#t::-webkit-scrollbar-thumb{background:#556}#t::-webkit-scrollbar-track{background:#9c9;margin:5px 0}#t::-webkit-scrollbar-button{background:#9cf;height:11px}", bars=True),
    Case("bars custom piece fractional margins", scroller("overflow-x:hidden", INNER), css="#t::-webkit-scrollbar{width:12px}#t::-webkit-scrollbar-thumb{background:#556}#t::-webkit-scrollbar-track-piece{background:#fc9;margin:2.6px 0 3.4px}", bars=True, script="t.scrollTop = 120;"),
    Case("bars custom piece percent margins", scroller("overflow-x:hidden", INNER), css="#t::-webkit-scrollbar{width:12px}#t::-webkit-scrollbar-thumb{background:#556}#t::-webkit-scrollbar-track-piece{background:#fc9;margin:10% 0}", bars=True),
    Case("bars custom horizontal parts", scroller("overflow-y:hidden", INNER), css="#t::-webkit-scrollbar{height:11px}#t::-webkit-scrollbar-thumb{background:#556;min-width:30px}#t::-webkit-scrollbar-track{background:#9c9;margin:0 3.5px}#t::-webkit-scrollbar-button{background:#9cf;width:9.5px}", bars=True, script="t.scrollLeft = 100;"),
    # allow 2: Skia's scan of a text field's unsmoothed corners is not symmetric at 1.5x and 2x
    Case("bars textarea", '<textarea id="t" style="width:160px;height:60px;font:13px Arial;caret-color:transparent">' + "line of text\n" * 12 + '</textarea>', bars=True, allow=2),
    Case("bars textarea scrolled", '<textarea id="t" style="width:160px;height:60px;font:13px Arial;resize:none;caret-color:transparent">' + "line of text\n" * 12 + '</textarea>', bars=True, script="t.scrollTop = 40;", allow=2),
]
# CSS zoom (the OS UI scale) does not size the native theme's bar parts (arrows, thumb width, least
# thumb, a textarea's bar and grip, a custom bar's auto button and least thumb); CSS lengths still
# zoom. Under zoom Chrome's arrow glyph sits up to 0.3 px higher than unzoomed (up to 23 levels on
# its edge pixels, inside the tolerance)
ZOOMED = [
    Case("zoom bars auto light", scroller(""), bars=True, zoom=1.25, scales=(1, 1.5)),
    Case("zoom bars thin light", scroller("scrollbar-width:thin"), bars=True, zoom=1.25, scales=(1, 1.5)),
    Case("zoom bars scrolled", scroller(""), bars=True, zoom=1.25, scales=(1, 1.5), script="t.scrollTop = 300; t.scrollLeft = 150;"),
    Case("zoom bars min thumb", scroller("overflow-x:hidden", TALL), bars=True, zoom=1.25, scales=(1, 1.5)),
    Case("zoom bars textarea", BARS[-2].html, bars=True, zoom=1.25, scales=(1, 1.5), allow=2),
    Case("zoom bars custom", scroller("", INNER), css="#t::-webkit-scrollbar{width:10px;height:10px}#t::-webkit-scrollbar-track{background:#ddd}#t::-webkit-scrollbar-thumb{background:#778;border-radius:5px}#t::-webkit-scrollbar-corner{background:#fa0}", bars=True, zoom=1.25, scales=(1, 1.5)),
    Case("zoom bars custom thumb least length", scroller("overflow-x:hidden", TALL), css="#t::-webkit-scrollbar{width:10px}#t::-webkit-scrollbar-thumb{background:#556}#t::-webkit-scrollbar-track{background:#eee}", bars=True, zoom=1.25, scales=(1, 1.5)),
    Case("zoom bars custom button auto length", scroller("overflow-x:hidden", INNER), css="#t::-webkit-scrollbar{width:12px}#t::-webkit-scrollbar-thumb{background:#556}#t::-webkit-scrollbar-button{background:#9cf}#t::-webkit-scrollbar-track{background:#9c9}", bars=True, zoom=1.25, scales=(1, 1.5)),
    Case("zoom textarea grip", '<textarea id="t" style="font:13px Arial;caret-color:transparent">Text</textarea>', zoom=1.25, scales=(1, 1.5)),
    Case("zoom checkbox checked", '<input id="t" type="checkbox" checked>', zoom=1.25, scales=(1, 1.5)),
]

# Native faces ──────────────────────────────────────────────────────────────
FACES = []
for scheme, label in (("", ""), ("color-scheme:dark;", " dark")):
    for name, html in (
        ("checkbox", '<input id="t" type="checkbox" style="%s">'),
        ("checkbox checked", '<input id="t" type="checkbox" checked style="%s">'),
        ("radio", '<input id="t" type="radio" style="%s">'),
        ("radio checked", '<input id="t" type="radio" checked style="%s">'),
        ("range", '<input id="t" type="range" style="%s">'),
        ("range at a quarter", '<input id="t" type="range" value="25" style="%s">'),
    ):
        FACES.append(Case(f"{name}{label}", html % scheme))
        FACES.append(Case(f"{name}{label} hover", html % scheme, state="hover"))
        FACES.append(Case(f"{name}{label} press", html % scheme, state="active"))
        FACES.append(Case(f"{name}{label} disabled", html.replace('id="t"', 'id="t" disabled') % scheme))
    FACES.append(Case(f"checkbox indeterminate{label}", '<input id="t" type="checkbox" style="%s">' % scheme, script="t.indeterminate = true;"))
    FACES.append(Case(f"checkbox indeterminate{label} disabled", '<input id="t" type="checkbox" disabled style="%s">' % scheme, script="t.indeterminate = true;"))
    FACES.append(Case(f"progress{label}", '<progress id="t" value=".4" style="%s"></progress>' % scheme))
    FACES.append(Case(f"progress zero{label}", '<progress id="t" value="0" style="%s"></progress>' % scheme))
    FACES.append(Case(f"progress full{label}", '<progress id="t" value="1" style="%s"></progress>' % scheme))
    FACES.append(Case(f"progress{label} hover", '<progress id="t" value=".4" style="%s"></progress>' % scheme, state="hover"))
    FACES.append(Case(f"meter{label}", '<meter id="t" value=".4" style="%s"></meter>' % scheme))
    FACES.append(Case(f"meter suboptimum{label}", '<meter id="t" value=".5" low=".6" high=".8" optimum=".9" style="%s"></meter>' % scheme))
    FACES.append(Case(f"meter even less good{label}", '<meter id="t" value=".2" low=".6" high=".8" optimum=".9" style="%s"></meter>' % scheme))
# Keyboard focus: the focus ring with the theme's radius round each face
for scheme, label in (("", ""), ("color-scheme:dark;", " dark")):
    for name, html in (
        ("checkbox", '<input id="t" type="checkbox" style="%s">'),
        ("checkbox checked", '<input id="t" type="checkbox" checked style="%s">'),
        ("radio", '<input id="t" type="radio" style="%s">'),
        ("radio checked", '<input id="t" type="radio" checked style="%s">'),
        ("range", '<input id="t" type="range" value="30" style="%s">'),
    ):
        FACES.append(Case(f"{name}{label} focus", html % scheme, state="key", pad=8))
FACES += [
    Case("checkbox large focus", '<input id="t" type="checkbox" checked style="width:24px;height:24px">', state="key", pad=8),
    Case("radio large focus", '<input id="t" type="radio" checked style="width:24px;height:24px">', state="key", pad=8),
    Case("checkbox accent focus", '<input id="t" type="checkbox" checked style="accent-color:#5b7cff">', state="key", pad=8),
    Case("range track hover beside the thumb", '<input id="t" type="range">', state="hover", at=(100, 8)),
    Case("range sized", '<input id="t" type="range" style="width:300px;height:40px">'),
    Case("range short", '<input id="t" type="range" style="width:90px;height:10px">'),
    Case("range rtl", '<input id="t" type="range" value="20" style="direction:rtl">'),
    Case("range at a fraction", '<input id="t" type="range" value="33" style="position:relative;left:.4px;top:.3px">'),
    Case("checkbox sized", '<input id="t" type="checkbox" checked style="width:30px;height:20px">'),
    Case("checkbox large", '<input id="t" type="checkbox" checked style="width:24px;height:24px">'),
    Case("radio large", '<input id="t" type="radio" checked style="width:24px;height:24px">'),
    Case("checkbox at a fraction", '<input id="t" type="checkbox" checked style="position:relative;left:.4px;top:.3px">'),
    Case("checkbox author background", '<input id="t" type="checkbox" style="background:#f00;border:3px solid #0f0">'),
    Case("progress sized", '<progress id="t" value=".3" style="width:240px;height:30px"></progress>'),
    Case("progress thin", '<progress id="t" value=".6" style="width:100px;height:6px"></progress>'),
    Case("progress small value", '<progress id="t" value=".001" style="width:100px"></progress>'),
    Case("progress rtl", '<progress id="t" value=".3" style="direction:rtl"></progress>'),
    Case("meter sized", '<meter id="t" value=".3" style="width:240px;height:30px"></meter>'),
    Case("meter rtl", '<meter id="t" value=".3" style="direction:rtl"></meter>'),
    # Unthemed parts
    Case("range unthemed", '<input id="t" type="range" style="appearance:none;height:6px;background:#ccd;width:200px">'),
    # allow: a small blurred circle's shadow differs on any box (GAP 13's blurred shadows), not only on
    # a thumb: the most measured at each scale (16 to 44 pixels) plus 5
    Case("slider thumb and track", '<input id="t" type="range" value="30">',
         css="#t{appearance:none;width:200px;background:transparent;height:20px}#t::-webkit-slider-runnable-track{height:6px;background:#9ab;border-radius:3px}#t::-webkit-slider-thumb{appearance:none;width:14px;height:14px;margin-top:-4px;background:#c33;border:2px solid #fff;border-radius:50%;box-shadow:0 0 2px #000}",
         allow=((1, 49), (1.25, 35), (1.5, 39), (2, 21))),
    Case("slider thumb only (SDK look)", '<input id="t" type="range" value="60">',
         css="#t{appearance:none;width:200px;height:5px;border-radius:999px;background:#556}#t::-webkit-slider-thumb{appearance:none;width:16px;height:16px;border-radius:50%;background:#58f;border:2px solid #fff}"),
    Case("slider thumb hover rule", '<input id="t" type="range" value="50">',
         css="#t{appearance:none;width:200px;height:20px;background:#eee}#t::-webkit-slider-thumb{appearance:none;width:16px;height:16px;background:#58f}#t::-webkit-slider-thumb:hover{background:#e33}", state="hover"),
    Case("slider thumb active rule", '<input id="t" type="range" value="50">',
         css="#t{appearance:none;width:200px;height:20px;background:#eee}#t::-webkit-slider-thumb{appearance:none;width:16px;height:16px;background:#58f}#t::-webkit-slider-thumb:active{background:#3a3}", state="active"),
    Case("slider custom thumb on a themed track", '<input id="t" type="range" value="50">',
         css="#t::-webkit-slider-thumb{appearance:none;width:8px;height:16px;background:#c33}"),
    Case("progress unthemed defaults", '<progress id="t" value=".4" style="appearance:none"></progress>'),
    Case("progress parts", '<progress id="t" value=".4"></progress>',
         css="#t{appearance:none;width:200px;height:10px;border:0}#t::-webkit-progress-bar{background:#ddd;border-radius:5px}#t::-webkit-progress-value{background:#3a3;border-radius:5px}"),
    Case("meter unthemed defaults", '<meter id="t" value=".4" style="appearance:none"></meter>'),
    Case("meter parts", '<meter id="t" value=".4"></meter>',
         css="#t{appearance:none;width:200px;height:12px}#t::-webkit-meter-bar{background:#ddd;border-radius:6px}#t::-webkit-meter-optimum-value{background:#3a3;border-radius:6px}"),
]
for accent in ("#ff0000", "#00ff00", "#0000ff", "#000000", "#ffffff", "#5b7cff", "#808080", "#401010", "rgba(255,0,0,.5)"):
    for scheme, label in (("", ""), ("color-scheme:dark;", " dark")):
        for name, html in (
            ("checkbox", '<input id="t" type="checkbox" checked style="%s">'),
            ("radio", '<input id="t" type="radio" checked style="%s">'),
            ("range", '<input id="t" type="range" style="%s">'),
            ("progress", '<progress id="t" value=".5" style="%s"></progress>'),
        ):
            style = f"{scheme}accent-color:{accent}"
            FACES.append(Case(f"{name} accent {accent}{label}", html % style, scales=(1, 2) if accent in ("#5b7cff",) else (1,)))
            if accent in ("#5b7cff", "#00ff00", "rgba(255,0,0,.5)") and not scheme:
                FACES.append(Case(f"{name} accent {accent} hover", html % style, state="hover", scales=(1,)))
                FACES.append(Case(f"{name} accent {accent} press", html % style, state="active", scales=(1,)))
FACES += [
    Case("checkbox accent unchecked", '<input id="t" type="checkbox" style="accent-color:#0f0">', scales=(1,)),
    Case("checkbox accent disabled", '<input id="t" type="checkbox" checked disabled style="accent-color:#f00">', scales=(1,)),
]

# Text fill, image-rendering, holes ─────────────────────────────────────────
OTHER = [
    Case("text fill", '<div id="t" style="font:20px Arial;color:#c00;-webkit-text-fill-color:#06c">Fill colour text</div>'),
    Case("text fill transparent", '<div id="t" style="font:20px Arial;color:#c00;-webkit-text-fill-color:transparent;text-shadow:1px 1px 0 #0a0">Only shadows show</div>'),
    # 1x only: a line's own thickness and place at other scales are not this case's (Plauna's decoration gap)
    Case("text fill underline", '<div id="t" style="font:10px Arial;color:#c00;-webkit-text-fill-color:#06c;text-decoration:underline">The line takes the fill</div>', scales=(1,)),
    # A line of its own colour keeps it, even one equal to color (computed style cannot tell: the
    # page's declarations decide), or one under a transparent fill. Words without descenders: Chrome
    # skips ink under them (text-decoration-skip-ink), which Plauna does not model
    Case("text fill underline explicit colour", '<div id="t" style="font:10px Arial;color:#c00;-webkit-text-fill-color:#06c;text-decoration:underline #c00">The line holds its colour</div>', scales=(1,)),
    Case("text fill underline longhand colour", '<div id="t" style="font:10px Arial;color:#c00;-webkit-text-fill-color:#06c;text-decoration-line:underline;text-decoration-color:#c00">The line holds its colour</div>', scales=(1,)),
    Case("text fill underline var colour", '<div id="t" style="font:10px Arial;color:#c00;-webkit-text-fill-color:#06c;--c:#c00;text-decoration:underline var(--c)">The line holds its colour</div>', scales=(1,)),
    Case("text fill underline var currentcolor", '<div id="t" style="font:10px Arial;color:#c00;-webkit-text-fill-color:#06c;--c:currentcolor;text-decoration:underline var(--c)">The line takes the fill</div>', scales=(1,)),
    Case("text fill underline explicit colour from a rule", '<div id="t" class="u" style="font:10px Arial;color:#c00;-webkit-text-fill-color:#06c">The line holds its colour</div>', css=".u{text-decoration:underline #c00}", scales=(1,)),
    Case("text fill transparent explicit underline", '<div id="t" style="font:10px Arial;color:#c00;-webkit-text-fill-color:transparent;text-decoration:underline #0a0">Line under a clear fill</div>', scales=(1,)),
    Case("text fill input", '<input id="t" value="Filled value" style="font:16px Arial;color:#c00;-webkit-text-fill-color:#06c;caret-color:transparent">'),
    Case("text fill textarea over code", '<div id="t" style="position:relative;width:240px;height:50px"><pre style="position:absolute;inset:0;margin:0;padding:4px;font:14px monospace;color:#07c;white-space:pre-wrap">const a = 1;</pre>'
         '<textarea style="position:absolute;inset:0;margin:0;padding:4px;border:0;font:14px monospace;background:transparent;color:#333;-webkit-text-fill-color:transparent;resize:none;caret-color:transparent;outline:none">const a = 1;</textarea></div>'),
    Case("image pixelated up", f'<img id="t" src="{CHECKER}" style="width:90px;height:90px;image-rendering:pixelated">'),
    Case("image crisp-edges up", f'<img id="t" src="{CHECKER}" style="width:90px;height:90px;image-rendering:crisp-edges">'),
    Case("image pixelated fractional", f'<img id="t" src="{CHECKER}" style="width:47.3px;height:61.7px;image-rendering:pixelated">'),
    Case("image pixelated down", f'<img id="t" src="{CHECKER}" style="width:2px;height:2px;image-rendering:pixelated">'),
    Case("image pixelated contain", f'<img id="t" src="{CHECKER}" style="width:90px;height:50px;object-fit:contain;image-rendering:pixelated">'),
    Case("image pixelated cover", f'<img id="t" src="{CHECKER}" style="width:90px;height:50px;object-fit:cover;image-rendering:pixelated">'),
    Case("image pixelated rounded", f'<img id="t" src="{CHECKER}" style="width:90px;height:90px;border-radius:20px;image-rendering:pixelated">', tolerance=40),
    Case("image smooth", f'<img id="t" src="{CHECKER}" style="width:90px;height:90px;image-rendering:auto">', tolerance=40),
    Case("background pixelated", f'<div id="t" style="width:90px;height:90px;background:url({CHECKER}) 0 0/90px 90px no-repeat;image-rendering:pixelated"></div>'),
    # Sizes no pixel centre ties at: on a tie the browser's choice is float noise (a residual)
    Case("background pixelated tiled", f'<div id="t" style="width:95px;height:65px;background:url({CHECKER}) 0 0/28px 28px;image-rendering:pixelated"></div>'),
    Case("background pixelated tiled fractional", f'<div id="t" style="width:95px;height:65px;background:url({CHECKER}) 0 0/31px 31px;image-rendering:pixelated"></div>', scales=(1, 1.25, 2)),
    Case("background pixelated inherited", f'<div style="image-rendering:pixelated"><div id="t" style="width:60px;height:60px;background:url({CHECKER}) 0 0/60px 60px no-repeat"></div></div>'),
]
# Native text fields ────────────────────────────────────────────────────────
FIELD = '<input id="t" value="Text" style="font:13px Arial;caret-color:transparent;%s">'
FIELDS = [
    Case("field plain", '<input id="t" value="Text" style="font:13px Arial;caret-color:transparent">'),
    Case("field hover", '<input id="t" value="Text" style="font:13px Arial;caret-color:transparent">', state="hover"),
    Case("field disabled", '<input id="t" value="Text" disabled style="font:13px Arial">'),
    Case("field dark", '<input id="t" value="Text" style="font:13px Arial;color-scheme:dark;caret-color:transparent">'),
    Case("field dark hover", '<input id="t" value="Text" style="font:13px Arial;color-scheme:dark;caret-color:transparent">', state="hover"),
    Case("field dark disabled", '<input id="t" value="Text" disabled style="font:13px Arial;color-scheme:dark">'),
    Case("field author border keeps CSS", '<input id="t" value="Text" style="font:13px Arial;border:2px solid #c33;caret-color:transparent">'),
    Case("field author background keeps CSS", '<input id="t" value="Text" style="font:13px Arial;background:#cde;caret-color:transparent">'),
    Case("field textarea", '<textarea id="t" style="font:13px Arial;resize:none;caret-color:transparent">Text</textarea>'),
    Case("field textarea hover", '<textarea id="t" style="font:13px Arial;resize:none;caret-color:transparent">Text</textarea>', state="hover"),
    # Any author background or border declaration gives CSS's face, even the UA's own values
    # (HasAuthorBackground / HasAuthorBorder, measured): not background-repeat, not `revert`
    Case("field author white background", FIELD % "background:#fff"),
    Case("field author white background from a class", FIELD % "", css="#t{background-color:white}"),
    Case("field author dark background equal to the UA's", FIELD % "color-scheme:dark;background:#3b3b3b"),
    Case("field author border equal to the UA's", FIELD % "border:2px inset #767676"),
    Case("field author radius equal to the UA's", FIELD % "border-radius:0"),
    Case("field author background through var()", FIELD % "--x:white;background-color:var(--x)"),
    Case("field textarea author white background", '<textarea id="t" style="font:13px Arial;resize:none;caret-color:transparent;background:#fff">Text</textarea>'),
    Case("field author background-repeat stays native", FIELD % "background-repeat:repeat"),
    Case("field author background revert stays native", FIELD % "background:revert"),
    Case("field author rule reverted stays native", '<input id="t" class="rv" value="Text" style="font:13px Arial;caret-color:transparent">', css=".rv{background-color:red}#t.rv{background-color:revert}"),
]
# The same paint on a worker-painted surface
WORKER = [
    Case("worker bars", scroller(""), bars=True, worker=True),
    Case("worker bars color", scroller("scrollbar-color:#c00 #0c0"), bars=True, worker=True, allow=BAR_COLOR_ALLOW),
    Case("worker bars custom", scroller("", INNER), css="#t::-webkit-scrollbar{width:10px;height:10px}#t::-webkit-scrollbar-track{background:#ddd}#t::-webkit-scrollbar-thumb{background:#778;border-radius:5px}", bars=True, worker=True),
    Case("worker checkbox checked", '<input id="t" type="checkbox" checked>', worker=True),
    Case("worker radio checked", '<input id="t" type="radio" checked>', worker=True),
    Case("worker range", '<input id="t" type="range" value="30">', worker=True),
    Case("worker progress", '<progress id="t" value=".4"></progress>', worker=True),
    Case("worker meter", '<meter id="t" value=".4"></meter>', worker=True),
    Case("worker field", '<input id="t" value="Text" style="font:13px Arial;caret-color:transparent">', worker=True),
    Case("worker image pixelated", f'<img id="t" src="{CHECKER}" style="width:90px;height:90px;image-rendering:pixelated">', worker=True),
    Case("worker z popover", ORDER[0].html, worker=True),
    Case("worker bars thumb hover", scroller("overflow-x:hidden"), state="hover", at=(192, 30), bars=True, worker=True),
    Case("worker range thumb hover", '<input id="t" type="range" value="30">', state="hover", at=(38, 8), worker=True),
    Case("worker radio focus", '<input id="t" type="radio" checked>', state="key", pad=8, worker=True),
]
ALL_CASES = ORDER + BARS + ZOOMED + FACES + OTHER + FIELDS + WORKER

MOUNT = r"""async ([mode, html, css, worker, zoom]) => {
    const { RenderSurface } = await import('/plauna/render/RenderSurface.js');
    document.body.style.cssText = 'margin:0;background:#fff' + (zoom && zoom !== 1 ? `;zoom:${zoom}` : '');
    if (css) { const s = document.createElement('style'); s.textContent = css; document.head.append(s); }
    document.body.innerHTML = '<div id="stage" style="position:relative;width:480px;padding:20px"></div>';
    const surface = new RenderSurface({ mode, worker: Boolean(worker) });
    document.getElementById('stage').append(surface.element);
    await surface.ready;
    const host = surface.mount(document.createElement('div'));
    host.style.padding = '10px';
    host.innerHTML = html;
    window.__surface = surface;
    window.t = document.getElementById('t');
    await new Promise((r) => setTimeout(r, 150));
    return surface.activeMode;
}"""
# A well: the page shows through the hole. The oracle is a DOM page where the
# well's own background is the page's colour, as seen through the hole.
HOLE_HTML = ('<div id="t" style="position:relative;width:220px;height:130px;background:#fff">'
             '<div id="well" style="position:absolute;left:20px;top:20px;width:110px;height:70px;border-radius:14px;box-sizing:border-box;%s"></div>'
             '<div style="position:absolute;left:70px;top:50px;width:90px;height:50px;background:#36c"></div></div>')
HOLE_CASES = [
    ("hole border box", "background:#c33", {"box": "border-box"}, "background:#0c0"),
    ("hole padding box", "background:#c33;border:6px solid #fa0", {"box": "padding-box"}, "background:#0c0;border:6px solid #fa0"),
    ("hole content box", "background:#c33;border:4px solid #fa0;padding:6px", {"box": "content-box"},
     "background:linear-gradient(#0c0,#0c0) content-box,#c33;border:4px solid #fa0;padding:6px"),
]
RECT = "() => { const r = document.getElementById('t').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }"
SETTLE = "async () => { for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r)); return true; }"


class PlaunaFacesBarsParityTests(TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from playwright.sync_api import sync_playwright
            import numpy  # noqa: F401
            from PIL import Image  # noqa: F401
            executable = chrome_path()
        except (ImportError, ValueError) as error:
            raise SkipTest(str(error)) from error
        only = os.environ.get("PLAUNA_FACES_ONLY")
        skip = os.environ.get("PLAUNA_FACES_SKIP")
        cls.cases = [case for case in ALL_CASES if (not only or any(part in case.name for part in only.split("|")))
                     and not (skip and any(part in case.name for part in skip.split("|")))]
        chosen = os.environ.get("PLAUNA_FACES_SCALES")
        cls.scales = [float(v) for v in chosen.split(",")] if chosen else list(ALL)
        cls.resources = ExitStack()
        try:
            if not os.environ.get("PLAUNA_FACES_NOLOCK"):
                cls.resources.enter_context(performance_run_lock(ROOT))
            cls.origin, _ = cls.resources.enter_context(sdk_server(ROOT))
            cls.playwright = sync_playwright().start()
            cls.resources.callback(cls.playwright.stop)
            cls.browsers = {}
            for scale in cls.scales:
                for bars in (False, True):
                    args = ["--enable-unsafe-webgpu", "--disable-lcd-text", "--force-color-profile=srgb",
                            f"--force-device-scale-factor={scale}", "--window-size=560,420"]
                    browser = cls.playwright.chromium.launch(
                        executable_path=executable, headless=True, args=args,
                        ignore_default_args=["--hide-scrollbars"] if bars else None)
                    cls.resources.callback(browser.close)
                    cls.browsers[scale, bars] = browser
        except BaseException:
            cls.resources.close()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.resources.close()

    gpu_seen = False

    def shoot(self, scale, mode, case, retried=False):
        import numpy as np
        from PIL import Image
        context = self.browsers[scale, case.bars].new_context(no_viewport=True, service_workers="block")
        try:
            context.route(f"{self.origin}{PAGE}", lambda route: route.fulfill(body=HTML, content_type="text/html"))
            # A/B: PLAUNA_FACES_SWAP=<a DisplayList.js> paints with that file instead
            swap = os.environ.get("PLAUNA_FACES_SWAP")
            if swap:
                context.route(f"{self.origin}/plauna/render/gpu/DisplayList.js", lambda route: route.fulfill(path=swap, content_type="text/javascript"))
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(f"{self.origin}{PAGE}")
            active = page.evaluate(MOUNT, [mode, case.html, case.css, case.worker, case.zoom])
            if mode == "gpu" and active != "gpu":
                # Once this run has seen GPU mode, falling back is a failure to show, not a reason to skip
                if not retried and type(self).gpu_seen:
                    return self.shoot(scale, mode, case, retried=True)
                if type(self).gpu_seen:
                    self.fail(f"{case.name}: GPU mode fell back to {active}")
                raise SkipTest("WebGPU is not available in this Chrome")
            if mode == "gpu":
                type(self).gpu_seen = True
            if case.script:
                page.evaluate(f"() => {{ {case.script} }}")
                page.evaluate(SETTLE)
            x, y, w, h = page.evaluate(RECT)
            if case.state == "key":
                # Keyboard focus (:focus-visible): the target is the scene's first focusable element
                page.keyboard.press("Tab")
                page.evaluate(SETTLE)
                self.assertTrue(page.evaluate("() => document.activeElement === t"), f"{case.name} {mode}: Tab did not focus the target")
            if case.state in ("hover", "active"):
                # `at` is in the target's own CSS px: zoomed with it
                px, py = (case.at[0] * case.zoom, case.at[1] * case.zoom) if case.at else (w / 2, h / 2)
                page.mouse.move(x + px, y + py)
                page.evaluate(SETTLE)
                if case.state == "active":
                    page.mouse.down()
                    page.wait_for_timeout(60)
            page.evaluate(SETTLE)
            page.wait_for_timeout(120)
            shot = page.screenshot()
            if case.state == "active":
                page.mouse.up()
            image = np.asarray(Image.open(io.BytesIO(shot)).convert("RGB"), dtype=np.int16)
            self.assertEqual(errors, [], f"{case.name} {mode}")
            return image, (x, y, w, h)
        finally:
            context.close()

    def test_matches_chrome(self):
        import numpy as np
        from PIL import Image
        failures = []
        show = bool(os.environ.get("PLAUNA_FACES_SHOW"))
        out = os.environ.get("PLAUNA_FACES_DIR")
        for scale in self.scales:
            for case in self.cases:
                if scale not in case.scales:
                    continue
                dom, rect = self.shoot(scale, "dom", case)
                gpu, _ = self.shoot(scale, "gpu", case)
                x, y, w, h = rect
                if case.crop:
                    z = case.zoom
                    x, y, w, h = x + case.crop[0] * z, y + case.crop[1] * z, case.crop[2] * z, case.crop[3] * z
                x0, y0 = max(0, int((x - case.pad) * scale)), max(0, int((y - case.pad) * scale))
                x1, y1 = int((x + w + case.pad) * scale) + 1, int((y + h + case.pad) * scale) + 1
                a = dom[y0:y1, x0:x1]
                b = gpu[y0:y1, x0:x1]
                diff = np.abs(a - b).max(axis=2)
                off = int((diff > case.tolerance).sum())
                if show:
                    print(f"{scale:g}x {case.name}: max {int(diff.max())} over-tol {off} over-8 {int((diff > 8).sum())}", flush=True)
                if off > allowance(case, scale):
                    failures.append(f"{scale:g}x {case.name}: {off} pixels differ (max {int(diff.max())})")
                if out and int((diff > 8).sum()):
                    Path(out).mkdir(parents=True, exist_ok=True)
                    stem = f"{case.name.replace(' ', '_').replace('#', '').replace(',', '').replace('(', '').replace(')', '').replace('.', '_')}-{scale:g}"
                    Image.fromarray(np.clip(a, 0, 255).astype("uint8")).save(Path(out) / f"{stem}-dom.png")
                    Image.fromarray(np.clip(b, 0, 255).astype("uint8")).save(Path(out) / f"{stem}-gpu.png")
        self.assertEqual(failures, [])

    def hole_shot(self, scale, mode, html, hole=None, worker=False):
        import numpy as np
        from PIL import Image
        context = self.browsers[scale, False].new_context(no_viewport=True, service_workers="block")
        try:
            context.route(f"{self.origin}{PAGE}", lambda route: route.fulfill(body=HTML, content_type="text/html"))
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(f"{self.origin}{PAGE}")
            active = page.evaluate(MOUNT, [mode, html, "", worker])
            page.evaluate("document.body.style.background = '#0c0'")
            if mode == "gpu":
                self.assertEqual(active, "gpu")
            if hole is not None:
                page.evaluate("""async (hole) => {
                    const { setHole } = await import('/plauna/render/gpu/DisplayList.js');
                    setHole(document.getElementById('well'), hole);
                    window.__surface.invalidate(false);
                }""", hole)
            page.evaluate(SETTLE)
            page.wait_for_timeout(120)
            x, y, w, h = page.evaluate(RECT)
            image = np.asarray(Image.open(io.BytesIO(page.screenshot())).convert("RGB"), dtype=np.int16)
            self.assertEqual(errors, [])
            return image, (x, y, w, h), page, context
        except BaseException:
            context.close()
            raise

    def test_holes_show_what_lies_below_the_canvas(self):
        import numpy as np
        only = os.environ.get("PLAUNA_FACES_ONLY")
        if only and not any(part in "hole" for part in only.split("|")):
            self.skipTest("not chosen")
        failures = []
        for scale in self.scales:
            for worker in (False, True):
                for name, well, hole, oracle in HOLE_CASES:
                    gpu, rect, page, context = self.hole_shot(scale, "gpu", HOLE_HTML % well, hole, worker)
                    dom, _, dom_page, dom_context = self.hole_shot(scale, "dom", HOLE_HTML % oracle)
                    dom_context.close()
                    x, y, w, h = rect
                    x0, y0 = int(x * scale), int(y * scale)
                    x1, y1 = int((x + w) * scale) + 1, int((y + h) * scale) + 1
                    diff = np.abs(dom[y0:y1, x0:x1] - gpu[y0:y1, x0:x1]).max(axis=2)
                    off = int((diff > TOLERANCE).sum())
                    if off:
                        failures.append(f"{scale:g}x worker={worker} {name}: {off} pixels differ (max {int(diff.max())})")
                    # Taken away, the element paints again: only the bare hole case shows its own background
                    if name == "hole border box":
                        page.evaluate("""async () => {
                            const { setHole, holeOf } = await import('/plauna/render/gpu/DisplayList.js');
                            const well = document.getElementById('well');
                            if (!holeOf(well)) throw new Error('holeOf lost the hole');
                            setHole(well, null);
                            if (holeOf(well)) throw new Error('holeOf kept the hole');
                            window.__surface.invalidate(false);
                        }""")
                        page.evaluate(SETTLE)
                        page.wait_for_timeout(120)
                        from PIL import Image
                        after = np.asarray(Image.open(io.BytesIO(page.screenshot())).convert("RGB"), dtype=np.int16)
                        px = after[int((y + 40) * scale), int((x + 40) * scale)]
                        if tuple(int(v) for v in px) != (204, 51, 51):
                            failures.append(f"{scale:g}x worker={worker}: after setHole(el, null) the well shows {tuple(px)}")
                    context.close()
        self.assertEqual(failures, [])

    def test_indeterminate_progress_sweeps(self):
        import numpy as np
        from PIL import Image
        only = os.environ.get("PLAUNA_FACES_ONLY")
        if only and not any(part in "indeterminate progress" for part in only.split("|")):
            self.skipTest("not chosen")
        scale = self.scales[0]
        case = Case("indeterminate", '<progress id="t" style="width:200px"></progress>')
        spans = {}
        for mode in ("dom", "gpu"):
            context = self.browsers[scale, False].new_context(no_viewport=True, service_workers="block")
            try:
                context.route(f"{self.origin}{PAGE}", lambda route: route.fulfill(body=HTML, content_type="text/html"))
                page = context.new_page()
                page.goto(f"{self.origin}{PAGE}")
                page.evaluate(MOUNT, [mode, case.html, case.css, False])
                x, y, w, h = page.evaluate(RECT)
                seen = []
                for _ in range(4):
                    page.wait_for_timeout(180)
                    image = np.asarray(Image.open(io.BytesIO(page.screenshot())).convert("RGB"), dtype=np.int16)
                    row = image[int((y + h / 2) * scale), int(x * scale):int((x + w) * scale)]
                    blue = np.where(row[:, 2] > row[:, 0] + 100)[0]
                    seen.append((int(blue.min()), int(blue.max()) - int(blue.min()) + 1) if len(blue) else None)
                spans[mode] = seen
            finally:
                context.close()
        for mode, seen in spans.items():
            self.assertTrue(all(seen), f"{mode}: no value block in {seen}")
            self.assertGreater(len({at for at, _ in seen}), 1, f"{mode}: the block does not move: {seen}")
        # Each mode's block is a fifth of the track
        widths = [length for seen in spans.values() for _, length in seen]
        self.assertLessEqual(max(widths) - min(widths), 2, str(spans))


if __name__ == "__main__":
    main()
