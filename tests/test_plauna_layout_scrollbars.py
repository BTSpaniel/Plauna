# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Plauna's layout against Chrome with classic scrollbars visible.

The status pages run with Playwright's --hide-scrollbars, where every bar takes
no room, so nothing they check says where a real bar goes. This test drops that
flag (headless, bars visible) and starts Chrome with --force-device-scale-factor
at 1, 1.25, 1.5 and 2 (real scaling, no emulated viewport). Each case is laid
out by the browser and by LayoutEngine from the same elements, and every box
must match getBoundingClientRect to a fraction of a layout unit, and each scroll
container its clientWidth/Height and scrollWidth/Height as the browser rounds
them.

What the cases cover (each rule was measured in Chrome before it was built):
scrollbar-width auto, thin and none; ::-webkit-scrollbar width, height, zero and
display: none, floored to whole device pixels; scrollbar-gutter stable and
both-edges; the horizontal bar's height; overflow: auto bars appearing only when
content overflows, and the reflow they cause; intrinsic sizes that include a
bar; right-to-left bars; positioned and sticky boxes around bars; form controls;
shadow trees.

test_parity_page_with_visible_scrollbars runs the whole layout parity page
(tests/plauna-layout-parity.test.js) with its engines given the probed bar
width instead of 0.
"""

import sys
from contextlib import ExitStack
from pathlib import Path
from unittest import SkipTest, TestCase, main

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from plauna_browser_support import chrome_path, sdk_server  # noqa: E402

PAGE = "/__plauna_layout_scrollbars__.html"
HTML = "<!doctype html><meta charset=utf-8><body style=margin:0><div id=stage style='position:relative;width:640px;font:13px Arial'></div></body>"
SCALES = (1, 1.25, 1.5, 2)
PARITY_PAGE = "/tests/plauna-layout-parity.html"
PARITY_MODULE = "/tests/plauna-layout-parity.test.js"
PARITY_ENGINE = "scrollbarWidth: 0"
# Boxes must match to this (CSS px): a layout unit is 1/64 / scale
TOLERANCE = 1e-3

SHEET = """
.s { position: relative; width: 120px; height: 80px; box-sizing: border-box; border: 2px solid; padding: 3px; margin: 1px 0 }
.a { width: 120px; border: 2px solid; margin: 1px 0 }
.pin { position: absolute; inset: 0 }
.flow { height: 10px }
.wide { width: 300px; height: 20px }
.tall { height: 150px }
.bx { height: 100px; width: 100px }
.wk0::-webkit-scrollbar { width: 0; height: 0 }
.wkn::-webkit-scrollbar { display: none }
.wk6::-webkit-scrollbar { width: 6px; height: 4px }
.wk75::-webkit-scrollbar { width: 7.5px; height: 7.3px }
.wkw::-webkit-scrollbar { width: 9px }
.wkh::-webkit-scrollbar { height: 5px }
.wkpct::-webkit-scrollbar { width: 10%; height: 9px }
.wkem { font-size: 20px } .wkem::-webkit-scrollbar { width: .5em; height: .45em }
.wkthin { scrollbar-width: thin } .wkthin::-webkit-scrollbar { width: 8px }
.wkcol { scrollbar-color: red blue } .wkcol::-webkit-scrollbar { width: 8px }
.wkin { scrollbar-color: red blue }
.wkin > * { }
.scope ::-webkit-scrollbar { width: 5px; height: 3px }
"""


def s(css, inner='<div class="flow"></div>', cls=""):
    """A sized, positioned scroll container with a child pinned to its padding box."""
    return f'<div class="s {cls}" style="{css}"><div class="pin"></div>{inner}</div>'


def a(css, inner, cls=""):
    """A scroll container whose height comes from its content."""
    return f'<div class="a {cls}" style="{css}">{inner}</div>'


TEXT = "one two three four five six seven eight nine ten eleven twelve"
WIDE = '<div class="wide"></div>'
TALL = '<div class="tall"></div>'
BOTH = '<div class="wide"></div><div class="tall"></div>'

CASES = {
    # What a bar takes
    "overflow values": "".join(s(css) for css in (
        "overflow:scroll", "overflow-x:scroll", "overflow-y:scroll", "overflow:auto", "overflow:hidden", "overflow:clip",
        "overflow:visible", "overflow-x:hidden;overflow-y:scroll", "overflow-x:scroll;overflow-y:hidden", "overflow-x:clip;overflow-y:scroll",
    )),
    "scrollbar-width": "".join(s(css) for css in (
        "overflow:scroll;scrollbar-width:thin", "overflow:scroll;scrollbar-width:none", "overflow:auto;scrollbar-width:none",
        "overflow-x:scroll;scrollbar-width:thin",
    )) + s("overflow:auto;scrollbar-width:thin", BOTH) + s("overflow:auto;scrollbar-width:none", BOTH),
    "webkit scrollbar sizes": "".join(s("overflow:scroll", cls=cls) for cls in (
        "wk0", "wkn", "wk6", "wk75", "wkw", "wkh", "wkpct", "wkem", "wkthin", "wkcol",
    )) + s("overflow:auto", BOTH, "wk6") + s("overflow:auto", BOTH, "wkn") + s("overflow:auto", BOTH, "wk0")
       + f'<div class="wkin">{s("overflow:scroll", cls="wk6")}</div><div class="scope">{s("overflow:scroll")}{s("overflow:auto", BOTH)}</div>',
    # scrollbar-gutter
    "stable gutters": "".join(s(css) for css in (
        "overflow:auto;scrollbar-gutter:stable", "overflow:hidden;scrollbar-gutter:stable", "overflow:clip;scrollbar-gutter:stable",
        "overflow:visible;scrollbar-gutter:stable", "overflow:auto;scrollbar-gutter:stable both-edges",
        "overflow-y:scroll;scrollbar-gutter:stable both-edges", "overflow:auto;scrollbar-gutter:stable;scrollbar-width:thin",
        "overflow:auto;scrollbar-gutter:stable;scrollbar-width:none", "overflow:hidden;scrollbar-gutter:stable both-edges;scrollbar-width:thin",
        "overflow-x:auto;overflow-y:hidden;scrollbar-gutter:stable", "overflow-x:scroll;overflow-y:hidden;scrollbar-gutter:stable",
    )) + s("overflow:auto;scrollbar-gutter:stable", BOTH) + s("overflow:auto;scrollbar-gutter:stable both-edges", BOTH)
       + s("overflow:auto;scrollbar-gutter:stable", cls="wk6") + s("overflow:hidden;scrollbar-gutter:stable both-edges", cls="wk6")
       + s("overflow:auto;scrollbar-gutter:stable", cls="wkn") + s("overflow:auto;scrollbar-gutter:stable", cls="wk0"),
    "right to left": "".join(s(f"direction:rtl;{css}") for css in (
        "overflow:scroll", "overflow:auto;scrollbar-gutter:stable", "overflow:auto;scrollbar-gutter:stable both-edges", "overflow-y:scroll;scrollbar-width:thin",
    )),
    # overflow: auto decides by content
    "auto bars on one axis": "".join(a(css, inner) for css, inner in (
        ("overflow-x:auto", WIDE), ("overflow-x:auto", '<div style="height:20px"></div>'),
        ("overflow-x:auto", '<div style="width:100px;height:20px;margin-left:30px"></div>'),
        ("overflow-x:auto;padding:0 2px", '<div style="width:120px;height:20px"></div>'),
        ("overflow-x:auto;padding:0 2px", '<div style="width:130px;height:20px"></div>'),
        ("overflow-x:auto;white-space:nowrap", TEXT),
        ("overflow-x:auto;overflow-y:hidden", WIDE),
        ("overflow-x:auto;display:flex;gap:3px", '<div style="flex:none;width:80px;height:10px"></div><div style="flex:none;width:77px;height:10px"></div>'),
        ("overflow-x:auto;display:flex;gap:3px;padding:2px", '<div style="flex:none;width:70px;height:10px"></div><div style="flex:none;width:44px;height:10px"></div>'),
        ("overflow-x:scroll", '<div style="height:20px"></div>'),
        ("overflow-y:auto;max-height:50px", TALL), ("overflow-y:auto;max-height:50px", '<div style="height:40px"></div>'),
        ("overflow-y:auto;height:40px", TEXT), ("overflow-y:auto;height:80px", TEXT),
        ("overflow-y:auto;max-height:60px;padding:3px", '<div style="height:60px"></div>'),
        ("overflow-y:auto;height:60px", '<div style="height:50px;margin-bottom:15px"></div>'),
    )),
    "auto bars on both axes": "".join(a(f"overflow:auto;{css}", inner) for css, inner in (
        ("height:80px", '<div style="width:120px;height:80px"></div>'),
        # One bar makes the content overflow the other way
        ("height:80px", '<div style="width:110px;height:90px"></div>'),
        ("height:80px", '<div style="width:300px;height:70px"></div>'),
        ("height:80px", BOTH),
        ("height:80px", '<div style="width:100%;height:100%"></div>'),
        ("height:80px;width:100px", '<div style="width:110px;height:70px"></div>'),
        ("max-height:80px", '<div style="width:300px;height:70px"></div>'),
    )),
    "what counts as overflow": "".join(a("overflow:auto;position:relative;height:40px", inner) for inner in (
        '<div style="position:absolute;left:100px;top:0;width:50px;height:10px"></div>',
        '<div style="position:absolute;left:0;top:30px;width:50px;height:15px"></div>',
        '<div style="position:relative;left:100px;width:50px;height:10px"></div>',
        '<div style="transform:translateX(100px);width:50px;height:10px"></div>',
        '<div style="transform:translateY(35px);height:10px"></div>',
        '<div><div style="width:130px;height:10px"></div></div>',
        '<div style="overflow:hidden"><div style="width:130px;height:10px"></div></div>',
        '<div style="height:10px"><div style="height:60px"></div></div>',
    )),
    # Intrinsic sizes
    "shrink to fit with bars": "".join(f'<div style="margin:1px 0">{inner}</div>' for inner in (
        '<div style="display:inline-block;overflow:scroll"><div style="width:50px;height:10px"></div></div>',
        '<div style="display:inline-block;overflow:scroll;scrollbar-width:thin"><div style="width:50px;height:10px"></div></div>',
        '<div style="display:inline-block;overflow:scroll;scrollbar-width:none"><div style="width:50px;height:10px"></div></div>',
        '<div class="wk6" style="display:inline-block;overflow:scroll"><div style="width:50px;height:10px"></div></div>',
        '<div class="wkn" style="display:inline-block;overflow:scroll"><div style="width:50px;height:10px"></div></div>',
        '<div style="display:inline-block;overflow-y:auto;height:40px"><div style="width:50px;height:100px"></div></div>',
        '<div style="display:inline-block;overflow-y:auto;height:40px"><div style="width:50px;height:10px"></div></div>',
        '<div style="display:inline-block;overflow-y:auto;max-height:40px"><div style="width:50px;height:100px"></div></div>',
        '<div style="display:inline-block;overflow:auto;height:40px;scrollbar-width:thin"><div style="width:50px;height:100px"></div></div>',
        '<div class="wk6" style="display:inline-block;overflow:auto;height:40px"><div style="width:50px;height:100px"></div></div>',
        '<div style="display:inline-block;overflow:hidden;scrollbar-gutter:stable"><div style="width:50px;height:10px"></div></div>',
        '<div style="display:inline-block;overflow:hidden;scrollbar-gutter:stable both-edges"><div style="width:50px;height:10px"></div></div>',
        '<div style="display:inline-block;overflow-x:scroll"><div style="width:50px;height:10px"></div></div>',
        '<div style="display:inline-block;overflow:auto;max-width:60px"><div style="width:100px;height:10px"></div></div>',
    )),
    # A bar that makes a block's content overflow the other way adds a second
    # bar; a flex or grid item decides once
    "bars that cause bars": "".join(f'<div style="margin:1px 0;{outer}"><div style="{css}overflow:auto;height:30px">{inner}</div></div>' for outer, css, inner in (
        ("", "width:50px;", '<div style="width:50px;height:60px"></div>'),
        ("", "width:50px;", '<div style="width:40px;height:60px"></div>'),
        ("", "width:50px;", '<div style="width:100%;height:60px"></div>'),
        ("", "width:50px;", '<div style="width:60px;height:25px"></div>'),
        ("display:grid;grid-template-columns:50px", "", '<div style="width:50px;height:60px"></div>'),
        ("display:grid;grid-template-columns:50px", "", '<div style="width:100px;height:60px"></div>'),
        ("display:grid;grid-template-columns:50px;grid-template-rows:30px", "", '<div style="width:50px;height:60px"></div>'),
        ("display:grid;grid-template-columns:50px;justify-items:start", "width:50px;", '<div style="width:50px;height:60px"></div>'),
        ("display:grid;grid-template-columns:auto 1fr", "", '<div style="width:50px;height:60px"></div>'),
        ("display:grid;grid-template-columns:max-content 1fr", "", '<div style="width:50px;height:60px"></div>'),
        ("display:grid;grid-template-columns:auto 1fr", "overflow-x:hidden;", '<div style="width:50px;height:60px"></div>'),
        ("display:flex", "flex:none;width:50px;", '<div style="width:50px;height:60px"></div>'),
        ("display:flex;width:50px", "min-width:0;", '<div style="width:100px;height:60px"></div>'),
        ("display:flex;width:50px;height:30px", "", '<div style="width:50px;height:60px"></div>'),
        ("display:flex;width:50px;height:30px", "flex:1;min-width:0;", '<div style="width:50px;height:60px"></div>'),
        ("display:flex;align-items:flex-start", "flex:none;width:50px;", '<div style="width:50px;height:60px"></div>'),
        ("display:flex;flex-direction:column;align-items:flex-start", "width:50px;", '<div style="width:50px;height:60px"></div>'),
        ("position:relative;height:40px", "position:absolute;width:50px;", '<div style="width:50px;height:60px"></div>'),
    )) + '<div style="display:inline-block;vertical-align:top"><div style="width:50px;overflow:auto;height:30px"><div style="width:50px;height:60px"></div></div></div>'
       + '<table style="border-spacing:0"><tr><td style="padding:0"><div style="overflow:auto;height:30px"><div style="width:50px;height:60px"></div></div></td></tr></table>'
       + '<table style="border-spacing:0"><tr><td style="padding:0;width:50px;height:30px;overflow:auto"><div style="width:50px;height:60px"></div></td></tr></table>'
       + '<table style="overflow:scroll;width:100px;border-spacing:0"><tr><td style="padding:0"><div style="height:30px"></div></td></tr></table>'
       + '<table style="overflow:auto;width:100px;border-spacing:0"><tr><td style="padding:0;overflow:scroll"><div style="height:80px"></div></td></tr></table>'
       + '<div style="display:grid;grid-template-columns:auto 1fr"><div><div style="overflow:auto;height:30px"><div style="width:50px;height:60px"></div></div></div></div>',
    # A grid item decides its bars once where its rows lay it out to measure
    # its height (an intrinsic row; a flexible one in a grid of indefinite
    # height; an auto minimum only for an item of definite height) and that
    # height stays; a fixed row, or stretching to another height, decides
    # afresh, so a bar that makes the content overflow adds the second bar
    "grid items and the second bar": "".join(
        f'<div style="margin:1px 0;display:grid;grid-template-columns:50px;{grid}"><div style="overflow:auto;{item}"><div style="width:50px;height:60px"></div></div></div>'
        for grid, item in (
            ("height:30px;grid-template-rows:1fr", ""), ("height:30px;grid-template-rows:minmax(0,1fr)", ""), ("height:30px", "min-height:0"),
            ("height:30px", ""), ("height:30px;align-content:start", "min-height:0"), ("height:30px;grid-template-rows:minmax(auto,1fr)", ""),
            ("max-height:30px;grid-template-rows:1fr", ""), ("grid-template-rows:30px", ""), ("height:30px;grid-template-rows:1fr", "max-height:30px"),
            ("height:30px;grid-template-rows:minmax(0,1fr)", "height:30px"), ("height:30px;grid-template-rows:100%", "height:30px"),
            ("grid-template-rows:30px", "max-height:30px"), ("height:30px;grid-template-rows:30px", "max-height:30px"),
            ("grid-template-rows:30px", "align-self:start;max-height:30px"), ("grid-template-rows:40px", "align-self:center;height:30px"),
            ("", "height:30px"), ("grid-template-rows:1fr", "height:30px"), ("grid-template-rows:minmax(0,1fr)", "height:30px"),
            ("min-height:30px;grid-template-rows:1fr", "height:20px"), ("min-height:30px", "height:20px"), ("height:30px", "height:30px"),
            ("height:30px;grid-template-rows:1fr", "height:30px"), ("height:30px;grid-template-rows:min-content", "height:30px"),
            ("height:30px;grid-template-rows:max-content", "height:30px"), ("height:30px;grid-template-rows:fit-content(30px)", "height:30px"),
            ("grid-template-rows:100%", "height:30px"), ("height:30px;grid-template-rows:1fr", "height:20px"), ("height:30px", "height:20px"),
            ("", "max-height:30px"), ("grid-template-rows:1fr", "max-height:30px"), ("height:30px", "align-self:start;max-height:30px"),
            ("height:30px;grid-template-rows:1fr", "align-self:start;height:30px"),
        ))
        + '<div style="display:grid;grid-template-columns:50px;grid-template-rows:1fr 1fr;height:60px"><div style="overflow:auto"><div style="width:50px;height:60px"></div></div><div></div></div>',
    "flex, grid and absolute items with bars": (        '<div style="display:flex;gap:2px"><div style="overflow:scroll"><div style="width:50px;height:10px"></div></div>'
        '<div style="overflow:auto;height:30px"><div style="width:50px;height:60px"></div></div>'
        '<div style="flex:1;overflow:auto;height:30px"><div style="height:60px"></div></div>'
        '<div style="flex:1;overflow:auto;scrollbar-width:thin;height:30px"><div style="height:60px"></div></div></div>'
        '<div style="display:grid;grid-template-columns:auto auto 1fr;gap:2px"><div style="overflow:scroll"><div style="width:50px;height:10px"></div></div>'
        '<div style="overflow:auto;height:30px"><div style="width:50px;height:60px"></div></div>'
        '<div style="overflow:auto;height:30px"><div style="height:60px"></div></div></div>'
        '<div style="position:relative;height:60px"><div style="position:absolute;left:0;top:0;overflow:scroll"><div style="width:50px;height:10px"></div></div>'
        '<div style="position:absolute;left:100px;top:0;overflow:auto;height:40px"><div style="width:50px;height:60px"></div></div>'
        '<div style="position:absolute;right:0;top:0;bottom:0;width:100px;overflow:auto"><div style="height:90px"></div></div></div>'
    ),
    # A scroll container as a flex or grid container, with percentages inside
    "containers that scroll": "".join(a(f"height:90px;{css}", inner) for css, inner in (
        ("overflow:scroll", '<div style="height:100%;width:100%"></div>'),
        ("overflow-x:scroll", '<div style="height:100%;width:50%"></div>'),
        ("overflow:auto", '<div style="width:300px;height:100%"></div>'),
        ("overflow:scroll;display:flex", '<div style="flex:1"></div><div style="flex:1"></div>'),
        ("overflow:scroll;display:flex;flex-direction:column", '<div style="flex:1"></div><div style="flex:1"></div>'),
        ("overflow:auto;display:flex;flex-direction:column", '<div style="flex:none;height:120px"></div><div style="flex:none;height:20px"></div>'),
        ("overflow:auto;display:flex", '<div style="flex:none;width:90px;height:20px"></div><div style="flex:none;width:60px;height:120px"></div>'),
        ("overflow:scroll;display:grid;grid-template:1fr 1fr / 1fr 1fr", '<div></div><div></div><div></div><div></div>'),
        ("overflow:auto;display:grid;grid-template-rows:60px 60px", '<div></div><div></div>'),
        ("overflow:scroll;display:grid;justify-items:center;align-items:center", '<div style="width:20px;height:20px"></div>'),
    )) + a("overflow:scroll;height:60px", "<table style='width:100%;border-spacing:0'><tr><td>a</td><td>b</td></tr></table>")
       + a("overflow:auto;height:40px", TEXT) + a("overflow:scroll;height:40px;text-align:center", "one") + a("overflow:scroll;height:40px;text-align:right", "one"),
    # Sizes in CSS lengths: the bar comes out of the content box, not on top
    "bars and box sizing": "".join(f'<div style="margin:1px 0;{css}"><div style="position:absolute;inset:0"></div><div class="flow"></div></div>' for css in (
        "position:relative;width:100px;height:50px;overflow:scroll",
        "position:relative;width:100px;height:50px;overflow:scroll;padding:5px 2px;border:2px solid",
        "position:relative;width:100px;height:50px;overflow:scroll;padding:5px 2px;border:2px solid;box-sizing:border-box",
        "position:relative;width:100px;height:50px;overflow:hidden;scrollbar-gutter:stable both-edges",
        "position:relative;min-width:100px;width:50px;min-height:50px;overflow:scroll",
        "position:relative;max-width:100px;max-height:50px;width:300px;overflow:scroll",
        "position:relative;max-height:15px;overflow:scroll;width:100px",
        "position:relative;width:10px;height:10px;overflow:scroll",
        "position:relative;width:18px;height:18px;overflow:scroll;padding:1px",
    )),
    # Positioned boxes around bars
    "absolute boxes inside bars": "".join(s(css, '<div style="position:absolute;right:0;bottom:0;width:10px;height:10px"></div>'
                                                 '<div style="position:absolute;left:10%;top:10%;width:50%;height:50%"></div>'
                                                 '<div class="flow"></div><div style="position:absolute;width:5px;height:5px"></div>') for css in (
        "overflow:scroll", "overflow:scroll;scrollbar-width:thin", "overflow:hidden;scrollbar-gutter:stable both-edges",
    )) + s("direction:rtl;overflow:scroll", '<div style="position:absolute;right:0;bottom:0;width:10px;height:10px"></div>'
                                            '<div style="position:absolute;left:10%;top:10%;width:50%;height:50%"></div>')
       + s("overflow:scroll", '<div style="position:absolute;right:0;bottom:0;width:10px;height:10px"></div>', "wk6")
       + s("overflow:scroll;contain:layout", '<div style="position:fixed;right:0;bottom:0;width:10px;height:10px"></div>'),
    # Bars shown come off what a sticky box sticks within, a gutter with no bar in it does not
    "sticky boxes inside bars": "".join(s(f"{css}", f'<div style="display:flex;width:600px;height:10px;direction:ltr"><div style="flex:none;width:{gap}px"></div><div style="position:sticky;{inset};flex:none;width:10px"></div></div><div style="height:{down}px"></div>'
                                          f'<div style="position:sticky;{block};height:10px"></div><div class="tall"></div>').replace('class="s "', f'class="s" data-scroll="{scroll}"', 1) for css, gap, inset, down, block, scroll in (
        ("overflow:scroll", 100, "left:1px", 90, "bottom:2px", "0,0"), ("overflow:scroll", 300, "right:1px", 0, "top:1px", "95,40"),
        ("overflow:scroll", 300, "right:1px", 0, "top:1px", "0,0"), ("overflow:scroll", 0, "left:50%", 90, "bottom:50%", "10,10"),
        ("overflow:scroll;scrollbar-width:thin", 300, "right:1px", 90, "bottom:1px", "0,0"), ("overflow:scroll;scrollbar-width:thin", 0, "left:50%", 0, "bottom:50%", "10,10"),
        ("overflow:scroll;scrollbar-width:none", 300, "right:1px", 90, "bottom:1px", "0,0"), ("overflow:hidden", 300, "right:1px", 90, "bottom:1px", "0,0"),
        ("overflow:hidden", 0, "left:50%", 90, "bottom:50%", "10,10"), ("overflow-x:hidden;overflow-y:scroll", 300, "right:1px", 90, "bottom:1px", "0,0"),
        ("overflow:hidden;scrollbar-gutter:stable", 300, "right:1px", 90, "bottom:1px", "0,0"), ("overflow:hidden;scrollbar-gutter:stable", 0, "left:50%", 0, "top:1px", "10,10"),
        ("overflow-x:scroll;overflow-y:hidden;scrollbar-gutter:stable", 300, "right:1px", 90, "bottom:1px", "95,0"),
        ("overflow:hidden;scrollbar-gutter:stable both-edges", 0, "left:1px", 0, "top:1px", "0,0"), ("overflow:hidden;scrollbar-gutter:stable both-edges", 0, "left:1px", 0, "top:1px", "30,20"),
        ("overflow:hidden;scrollbar-gutter:stable both-edges", 300, "right:1px", 90, "bottom:1px", "0,0"), ("overflow:scroll;scrollbar-gutter:stable both-edges", 300, "right:1px", 90, "bottom:1px", "95,0"),
        ("overflow:scroll;scrollbar-gutter:stable both-edges", 0, "left:1px", 0, "top:1px", "150,0"),
    )) + s("overflow:scroll", '<div class="wide"></div><div style="position:sticky;right:1px;bottom:1px;width:10px;height:10px;margin-left:auto"></div><div class="tall"></div>', "wk6"),
    # Form controls lay out their own scrollbars
    "form controls": (
        '<div><textarea></textarea> <textarea cols="30" rows="3"></textarea> <textarea style="overflow:hidden"></textarea> <textarea style="overflow:scroll"></textarea></div>'
        '<div><textarea style="scrollbar-width:thin"></textarea> <textarea style="scrollbar-width:none"></textarea> <textarea class="wk6"></textarea> <textarea class="wkn"></textarea></div>'
        '<div><textarea style="width:100px;height:50px"></textarea> <textarea style="width:100px;height:50px;overflow:scroll;padding:4px"></textarea></div>'
        '<div><textarea style="overflow:scroll;scrollbar-width:thin"></textarea> <textarea style="overflow:scroll;scrollbar-width:none"></textarea> <textarea style="overflow-x:scroll"></textarea> <textarea style="overflow-y:scroll"></textarea></div>'
        '<div><textarea style="overflow:hidden;scrollbar-width:thin"></textarea> <textarea style="overflow:hidden;scrollbar-width:none"></textarea> <textarea style="overflow-y:hidden"></textarea> <textarea style="overflow-x:hidden"></textarea></div>'
        '<div><textarea style="overflow-y:hidden;overflow-x:scroll"></textarea> <textarea style="overflow:clip;vertical-align:top"></textarea> <textarea style="overflow-y:scroll;overflow-x:hidden"></textarea></div>'
        '<div><textarea class="wk6" style="overflow:scroll"></textarea> <textarea class="wkn" style="overflow:scroll"></textarea> <textarea style="scrollbar-gutter:stable"></textarea> <textarea style="scrollbar-gutter:stable both-edges"></textarea></div>'
        '<div><textarea style="overflow:scroll;scrollbar-gutter:stable both-edges"></textarea> <textarea style="overflow:hidden;scrollbar-gutter:stable"></textarea></div>'
        '<div><select><option>one</option></select> <input></div>'
    ),
    # Table spacing is in whole layout pixels (the default 2px is 1.6px at 125%),
    # with a scroll container round it and a sticky header in it
    "tables": (
        '<div style="overflow:auto;height:60px;width:200px"><table><thead><tr><th style="position:sticky;top:0">Head</th><th>H2</th></tr></thead>'
        + "".join(f"<tr><td>row {i}</td><td>v</td></tr>" for i in range(9)) + "</table></div>"
        + "".join(f'<table style="border-spacing:{sp};border:1px solid"><tr><td>a</td><td style="padding:0">b</td></tr></table>' for sp in ("0.5px", "1px", "1.5px", "2.5px 1px", "3px", "3.3px", "7px"))
    ),
    # Nested scroll containers
    "nesting": (
        a("overflow:auto;height:80px", a("overflow:auto;height:40px", TALL) + WIDE)
        + a("overflow:scroll;height:80px", '<div style="overflow:scroll;height:100%"><div style="height:100%"></div></div>')
        + a("overflow-x:auto", a("overflow-x:auto;width:200px", '<div style="width:300px;height:10px"></div>'))
        + a("overflow:auto;display:inline-block;height:50px", '<div style="overflow:scroll"><div style="width:40px;height:90px"></div></div>')
    ),
    # A shadow host that scrolls, with scrollbar rules in its own tree
    "shadow trees": (
        '<div><template shadowrootmode="open"><style>:host { display: block; overflow: auto; height: 50px; width: 120px } '
        '::-webkit-scrollbar { width: 4px } .in { overflow: scroll; height: 30px } ::slotted(p) { margin: 0; height: 90px }</style>'
        '<div class="in"><div style="height:5px"></div></div><slot></slot></template><p>slotted</p></div>'
    ),
}

RUN = r"""async ([sheet, cases, tolerance]) => {
    const { LayoutEngine, probeScrollbarWidth, transformRectBounds } = await import('/plauna/render/layout/LayoutEngine.js');
    const { StyleResolver, inheritedStyleFromHost } = await import('/plauna/render/css/StyleResolver.js');
    const { userAgentStyles } = await import('/plauna/render/css/UserAgentStyles.js');
    const { layoutZoom } = await import('/plauna/render/layout/LayoutUnits.js');
    const style = document.createElement('style');
    style.textContent = sheet;
    document.head.appendChild(style);
    const stage = document.getElementById('stage');
    userAgentStyles.calibrate(stage);
    const engine = new LayoutEngine({
        resolver: new StyleResolver(), scrollbarWidth: probeScrollbarWidth(),
        scrollOffsets: (box) => (box.element ? { x: box.element.scrollLeft || 0, y: box.element.scrollTop || 0 } : null)
    });
    const flat = (root) => {
        const out = [];
        const walk = (el) => {
            out.push(el);
            let children = el.shadowRoot ? [...el.shadowRoot.children] : [...el.children];
            if (el.localName === 'slot' && el.assignedNodes().length) children = el.assignedElements();
            for (const child of children) walk(child);
        };
        walk(root);
        return out;
    };
    const path = (el) => {
        const parts = [];
        for (let e = el; e && e !== stage; e = e.parentElement ?? e.getRootNode().host) {
            const parent = e.parentElement ?? e.parentNode;
            parts.unshift(`${e.localName}[${[...parent.children].indexOf(e)}]`);
        }
        return parts.slice(-4).join('>');
    };
    const out = {};
    for (const [name, html] of Object.entries(cases)) {
        const element = document.createElement('div');
        element.setHTMLUnsafe(html);
        stage.replaceChildren(element);
        for (const el of element.querySelectorAll('[data-scroll]')) [el.scrollLeft, el.scrollTop] = el.dataset.scroll.split(',').map(Number);
        await new Promise((r) => requestAnimationFrame(r));
        const mismatches = [];
        for (const width of [640, 600]) {
        // The second layout sees the first's bars, as the browser's does
        stage.style.width = `${width}px`;
        const origin = stage.getBoundingClientRect();
        const result = engine.layout(element, { width: stage.clientWidth, rootInherited: inheritedStyleFromHost(stage) });
        for (const el of flat(element)) {
            if (el.closest('svg') && el.localName !== 'svg' || ['style', 'option', 'template'].includes(el.localName)) continue;
            const computed = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            const box = result.boxes.get(el);
            if (!box) {
                if (computed.display !== 'none' && computed.display !== 'contents' && el.getClientRects().length) mismatches.push({ el: path(el), reason: 'not laid out' });
                continue;
            }
            let ours;
            if (box.outer === 'inline' && !box.atomic && box.absFragments?.length) {
                const x0 = Math.min(...box.absFragments.map((f) => f.x));
                const y0 = Math.min(...box.absFragments.map((f) => f.y));
                ours = { x: x0, y: y0, width: Math.max(...box.absFragments.map((f) => f.x + f.width)) - x0, height: Math.max(...box.absFragments.map((f) => f.y + f.height)) - y0 };
            } else {
                ours = { x: box.absX, y: box.absY, width: box.width, height: box.height };
                if (box.matrix) ours = transformRectBounds(box.matrix, ours);
            }
            const dom = { x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height };
            const err = Math.max(Math.abs(ours.x - dom.x), Math.abs(ours.y - dom.y), Math.abs(ours.width - dom.width), Math.abs(ours.height - dom.height));
            const round = (v) => +v.toFixed(3);
            if (err > tolerance) {
                mismatches.push({ width, el: path(el), css: el.getAttribute('style'), dom: [dom.x, dom.y, dom.width, dom.height].map(round), ours: [ours.x, ours.y, ours.width, ours.height].map(round) });
            }
            // A scroll container's scrollable area and what shows of it, as the browser rounds them
            if (box.scroller && box.scrollExtent && box.inner !== 'replaced') {
                const [right, bottom, left] = box.scrollbar;
                const client = [Math.max(0, box.width - box.border[1] - box.border[3] - right - left), Math.max(0, box.height - box.border[0] - box.border[2] - bottom)];
                const scroll = [box.scrollWidth, box.scrollHeight];
                const near = (ours, dom) => Math.abs(ours - dom) <= 1;
                // (A box with no room left reports no scrollable area)
                if (client[0] && client[1] && (!near(client[0], el.clientWidth) || !near(client[1], el.clientHeight) || !near(scroll[0], el.scrollWidth) || !near(scroll[1], el.scrollHeight))) {
                    mismatches.push({ width, el: path(el), css: el.getAttribute('style'), reason: 'scroll area', dom: [el.clientWidth, el.clientHeight, el.scrollWidth, el.scrollHeight], ours: [...client, ...scroll].map(round) });
                }
            }
        }
        }
        stage.style.width = '640px';
        out[name] = mismatches;
    }
    return { dpr: devicePixelRatio, zoom: layoutZoom(), bar: engine.scrollbarWidth, out };
}"""


class PlaunaLayoutScrollbarTests(TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from playwright.sync_api import sync_playwright
            executable = chrome_path()
        except (ImportError, ValueError) as error:
            raise SkipTest(str(error)) from error
        cls.executable = executable
        cls.resources = ExitStack()
        try:
            cls.origin, _ = cls.resources.enter_context(sdk_server(ROOT))
            cls.playwright = sync_playwright().start()
            cls.resources.callback(cls.playwright.stop)
            cls.results = {}
            for scale in SCALES:
                browser = cls.open_browser(scale)
                try:
                    context = browser.new_context(no_viewport=True, service_workers="block")
                    context.route(f"{cls.origin}{PAGE}", lambda route: route.fulfill(body=HTML, content_type="text/html"))
                    page = context.new_page()
                    errors = []
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    page.goto(f"{cls.origin}{PAGE}")
                    cls.results[scale] = (page.evaluate(RUN, [SHEET, CASES, TOLERANCE]), errors)
                finally:
                    browser.close()
        except BaseException:
            cls.resources.close()
            raise

    @classmethod
    def open_browser(cls, scale):
        return cls.playwright.chromium.launch(
            executable_path=cls.executable, headless=True, ignore_default_args=["--hide-scrollbars"],
            args=[f"--force-device-scale-factor={scale}", "--window-size=900,700"])

    @classmethod
    def tearDownClass(cls):
        cls.resources.close()

    def test_scale_factors_are_real_and_bars_take_room(self):
        for scale, (result, errors) in self.results.items():
            self.assertEqual(errors, [])
            self.assertAlmostEqual(result["dpr"], scale, places=3)
            self.assertAlmostEqual(result["zoom"], scale, places=3)
            self.assertGreater(result["bar"], 5, f"{scale}x: scrollbars hidden")

    def test_layout_matches_chrome(self):
        failures = []
        for scale, (result, _) in self.results.items():
            for name, mismatches in result["out"].items():
                for mismatch in mismatches:
                    failures.append(f"{scale}x {name}: {mismatch}")
        self.assertEqual(len(failures), 0, "\n".join(failures[:40]) + f"\n... {len(failures)} in all")

    def test_parity_page_with_visible_scrollbars(self):
        """The whole layout parity page, its engines given the probed bar width."""
        source = (ROOT / PARITY_MODULE.lstrip("/")).read_text(encoding="utf-8")
        self.assertIn(PARITY_ENGINE, source)
        patched = source.replace(
            "import { LayoutEngine, transformRectBounds } from '../plauna/render/layout/LayoutEngine.js';",
            "import { LayoutEngine, transformRectBounds, probeScrollbarWidth } from '../plauna/render/layout/LayoutEngine.js';",
        ).replace(PARITY_ENGINE, "scrollbarWidth: probeScrollbarWidth()")
        self.assertIn("probeScrollbarWidth }", patched)
        browser = self.open_browser(1)
        try:
            context = browser.new_context(no_viewport=True, service_workers="block")
            context.route(f"{self.origin}{PARITY_MODULE}", lambda route: route.fulfill(body=patched, content_type="text/javascript"))
            page = context.new_page()
            for attempt in range(2):
                try:
                    page.goto(f"{self.origin}{PARITY_PAGE}", wait_until="domcontentloaded", timeout=60_000)
                    break
                except Exception:  # one retry on a busy machine
                    if attempt:
                        raise
            page.wait_for_function("() => ['passed', 'failed'].includes(document.documentElement.dataset.testStatus)", timeout=400_000)
            text = page.locator("#results").inner_text()
            bar = page.evaluate("import('/plauna/render/layout/LayoutEngine.js').then((m) => m.probeScrollbarWidth())")
        finally:
            browser.close()
        self.assertGreater(bar, 5, "scrollbars hidden: this run checks nothing")
        failed = [line for line in text.splitlines() if line.startswith("FAIL")]
        details = [line for line in text.splitlines() if not line.startswith("PASS")]
        self.assertEqual(failed, [], "\n".join(details)[:6000])
        self.assertGreater(text.count("\nPASS "), 800)


if __name__ == "__main__":
    main()
