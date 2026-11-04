# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""OpenType numeric features and rasters larger than an atlas page, DOM
against GPU, at real device scale factors.

Numeric features: font-variant-numeric (tabular, proportional, oldstyle and
lining figures, slashed zero, fractions, ordinals) and font-feature-settings
change the glyphs and advances Chrome sets digits with. A canvas has no
setting for them, so Plauna sets such text in a FontFace over the same
installed face with the features as its descriptor (TextShaper.featureFamily).
Checked in system-ui (Segoe UI) at 400/600/700 and italic, Arial, Calibri,
Consolas, Georgia, Verdana, Times New Roman and Cambria, inherited, combined
with font-feature-settings (which wins where both set a feature), in a text
field and in a push button's label; at weights Chrome sets in another named
face than CSS matching picks (500 in Semibold, 750 in Bold), in the OS's font
stack, in a list of nothing installed (the standard font), and with "kern" in
font-feature-settings (which wins over font-kerning):
  - layout: every sample's x and width in Plauna's layout (GPU mode) equal
    the browser's, at 1x, 1.25x, 1.5x and 2x, and so do the intrinsic widths
    of push-button inputs and date and time fields, whose text the features
    change (measured: a text field, a number field and a textarea keep theirs);
  - pixels: the stage matches pixel for pixel (no channel off by more than
    24) at 1x, 1.25x, 1.5x and 2x, and at 1x and 2x when a paint worker draws it;
  - two shapers in one document keep their FontFaces apart, also when they
    come from two copies of the module;
  - the faces found stay found across clear() and zoom changes while the
    page's own font faces stay as they were (each change to document.fonts
    restyles the whole document), and are found again when those change.
Known gaps, not covered: Segoe UI Variable (its local() instances do not set
text exactly as the family does: optical size), so no FontFace stands for it
and its figures stay the font's defaults; "liga" in font-feature-settings
under letter-spacing (a canvas turns ligatures off there whatever the
descriptor says: 17px Calibri 125.92 against 120.08); digits after RTL text
(the page shapes them in the Arabic run, where Segoe UI applies no tnum; the
layout measures the digit token alone: 60.67 against 52.73 at 13px 600).

Rasters larger than an atlas page (2048 device px, less padding): at 2x an
inline SVG (also under a transform), an image, an SVG image in a rounded box,
a radial gradient and an image tile 1100 CSS px wide (2200 device px), and a
text run of about 1290 CSS px shown through a 1100 px box. Before, each was
asked for again by every frame and never placed, so it was missing in GPU
mode. Now each is drawn squeezed on its long axis into what a page holds and
stretched back over its box: after settling, frames ask for no raster they do
not get, nothing stays pending, and each is placed at the page's largest width.
The browser paints them at full resolution, so pixels along the stretched axis
differ: the stage must stay within the measured allowance for each
(OVERSIZED_ALLOWANCES), and nothing else may differ. The squeeze has no lower
bound: this run is squeezed to 79 %, but a 12px Consolas line of about 8500
CSS px (squeezed to 24 %) is an unreadable smear at 1x as at 2x (2807 and
11798 px off). Known gap: long runs need splitting where they are emitted
(DisplayList.emitText).

A raster that arrives while the atlas is full, and has room only once an idle
entry is evicted (two frames after its last use), is placed although nothing
else asks for frames, for each way rasters are made (an SVG and a background
image decoded first, text drawn in the frame); one that can never be placed
asks for a few frames, not one per frame.
"""

import base64
import io
import sys
from contextlib import ExitStack
from pathlib import Path
from unittest import SkipTest, TestCase, main
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from plauna_browser_support import chrome_path, performance_run_lock, sdk_server  # noqa: E402

PAGE = "/__plauna_text_features__.html"
HTML = "<!doctype html><meta charset=utf-8><body></body>"

# (font, numeric features as CSS, text): each sample is laid out inline and as an inline-block
SAMPLES = [
    ("600 13px system-ui", "font-variant-numeric:tabular-nums", "#1000 frame 1469 7711"),
    ("400 13px system-ui", "font-variant-numeric:tabular-nums", "12:01:11 41%"),
    ("400 13px system-ui", "font-variant-numeric:proportional-nums", "1111 2468 1.75"),
    ("700 15px system-ui", "font-variant-numeric:proportional-nums", "1111 4669 next"),
    ("600 17px 'Segoe UI'", "font-variant-numeric:tabular-nums", "#1000 1469 7711"),
    ("italic 700 17px 'Segoe UI'", "font-variant-numeric:proportional-nums", "1111 4669"),
    ("400 17px Arial", "font-variant-numeric:oldstyle-nums", "0123456789 next"),
    ("700 17px Arial", "font-variant-numeric:proportional-nums", "1111 0123456789"),
    ("400 17px Calibri", "font-variant-numeric:proportional-nums slashed-zero", "0123456789 100"),
    ("400 17px Consolas", "font-variant-numeric:slashed-zero", "0000 1/2 10"),
    ("400 17px Consolas", "font-variant-numeric:diagonal-fractions", "1/2 3/4"),
    ("400 17px Georgia", "font-variant-numeric:lining-nums tabular-nums", "0123456789 99%"),
    ("400 17px Georgia", "font-variant-numeric:ordinal", "1st 2nd 3rd"),
    ("400 17px Verdana", "font-variant-numeric:proportional-nums", "1111 0123 next"),
    ("400 17px 'Times New Roman'", "font-variant-numeric:oldstyle-nums stacked-fractions", "2019 1/4"),
    ("400 17px Cambria", "font-variant-numeric:tabular-nums", "11 $10 %"),
    # font-feature-settings alone, combined, and turning a variant's feature off
    ("400 17px Calibri", "font-feature-settings:'pnum'", "1111 1988"),
    ("400 17px Verdana", "font-feature-settings:'pnum' 1, 'onum'", "2019 1970"),
    ("400 17px Arial", "font-variant-numeric:oldstyle-nums;font-feature-settings:'onum' 0", "0123456789"),
    # Weights Chrome sets in another named face than CSS matching would pick
    # (measured: 500 in Semibold, 750 in Bold, not Regular and Black), in the
    # OS's own font stack too
    ("500 13px Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif", "font-variant-numeric:tabular-nums", "#1000 frame 1469 7711"),
    ("500 17px 'Segoe UI'", "font-variant-numeric:tabular-nums", "0123456789 1111 7711"),
    ("750 17px 'Segoe UI'", "font-variant-numeric:proportional-nums", "0123456789 1111 7711"),
    ("750 17px Arial", "font-variant-numeric:proportional-nums", "0123456789 1111"),
    # A list of nothing installed (ui-sans-serif names no font on Windows): the standard font
    ("400 17px ui-sans-serif", "font-variant-numeric:proportional-nums oldstyle-nums", "0123456789 1111"),
    # "kern" in font-feature-settings wins over font-kerning
    ("400 17px Arial", "font-kerning:none;font-feature-settings:'kern' 1", "AVAWAVA To Ty 1111"),
    ("400 17px Arial", "font-feature-settings:'kern' 0", "AVAWAVA To Ty 1111"),
]


def sample_markup():
    rows = []
    for index, (font, features, text) in enumerate(SAMPLES):
        rows.append(f'<div style="font:{font};color:#111;white-space:nowrap">'
                    f'<span data-m="inline {index}" style="{features}">{text}</span>'
                    f'<span data-m="after {index}"> after</span> '
                    f'<span data-m="block {index}" style="display:inline-block;{features}">{text}</span></div>')
    # Inherited from a parent; and in a text field (the UA resets the font
    # features on controls, an author rule sets them again; an author border,
    # as the native field face is not what this compares)
    rows.append('<div style="font:600 13px system-ui;color:#111;font-variant-numeric:tabular-nums">'
                '<p data-m="inherited" style="margin:0;display:inline-block">Frame #1000, 11 fps</p></div>')
    rows.append('<input data-m="field" value="#1111 4669" style="font:600 13px system-ui;font-variant-numeric:tabular-nums;'
                'caret-color:transparent;width:160px;border:1px solid #888;background:#fff;padding:2px">')
    rows.append('<input data-m="button" type="button" value="#1111 4669" style="font:600 13px system-ui;font-variant-numeric:tabular-nums;'
                'color:#111;border:1px solid #888;background:#fff;padding:2px">')
    return "".join(rows)


def control_markup():
    """Controls sized by text the numeric features change (intrinsic widths: Plauna asks a probe)."""
    rows = []
    for font, features, label in CONTROLS:
        style = f"font:{font};{features};padding:0;border:0;margin:0"
        for kind in ("button", "submit"):
            rows.append(f'<input data-m="{kind} {label}" type="{kind}" value="1111 7711" style="{style}">')
        for kind in ("date", "time", "month"):
            rows.append(f'<input data-m="{kind} {label}" type="{kind}" style="{style}">')
    return "".join(f"<div>{row}</div>" for row in rows)


SCALES = (1, 1.25, 1.5, 2)
WORKER_SCALES = (1, 2)

# Fonts whose control widths move with numeric features (measured at 1x: a
# 13px system-ui 600 button 48.91 plain, 60.83 tabular; 17px Calibri time field
# 105.84 plain, 102.84 proportional; 13px Arial date field 110 plain, 109 proportional)
CONTROLS = [
    ("600 13px system-ui", "font-variant-numeric:tabular-nums", "tabular"),
    ("400 13px Arial", "font-variant-numeric:proportional-nums", "arial"),
    ("400 17px Calibri", "font-feature-settings:'pnum'", "calibri"),
]

# At 2x: 1100 CSS px is 2200 device px, more than an atlas page (2048) holds
OVERSIZED_SCALE = 2
# Device px off by more than 24 over each oversized element, measured (Chrome
# 155, Windows): the squeezed rasters stretched back over their box, where the
# browser draws them whole. Images and tiles (1100 px drawn at 2200) are
# upsampled either way, and a gradient is smooth, so they match (max 18); so
# does the broad SVG image; the SVG's 1.8 px zigzag (2200 device px squeezed to
# 2044) measured 1164 px off (max 65), and 1337 (max 69) under a transform; the
# text run (about 2580 device px, squeezed to 2044, its glyphs softened along
# the line) 6785 (max 121)
OVERSIZED_ALLOWANCES = {"svg": 1300, "turned": 1500, "img": 0, "shapes": 0, "gradient": 0, "tile": 0, "text": 7500}


def oversized_markup():
    from PIL import Image
    image = Image.new("RGB", (1100, 30))
    for x in range(1100):
        shade = (x * 7) % 256
        for y in range(30):
            image.putpixel((x, y), (shade, 255 - shade, (x // 50) * 12 % 256))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    png = base64.b64encode(buffer.getvalue()).decode("ascii")
    points = " ".join(f"{x},{30 + 20 * ((x // 25) % 2)}" for x in range(0, 1101, 25))
    vector = quote('<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="30" viewBox="0 0 1100 30">'
                   '<rect width="1100" height="30" fill="#234"/><path d="M0 8 L1100 22" stroke="#fd3" stroke-width="3"/></svg>')
    drawing = (f'<polyline points="{points}" style="fill:none;stroke:#1fd2b4;stroke-width:1.8"></polyline>'
               '<circle cx="1094" cy="30" r="3" style="fill:#1fd2b4"></circle></svg>')
    return (
        f'<svg data-m="svg" width="1100" height="60" viewBox="0 0 1100 60" style="display:block">{drawing}'
        '<div style="margin:6px 0"><svg data-m="turned" width="1100" height="60" viewBox="0 0 1100 60" '
        f'style="display:block;transform:rotate(0.2deg)">{drawing}</div>'
        f'<img data-m="img" src="data:image/png;base64,{png}" width="1100" height="30" style="display:block">'
        f'<img data-m="shapes" src="data:image/svg+xml,{vector}" width="1100" height="30" style="display:block;border-radius:8px">'
        '<div data-m="gradient" style="width:1100px;height:40px;background:radial-gradient(circle at 30% 50%, #e33 0, #33e 60%, #3e3 100%)"></div>'
        f'<div data-m="tile" style="width:1100px;height:30px;background:url(data:image/png;base64,{png}) 0 0 / 100% 100% no-repeat"></div>'
        '<div data-m="text" style="font:13px Arial;color:#111;white-space:nowrap;width:1100px;overflow:hidden">'
        + "A long run of text that reaches past an atlas page at two times scale, " * 3 + "</div>"
    )


MOUNT = r"""async ([mode, html, width, worker]) => {
    const { RenderSurface } = await import('/plauna/render/RenderSurface.js');
    document.body.style.cssText = 'margin:0;background:#fff';
    document.body.innerHTML = `<div id="stage" style="position:relative;width:${width}px;padding:10px"></div>`;
    const surface = new RenderSurface({ mode, worker });
    document.getElementById('stage').append(surface.element);
    await surface.ready;
    const host = surface.mount(document.createElement('div'));
    host.innerHTML = html;
    window.__surface = surface;
    window.__host = host;
    // Rasters asked for and not given, per call site, from here on
    window.__missed = { svg: 0, image: 0, imageShapes: 0, cssGradient: 0, text: 0 };
    if (surface.raster) {
        for (const name of Object.keys(window.__missed)) {
            const own = surface.raster[name].bind(surface.raster);
            surface.raster[name] = (...args) => {
                const entry = own(...args);
                if (entry == null) window.__missed[name]++;
                return entry;
            };
        }
    }
    return { mode: surface.activeMode, worker: Boolean(surface.gpu?.worker) };
}"""

# Settle: fonts, images, then frames until no raster is in flight (bounded)
SETTLE = r"""async () => {
    const surface = window.__surface;
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
    for (let round = 0; round < 40; round++) {
        await raf();
        await raf();
        const pending = [...(surface.raster?.pending?.values() || [])];
        if (!pending.length && round >= 3) break;
        await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, 1000))]);
    }
    await raf();
    await raf();
    return surface.activeMode;
}"""

# Each [data-m] element's x (from the host) and width in Plauna's layout and in the browser's
LAYOUT = r"""() => {
    const surface = window.__surface;
    const host = window.__host;
    const boxes = surface.layout.boxes;
    const hostBox = boxes.get(host);
    const hostRect = host.getBoundingClientRect();
    return [...host.querySelectorAll('[data-m]')].map((el) => {
        const box = boxes.get(el);
        const rect = el.getBoundingClientRect();
        if (!box) return { name: el.dataset.m, missing: true };
        let x = box.absX;
        let width = box.width;
        if (box.outer === 'inline' && !box.atomic && box.absFragments?.length) {
            x = Math.min(...box.absFragments.map((f) => f.x));
            width = Math.max(...box.absFragments.map((f) => f.x + f.width)) - x;
        }
        return { name: el.dataset.m, ours: [x - hostBox.absX, width], dom: [rect.left - hostRect.left, rect.width] };
    });
}"""

# After settling: three more frames must ask for no raster they are not given
FRAMES = r"""async () => {
    const surface = window.__surface;
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    for (const name of Object.keys(window.__missed)) window.__missed[name] = 0;
    for (let i = 0; i < 3; i++) {
        surface.invalidate(true);
        surface.frame();
        await raf();
    }
    const atlas = surface.painter.atlas;
    const widest = Math.max(...[...atlas.entries.values()].map((entry) => entry.w));
    return { missed: { ...window.__missed }, pending: surface.raster.pending.size, maxRaster: surface.raster.maxRaster,
             widest, wide: [...atlas.entries.values()].filter((entry) => entry.w === surface.raster.maxRaster).length,
             pages: atlas.pages.length };
}"""

# Each [data-m] element's border box in CSS px from the viewport: name -> [x, y, width, height]
RECTS = r"""() => Object.fromEntries([...window.__host.querySelectorAll('[data-m]')].map((el) => {
    const r = el.getBoundingClientRect();
    return [el.dataset.m, [r.left, r.top, r.width, r.height]];
}))"""

# Two shapers ask for different features of one face: each must measure as the
# browser does. With `copy` the second comes from a second copy of the module
# (imported under another URL), which keeps its own module state
TWO_SHAPERS = r"""async (copy) => {
    const { TextShaper, textShaper } = await import('/plauna/render/text/TextShaper.js');
    const other = new (copy ? await import('/plauna/render/text/TextShaper.js?copy') : { TextShaper }).TextShaper();
    const style = { fontFamily: 'Arial', fontWeight: 400, fontStyle: 'normal', fontSize: 17, fontFeatureSettings: 'normal' };
    const text = '0123456789 1111';
    const dom = (numeric) => {
        const span = document.createElement('span');
        span.style.cssText = `position:absolute;white-space:nowrap;font:400 17px Arial;font-variant-numeric:${numeric}`;
        span.textContent = text;
        document.body.append(span);
        const width = span.getBoundingClientRect().width;
        span.remove();
        return width;
    };
    const asks = [[textShaper, 'tabular-nums'], [other, 'proportional-nums'], [textShaper, 'oldstyle-nums'], [other, 'tabular-nums']];
    // All the faces exist first: the latest of two with one name would hide the other
    for (const [shaper, numeric] of asks) shaper.measure('x', { ...style, fontVariantNumeric: numeric });
    const families = [];
    document.fonts.forEach((face) => families.push(face.family));
    const named = families.filter((family) => family.includes('plauna-features-'));
    return {
        rows: asks.map(([shaper, numeric]) => ({ numeric, ours: shaper.measure(text, { ...style, fontVariantNumeric: numeric }), dom: dom(numeric) })),
        shared: named.filter((family, index) => named.indexOf(family) !== index)
    };
}"""

# Faces found for features stay found across clear() (a web font loaded, a
# zoom changed) while the page's own faces do not change: finding them adds
# FontFaces to document.fonts and takes them out again, and each change there
# restyles the whole document. A face the page adds is a change: they are
# found again. Counts those changes per phase; widths against the browser's
FONT_SET = r"""async () => {
    const { textShaper } = await import('/plauna/render/text/TextShaper.js');
    const fonts = document.fonts;
    const own = { add: fonts.add, delete: fonts.delete };
    let changes = 0;
    fonts.add = function (face) { changes++; return own.add.call(this, face); };
    fonts.delete = function (face) { changes++; return own.delete.call(this, face); };
    const text = '0123456789 1111 7711';
    const asks = [
        ['400 17px Arial', 'oldstyle-nums', { fontFamily: 'Arial', fontWeight: 400, fontSize: 17 }],
        ['600 13px system-ui', 'tabular-nums', { fontFamily: 'system-ui', fontWeight: 600, fontSize: 13 }],
        ['500 13px Calibri', 'proportional-nums', { fontFamily: 'Calibri', fontWeight: 500, fontSize: 13 }]
    ];
    const dom = (font, numeric) => {
        const span = document.createElement('span');
        span.style.cssText = `position:absolute;white-space:nowrap;font:${font};font-variant-numeric:${numeric}`;
        span.textContent = text;
        document.body.append(span);
        const width = span.getBoundingClientRect().width;
        span.remove();
        return width;
    };
    const phase = (name) => {
        changes = 0;
        const rows = asks.map(([font, numeric, style]) => ({ font, numeric,
            ours: textShaper.measure(text, { ...style, fontStyle: 'normal', fontVariantNumeric: numeric, fontFeatureSettings: 'normal' }) }));
        return { name, changes, rows };
    };
    try {
        const phases = [phase('first')];
        textShaper.clear();
        phases.push(phase('after clear'));
        textShaper.setZoom(1.5);
        textShaper.setZoom(1);
        phases.push(phase('after a zoom'));
        // The page's own face joins: the next clear() finds the faces again
        const face = new FontFace('Page Face', 'local("Arial")');
        await face.load();
        own.add.call(fonts, face);
        textShaper.clear();
        phases.push(phase('after the page added a face'));
        own.delete.call(fonts, face);
        textShaper.clear();
        phases.push(phase('after the page took it out'));
        for (const each of phases) for (const row of each.rows) row.dom = dom(row.font, row.numeric);
        return phases;
    } finally {
        fonts.add = own.add;
        fonts.delete = own.delete;
    }
}"""

# A raster arrives that a full atlas has no room for until an idle entry is
# evicted, then the surface idles: it must still be placed (the atlas evicts
# an entry two frames after its last use, and nothing else asks for frames).
# One atlas page, filled by a 2000 px image that leaves as the raster arrives
# (`busy`: the image stays, so the raster can never be placed: frames must
# stop). Each `kind` is one way a raster is made: an inline SVG and a
# background image decode first, text is drawn in the frame
STALL = r"""async ([kind, busy, leaves = false]) => {
    const surface = window.__surface;
    const host = window.__host;
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    const atlas = surface.raster.atlas;
    atlas.maxPages = atlas.pages.length;
    const canvas = document.createElement('canvas');
    canvas.width = 2000;
    canvas.height = 2000;
    canvas.getContext('2d').fillRect(0, 0, 2000, 2000);
    const big = document.createElement('img');
    big.src = canvas.toDataURL();
    big.style.cssText = 'display:block;width:2000px;height:2000px';
    await big.decode();
    host.append(big);
    for (let i = 0; i < 6; i++) await raf();
    const filled = [...atlas.entries.values()].some((entry) => entry.w === 2000 && entry.h === 2000);
    const swatch = document.createElement('canvas');
    swatch.width = swatch.height = 64;
    const paint = swatch.getContext('2d');
    paint.fillStyle = '#e33';
    paint.fillRect(0, 0, 64, 64);
    const late = document.createElement('div');
    late.innerHTML = {
        svg: '<svg width="64" height="64" viewBox="0 0 64 64" style="display:block"><circle cx="32" cy="32" r="30" style="fill:#e33"></circle></svg>',
        image: `<div style="width:64px;height:64px;background:url(${swatch.toDataURL()}) 0 0 / 100% 100% no-repeat"></div>`,
        text: '<div style="font:40px Arial;color:#e33;white-space:nowrap">Late text</div>'
    }[kind];
    const ours = { svg: (key) => key.startsWith('v|'), image: (key) => key.startsWith('i|64x64|'), text: (key) => key.endsWith('Late text') }[kind];
    if (!busy) big.remove();
    // First, so it is in view whether the image stays or not
    host.prepend(late);
    if (leaves) {
        // It leaves (with the image) while it waits for room: its retry, and a
        // decode kept for it, must be forgotten a few frames later, while other
        // rasters are placed fine (no more misses to prune on)
        const retried = () => [...surface.raster.retries.keys()].some(ours);
        const waited = performance.now();
        // An svg or image decodes first: allow for a busy machine
        while (!retried() && performance.now() - waited < 5000) await new Promise((r) => setTimeout(r, 10));
        const asked = retried();
        late.remove();
        big.remove();
        const tick = document.createElement('div');
        host.prepend(tick);
        const kept = [];
        for (let i = 0; i < 8; i++) {
            tick.textContent = `tick ${i}`;
            await raf();
            await raf();
            kept.push(retried());
        }
        return { filled, asked, kept, retries: surface.raster.retries.size };
    }
    const frames = surface.stats.frames;
    const started = performance.now();
    let placedAt = null;
    while (performance.now() - started < 1500) {
        await new Promise((r) => setTimeout(r, 25));
        if (placedAt == null && [...atlas.entries.keys()].some(ours)) placedAt = Math.round(performance.now() - started);
    }
    // Frames painted in the last second: none once it is placed, or once the retries end
    const settled = surface.stats.frames;
    await new Promise((r) => setTimeout(r, 1000));
    return { filled, placedAt, pending: surface.raster.pending.size, frames: settled - frames, idleFrames: surface.stats.frames - settled };
}"""


class PlaunaTextFeaturesTests(TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from playwright.sync_api import sync_playwright
            import numpy  # noqa: F401
            from PIL import Image  # noqa: F401
            executable = chrome_path()
        except (ImportError, ValueError) as error:
            raise SkipTest(str(error)) from error
        cls.resources = ExitStack()
        try:
            cls.resources.enter_context(performance_run_lock(ROOT))
            cls.origin, _ = cls.resources.enter_context(sdk_server(ROOT))
            cls.playwright = sync_playwright().start()
            cls.resources.callback(cls.playwright.stop)
            cls.browsers = {}
            for scale in SCALES:
                args = ["--enable-unsafe-webgpu", "--disable-lcd-text", "--force-color-profile=srgb",
                        f"--force-device-scale-factor={scale}", "--window-size=1200,800"]
                browser = cls.playwright.chromium.launch(executable_path=executable, headless=True, args=args)
                cls.resources.callback(browser.close)
                cls.browsers[scale] = browser
        except BaseException:
            cls.resources.close()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.resources.close()

    def open(self, scale, mode, html, width, worker=False):
        """A page with `html` mounted in a settled surface in `mode`: (page, context)."""
        context = self.browsers[scale].new_context(no_viewport=True, service_workers="block")
        context.route(f"{self.origin}{PAGE}", lambda route: route.fulfill(body=HTML, content_type="text/html"))
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(f"{self.origin}{PAGE}")
        mounted = page.evaluate(MOUNT, [mode, html, width, worker])
        if mode == "gpu" and mounted["mode"] != "gpu":
            context.close()
            raise SkipTest("WebGPU is not available in this Chrome")
        self.assertEqual(mounted["worker"], worker and mode == "gpu", f"{scale}x: the surface did not paint where asked")
        settled = page.evaluate(SETTLE)
        self.assertEqual(settled, mode, f"{scale}x: the surface left {mode} mode while it settled")
        self.assertEqual(errors, [])
        return page, context

    def shoot(self, page):
        import numpy as np
        from PIL import Image
        return np.asarray(Image.open(io.BytesIO(page.screenshot())).convert("RGB"), dtype=np.int16)

    def test_numeric_feature_widths_match_the_browser(self):
        failures = []
        for scale in SCALES:
            page, context = self.open(scale, "gpu", sample_markup(), 760)
            try:
                for item in page.evaluate(LAYOUT):
                    if item.get("missing"):
                        failures.append(f"{scale}x {item['name']}: not in Plauna's layout")
                        continue
                    dx = abs(item["ours"][0] - item["dom"][0])
                    dw = abs(item["ours"][1] - item["dom"][1])
                    if max(dx, dw) > 0.01:
                        failures.append(f"{scale}x {item['name']}: x/width {item['ours']} in Plauna, {item['dom']} in the browser")
            finally:
                context.close()
        self.assertEqual(failures, [])

    def test_control_widths_follow_numeric_features(self):
        failures = []
        for scale in SCALES:
            page, context = self.open(scale, "gpu", control_markup(), 760)
            try:
                for item in page.evaluate(LAYOUT):
                    if item.get("missing"):
                        failures.append(f"{scale}x {item['name']}: not in Plauna's layout")
                    elif abs(item["ours"][1] - item["dom"][1]) > 0.01:
                        failures.append(f"{scale}x {item['name']}: width {item['ours'][1]} in Plauna, {item['dom'][1]} in the browser")
            finally:
                context.close()
        self.assertEqual(failures, [])

    def test_two_shapers_keep_their_faces_apart(self):
        failures = []
        for copy in (False, True):
            page, context = self.open(1, "gpu", "<div>x</div>", 200)
            try:
                result = page.evaluate(TWO_SHAPERS, copy)
            finally:
                context.close()
            where = "a second copy of the module" if copy else "one module"
            failures += [f"{where}: {row}" for row in result["rows"] if abs(row["ours"] - row["dom"]) > 0.02]
            if result["shared"]:
                failures.append(f"{where}: FontFaces share the family names {result['shared']}")
        self.assertEqual(failures, [])

    def test_feature_faces_are_kept_while_the_page_fonts_stay(self):
        page, context = self.open(1, "gpu", "<div>x</div>", 200)
        try:
            phases = page.evaluate(FONT_SET)
        finally:
            context.close()
        failures = []
        for phase in phases:
            for row in phase["rows"]:
                if abs(row["ours"] - row["dom"]) > 0.02:
                    failures.append(f"{phase['name']}: {row}")
        changes = {phase["name"]: phase["changes"] for phase in phases}
        # Finding the faces changes document.fonts; a clear() or a zoom that leaves
        # the page's own faces as they were finds nothing again; a face the page
        # adds or takes out has them found again
        expected = {"first": True, "after clear": False, "after a zoom": False,
                    "after the page added a face": True, "after the page took it out": True}
        for name, changed in expected.items():
            if bool(changes.get(name)) != changed:
                failures.append(f"{name}: {changes.get(name)} changes to document.fonts")
        self.assertEqual(failures, [])

    def test_a_raster_the_full_atlas_cannot_place_yet_is_placed_once_it_can(self):
        failures = []
        for kind in ("svg", "image", "text"):
            for busy in (False, True):
                page, context = self.open(1, "gpu", "<div>x</div>", 2020)
                try:
                    result = page.evaluate(STALL, [kind, busy])
                finally:
                    context.close()
                if not result["filled"]:
                    failures.append(f"{kind}: the 2000 px image never filled the atlas page: {result}")
                elif busy:
                    # Never placed: the frames asked for stop (measured 3 or 4; asking
                    # every frame would paint about 90 in the 1.5 s)
                    if result["placedAt"] is not None or result["frames"] > 8 or result["idleFrames"]:
                        failures.append(f"{kind} with the image staying: {result}")
                elif result["placedAt"] is None or result["pending"] or result["idleFrames"]:
                    failures.append(f"{kind}: {result}")
        self.assertEqual(failures, [])

    def test_a_raster_that_leaves_while_it_waits_for_room_is_forgotten(self):
        failures = []
        for kind in ("svg", "image", "text"):
            page, context = self.open(1, "gpu", "<div>x</div>", 2020)
            try:
                result = page.evaluate(STALL, [kind, True, True])
            finally:
                context.close()
            # Asked for again, then gone by the last of the frames that follow
            if not result["filled"] or not result["asked"] or result["kept"][-1] or result["retries"]:
                failures.append(f"{kind}: {result}")
        self.assertEqual(failures, [])

    def glyph_failures(self, scales, worker):
        import numpy as np
        failures = []
        for scale in scales:
            shots = {}
            for mode in ("dom", "gpu"):
                page, context = self.open(scale, mode, sample_markup(), 760, worker)
                try:
                    shots[mode] = self.shoot(page)
                finally:
                    context.close()
            diff = np.abs(shots["dom"] - shots["gpu"]).max(axis=2)
            off = int((diff > 24).sum())
            if off:
                ys, xs = np.nonzero(diff > 24)
                failures.append(f"{scale}x: {off} pixels differ (max {int(diff.max())}) in "
                                f"[{xs.min() / scale:.0f}, {ys.min() / scale:.0f}, {xs.max() / scale:.0f}, {ys.max() / scale:.0f}] CSS px")
        return failures

    def test_numeric_feature_glyphs_match_the_browser(self):
        self.assertEqual(self.glyph_failures(SCALES, False), [])

    def test_numeric_feature_glyphs_match_the_browser_in_a_paint_worker(self):
        self.assertEqual(self.glyph_failures(WORKER_SCALES, True), [])

    def test_rasters_larger_than_an_atlas_page_are_placed(self):
        import numpy as np
        html = oversized_markup()
        page, context = self.open(OVERSIZED_SCALE, "gpu", html, 1120)
        try:
            frames = page.evaluate(FRAMES)
            rects = page.evaluate(RECTS)
            gpu = self.shoot(page)
        finally:
            context.close()
        self.assertEqual(sum(frames["missed"].values()), 0, f"frames still ask for rasters they are not given: {frames}")
        self.assertEqual(frames["pending"], 0, f"rasters still pending after settling: {frames}")
        # Every oversized raster, squeezed to the widest a page holds: two SVGs, the
        # image, two shapes of the SVG image, the gradient, the tile, the text run
        self.assertGreaterEqual(frames["wide"], 8, f"oversized rasters not placed at the page's width: {frames}")
        self.assertLessEqual(frames["widest"], frames["maxRaster"])
        page, context = self.open(OVERSIZED_SCALE, "dom", html, 1120)
        try:
            dom = self.shoot(page)
        finally:
            context.close()
        diff = np.abs(dom - gpu).max(axis=2)
        failures = []
        for name, (x, y, w, h) in rects.items():
            x0, y0 = int(x * OVERSIZED_SCALE), int(y * OVERSIZED_SCALE)
            x1, y1 = int((x + w) * OVERSIZED_SCALE + 0.999), int((y + h) * OVERSIZED_SCALE + 0.999)
            region = diff[y0:y1, x0:x1]
            off = int((region > 24).sum())
            if off > OVERSIZED_ALLOWANCES[name]:
                failures.append(f"{name}: {off} pixels differ (max {int(region.max())}), allowed {OVERSIZED_ALLOWANCES[name]}")
        # Nothing else on the stage differs
        outside = diff > 24
        for x, y, w, h in rects.values():
            outside[int(y * OVERSIZED_SCALE):int((y + h) * OVERSIZED_SCALE + 0.999), int(x * OVERSIZED_SCALE):int((x + w) * OVERSIZED_SCALE + 0.999)] = False
        if outside.any():
            failures.append(f"{int(outside.sum())} pixels differ outside the oversized elements")
        self.assertEqual(failures, [])


if __name__ == "__main__":
    main()
