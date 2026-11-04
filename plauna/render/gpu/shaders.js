// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * WGSL for Plauna's GPU painter: one instanced quad per display item.
 *
 * Item kinds:
 *   0 box       rounded rect fill with a per-side border ring
 *   1 glyphs    atlas alpha mask tinted by colour (text runs)
 *   2 image     atlas RGBA (images, SVG, emoji, native control sprites)
 *   3 gradient  linear gradient strip from the atlas, masked by the shape
 *   4 shadow    blurred outer shadow, cut out under the element
 *   5 inset     blurred inset shadow inside the padding box
 *   6 hole      clears the target inside a rounded rect (a native-content
 *               well: what lies below the canvas shows through), drawn by
 *               GpuPainter's erase pipeline: target x (1 - coverage)
 *
 * Coordinates are scene pixels. Each item carries a 2D affine transform, a
 * rounded clip rectangle in transformed scene space and an optional colour
 * filter (CSS filter colour functions, composed per stacking context).
 * Output is premultiplied alpha.
 */

export const FLOATS_PER_ITEM = 68; // 17 x vec4f
export const FLOATS_PER_FILTER = 16; // 4 x vec4f

export const KIND = Object.freeze({ BOX: 0, GLYPHS: 1, IMAGE: 2, GRADIENT: 3, SHADOW: 4, INSET: 5, HOLE: 6 });

// The item page of a hole: drawn with the erase pipeline (it samples no texture)
export const HOLE_PAGE = 65535;

// Image item flag: sample the nearest texel (image-rendering: pixelated or crisp-edges)
export const NEAREST = 2097152;

export const PAINTER_SHADER = /* wgsl */`
struct View {
    origin: vec2f,
    size: vec2f,
    dpr: f32,
    time: f32,
    pad: vec2f,
};

struct Item {
    rect: vec4f,
    shape: vec4f,
    radii: vec4f,
    color: vec4f,
    border: vec4f,
    borderColor: vec4f,
    shape2: vec4f,
    radii2: vec4f,
    uv: vec4f,
    clip: vec4f,
    clipRadii: vec4f,
    m0: vec4f,
    m1: vec4f,
    extra: vec4f,
    fx: vec4f,      // x: colour filter index, -1 for none
    clip2: vec4f,   // a second rounded clip (x0, y0, x1, y1), none when empty
    clip2Radii: vec4f,
};

// rgb' = k * (m * rgb + o * a), a' = k * a on premultiplied colour
struct ColorFilter {
    r0: vec4f,
    r1: vec4f,
    r2: vec4f,
    ok: vec4f,
};

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> items: array<Item>;
@group(0) @binding(2) var atlasSampler: sampler;
@group(0) @binding(3) var atlas: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> filters: array<ColorFilter>;

struct VOut {
    @builtin(position) position: vec4f,
    @location(0) local: vec2f,
    @location(1) world: vec2f,
    @location(2) uv: vec2f,
    @location(3) @interpolate(flat) index: u32,
};

@vertex
fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> VOut {
    var corners = array<vec2f, 6>(
        vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
        vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
    let item = items[instance];
    let c = corners[vertex];
    // Boxes and shadows reach a device pixel past their rect: their coverage
    // comes from their shape, and an edge at a fractional place (under a
    // translate) keeps the anti-aliased pixel row past it
    let kind = u32(item.m1.z + 0.5);
    let pad = select(0.0, 1.0 / max(view.dpr, 1e-3), kind == 0u || kind == 4u || kind == 5u || kind == 6u);
    let local = item.rect.xy - vec2f(pad) + c * (item.rect.zw + vec2f(2.0 * pad));
    let world = vec2f(
        item.m0.x * local.x + item.m0.z * local.y + item.m1.x,
        item.m0.y * local.x + item.m0.w * local.y + item.m1.y);
    var out: VOut;
    let ndc = (world - view.origin) / view.size;
    out.position = vec4f(ndc.x * 2.0 - 1.0, 1.0 - ndc.y * 2.0, 0.0, 1.0);
    out.local = local;
    out.world = world;
    out.uv = mix(item.uv.xy, item.uv.zw, c);
    out.index = instance;
    return out;
}

// Signed distance to a rounded rectangle (x, y, w, h) with radii (tl, tr, br, bl)
fn sdRoundRect(p: vec2f, rect: vec4f, radii: vec4f) -> f32 {
    let half = rect.zw * 0.5;
    let q0 = p - (rect.xy + half);
    // left column: tl/bl ; right column: tr/br
    let leftR = select(radii.w, radii.x, q0.y < 0.0);
    let rightR = select(radii.z, radii.y, q0.y < 0.0);
    let r = select(leftR, rightR, q0.x > 0.0);
    let q = abs(q0) - half + vec2f(r);
    return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn coverage(d: f32, px: f32) -> f32 {
    return clamp(0.5 - d / max(px, 1e-4), 0.0, 1.0);
}

// Coverage of a filled rounded rect whose corners differ, as Skia's
// FillRRectOp draws it (equal corners take the exact circle): in a corner,
// 0.5 - fn / fwidth(fn) with fn = |q / r|^2 - 1 and fwidth the L1 size of
// its gradient, so the edge blurs wider towards the corner's middle. Along
// the straight edges, and for a square corner, it is the plain distance d
fn complexRRectCoverage(p: vec2f, rect: vec4f, radii: vec4f, d: f32, px: f32) -> f32 {
    let half = rect.zw * 0.5;
    let q0 = p - (rect.xy + half);
    let leftR = select(radii.w, radii.x, q0.y < 0.0);
    let rightR = select(radii.z, radii.y, q0.y < 0.0);
    let r = select(leftR, rightR, q0.x > 0.0);
    let q = abs(q0) - half + vec2f(r);
    if (r <= 0.0 || q.x <= 0.0 || q.y <= 0.0) { return coverage(d, px); }
    let n = q / r;
    let f = dot(n, n) - 1.0;
    let fw = (2.0 * q.x + 2.0 * q.y) / (r * r) * px;
    return clamp(0.5 - f / max(fw, 1e-6), 0.0, 1.0);
}

// Coverage of a rounded clip rect at p: the distance ramp, or (implicit) the
// corner coverage Skia gives a rect drawn as the clip's shape,
// 0.5 - f / fwidth(f) for f = |q / r|^2 - 1 with the L1 size of its gradient
// (complexRRectCoverage), a softer edge across a corner's middle
fn clipCoverage(p: vec2f, rect: vec4f, radii: vec4f, px: f32, implicit: bool) -> f32 {
    let d = sdRoundRect(p, rect, radii);
    if (implicit) { return complexRRectCoverage(p, rect, radii, d, px); }
    return coverage(d, px);
}

// Whether a rounded clip is a circle: a square whose corners all reach half its side
fn isCircle(rect: vec4f, radii: vec4f) -> bool {
    let half = rect.z * 0.5;
    return abs(rect.z - rect.w) < 1e-3 && min(min(radii.x, radii.y), min(radii.z, radii.w)) >= half - 1e-3 && half > 0.0;
}

// Whether a rect drawn over [lo, hi] meets a rounded clip (x0, y0, x1, y1)
// in a rounded corner and holds every corner it reaches: their intersection
// is then a rounded rect, which the browser draws as one shape
fn drawnAsClip(lo: vec2f, hi: vec2f, clip: vec4f, radii: vec4f) -> bool {
    // Each corner's square: top left, top right, bottom right, bottom left
    var corners = array<vec4f, 4>(
        vec4f(clip.x, clip.y, clip.x + radii.x, clip.y + radii.x),
        vec4f(clip.z - radii.y, clip.y, clip.z, clip.y + radii.y),
        vec4f(clip.z - radii.z, clip.w - radii.z, clip.z, clip.w),
        vec4f(clip.x, clip.w - radii.w, clip.x + radii.w, clip.w));
    var met = false;
    for (var k = 0; k < 4; k++) {
        let c = corners[k];
        if (c.z <= c.x || lo.x >= c.z || hi.x <= c.x || lo.y >= c.w || hi.y <= c.y) { continue; }
        if (lo.x > c.x || lo.y > c.y || hi.x < c.z || hi.y < c.w) { return false; }
        met = true;
    }
    return met;
}

fn erfApprox(x: f32) -> f32 {
    let s = sign(x);
    let a = abs(x);
    let t = 1.0 / (1.0 + 0.3275911 * a);
    let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
    return s * y;
}

fn gaussian(x: f32, sigma: f32) -> f32 {
    return exp(-(x * x) / (2.0 * sigma * sigma)) / (2.50662827 * sigma);
}

// A blurred rounded rectangle as the browser draws box-shadow (sigma = blur / 2):
// exact along x, four Gaussian samples along y (Evan Wallace's method). A small
// shape under a large blur fades as a real 2D blur does, unlike blurring the
// distance to its edge. The corner radius is the one of the point's quadrant.
fn shadowRow(x: f32, y: f32, sigma: f32, corner: f32, halfSize: vec2f) -> f32 {
    let delta = min(halfSize.y - corner - abs(y), 0.0);
    let curved = halfSize.x - corner + sqrt(max(0.0, corner * corner - delta * delta));
    let k = 0.70710678 / sigma;
    return 0.5 * (erfApprox((x + curved) * k) - erfApprox((x - curved) * k));
}

fn roundedShadow(p: vec2f, shape: vec4f, radii: vec4f, blur: f32, px: f32) -> f32 {
    if (blur <= 0.5) {
        return coverage(sdRoundRect(p, shape, radii), px);
    }
    let sigma = blur * 0.5;
    let halfSize = shape.zw * 0.5;
    let q = p - (shape.xy + halfSize);
    let leftR = select(radii.w, radii.x, q.y < 0.0);
    let rightR = select(radii.z, radii.y, q.y < 0.0);
    let corner = min(select(leftR, rightR, q.x > 0.0), min(halfSize.x, halfSize.y));
    let first = clamp(-3.0 * sigma, q.y - halfSize.y, q.y + halfSize.y);
    let last = clamp(3.0 * sigma, q.y - halfSize.y, q.y + halfSize.y);
    let stride = (last - first) / 4.0;
    var y = first + stride * 0.5;
    var total = 0.0;
    for (var i = 0; i < 4; i++) {
        total += shadowRow(q.x, q.y - y, sigma, corner, halfSize) * gaussian(y, sigma) * stride;
        y += stride;
    }
    return total;
}

// Which border side a point in the ring belongs to (0 top, 1 right, 2 bottom, 3 left)
fn borderSide(p: vec2f, shape: vec4f, widths: vec4f) -> u32 {
    let dt = (p.y - shape.y) / max(widths.x, 1e-3);
    let dr = (shape.x + shape.z - p.x) / max(widths.y, 1e-3);
    let db = (shape.y + shape.w - p.y) / max(widths.z, 1e-3);
    let dl = (p.x - shape.x) / max(widths.w, 1e-3);
    var side = 0u;
    var best = dt;
    if (dr < best) { best = dr; side = 1u; }
    if (db < best) { best = db; side = 2u; }
    if (dl < best) { best = dl; side = 3u; }
    return side;
}

// How much of a border pixel an item paints that draws the sides in mask, as
// (colour share, alpha share). Sides of different colours or styles meet on
// the corner's diagonal, anti-aliased as the browser draws them: the seam
// pixel is the two colours mixed by their shares, laid over the background
// once, as Chrome's single layer for sides of one opacity does. Of two items
// sharing a seam, the earlier (the other side in later) sets the pixel's full
// alpha and the later (the other side in earlier) adds only its colour share
fn borderShare(p: vec2f, shape: vec4f, widths: vec4f, mask: u32, later: u32, earlier: u32, px: f32) -> vec2f {
    let w = max(widths, vec4f(1e-3));
    let d = vec4f(p.y - shape.y, shape.x + shape.z - p.x, shape.y + shape.w - p.y, p.x - shape.x) / w;
    var s1 = 0u;
    var best = d.x;
    if (d.y < best) { best = d.y; s1 = 1u; }
    if (d.z < best) { best = d.z; s1 = 2u; }
    if (d.w < best) { best = d.w; s1 = 3u; }
    // The nearer of its two neighbours shares the seam
    let a = (s1 + 1u) % 4u;
    let b = (s1 + 3u) % 4u;
    let s2 = select(b, a, d[a] < d[b]);
    let own1 = (mask & (1u << s1)) != 0u;
    let own2 = (mask & (1u << s2)) != 0u;
    if (own1 == own2) { return vec2f(select(0.0, 1.0, own1)); }
    // Signed distance from the seam, positive on the nearest side's half
    let dist = (d[s2] - d[s1]) / length(vec2f(1.0 / w[s1], 1.0 / w[s2]));
    let c1 = coverage(-dist, px);
    let mine = select(1.0 - c1, c1, own1);
    let other = 1u << select(s1, s2, own1);
    if ((later & other) != 0u) { return vec2f(mine, select(0.0, 1.0, mine > 0.0)); }
    if ((earlier & other) != 0u) { return vec2f(mine, select(0.0, 1.0, mine >= 1.0)); }
    return vec2f(mine);
}

// A point of the quarter circle conic Skia draws a corner with, (r, 0) to (0, r)
fn conicPoint(t: f32, r: f32) -> vec2f {
    let s = 1.0 - t;
    let a = s * s;
    let b = 1.41421356 * t * s;
    let c = t * t;
    return vec2f(a + b, b + c) / (a + b + c) * r;
}

// How far along a corner of radius r (device pixels) the point at angle theta
// from its start lies, as Skia measures it: the conic's parameter there,
// placed on the chords Skia cuts it into (halves split while their midpoint
// strays over half a pixel from their chord)
fn conicDistance(theta: f32, r: f32) -> f32 {
    let v = tan(clamp(theta, 0.0, 1.57079633) * 0.5);
    let t = 1.41421356 * v / (1.0 + 0.41421356 * v);
    var lo: array<f32, 16>;
    var hi: array<f32, 16>;
    lo[0] = 0.0;
    hi[0] = 1.0;
    var n = 1;
    var dist = 0.0;
    for (var i = 0; i < 96 && n > 0; i++) {
        n -= 1;
        let a = lo[n];
        let b = hi[n];
        let pa = conicPoint(a, r);
        let pb = conicPoint(b, r);
        let m = (a + b) * 0.5;
        let stray = abs(conicPoint(m, r) - (pa + pb) * 0.5);
        if (max(stray.x, stray.y) > 0.5 && b - a > 1e-6 && n < 14) {
            lo[n] = m;
            hi[n] = b;
            lo[n + 1] = a;
            hi[n + 1] = m;
            n += 2;
            continue;
        }
        let chord = length(pb - pa);
        if (t <= b) {
            return dist + (t - a) / max(b - a, 1e-9) * chord;
        }
        dist += chord;
    }
    return dist;
}

// Where q lies along a rounded border's centreline (c, radii r), clockwise
// from the top-left corner's end; corners at their measured lengths (lens)
fn pathPosition(q: vec2f, c: vec4f, r: vec4f, lens: vec4f, dpr: f32) -> f32 {
    let right = c.x + c.z;
    let bottom = c.y + c.w;
    let topLen = c.z - r.x - r.y;
    let rightLen = c.w - r.y - r.z;
    let bottomLen = c.z - r.z - r.w;
    let sTR = topLen;
    let sRight = sTR + lens.y;
    let sBR = sRight + rightLen;
    let sBottom = sBR + lens.z;
    let sBL = sBottom + bottomLen;
    let sLeft = sBL + lens.w;
    let total = sLeft + c.w - r.w - r.x + lens.x;
    var s: f32;
    if (r.y > 0.0 && q.x > right - r.y && q.y < c.y + r.y) {
        let v = q - vec2f(right - r.y, c.y + r.y);
        s = sTR + conicDistance(atan2(v.x, -v.y), r.y * dpr) / dpr;
    } else if (r.z > 0.0 && q.x > right - r.z && q.y > bottom - r.z) {
        let v = q - vec2f(right - r.z, bottom - r.z);
        s = sBR + conicDistance(atan2(v.y, v.x), r.z * dpr) / dpr;
    } else if (r.w > 0.0 && q.x < c.x + r.w && q.y > bottom - r.w) {
        let v = q - vec2f(c.x + r.w, bottom - r.w);
        s = sBL + conicDistance(atan2(-v.x, v.y), r.w * dpr) / dpr;
    } else if (r.x > 0.0 && q.x < c.x + r.x && q.y < c.y + r.x) {
        let v = q - vec2f(c.x + r.x, c.y + r.x);
        s = sLeft + c.w - r.w - r.x + conicDistance(atan2(-v.y, -v.x), r.x * dpr) / dpr;
    } else {
        let d = vec4f(abs(q.y - c.y), abs(right - q.x), abs(bottom - q.y), abs(q.x - c.x));
        if (d.x <= min(d.y, min(d.z, d.w))) {
            s = q.x - c.x - r.x;
        } else if (d.y <= min(d.z, d.w)) {
            s = sRight + q.y - c.y - r.y;
        } else if (d.z <= d.w) {
            s = sBottom + right - r.z - q.x;
        } else {
            s = sLeft + bottom - r.w - q.y;
        }
    }
    return s - floor(s / total) * total;
}

// Whether sample q of a rounded border lies in its dash pattern: uv = (dash,
// period, half the stroke's width, mode), mode bit 1 for round dots
fn dashCovers(q: vec2f, item: Item, total: f32, dpr: f32) -> bool {
    let c = item.shape2;
    let r = item.radii2;
    let period = max(item.uv.y, 1e-3);
    let across = sdRoundRect(q, c, r);
    let s = pathPosition(q, c, r, item.extra, dpr);
    if ((u32(item.uv.w + 0.5) & 1u) == 0u) {
        // Butt-ended dashes of a stroke wider than the ring
        return abs(across) <= item.uv.z && s - floor(s / period) * period < item.uv.x;
    }
    // Round dots every period from the start, the last one where the
    // pattern reaches the loop's measured end
    let k = floor(s / period);
    var along = min(s - k * period, (k + 1.0) * period - s);
    if ((k + 1.0) * period >= total) { along = min(s - k * period, total - s); }
    if (s < period) { along = min(along, s + total - floor((total - 1e-3) / period) * period); }
    return length(vec2f(along, across)) <= item.uv.z;
}

// The "on" length of a dash pattern (a dash every period from 0) before s
fn dashedLength(s: f32, dash: f32, period: f32) -> f32 {
    let k = floor(s / period);
    return k * dash + min(s - k * period, dash);
}

// The share of a pixel a rounded border's dash pattern covers, rasterised as
// the browser does it. A loop whose stroke fits 256x256 device pixels (mode
// bit 2 clear) is drawn with the GPU's standard eight samples; a larger one
// in Skia's analytic coverage: exact across x, edges' y on quarter pixels,
// which is four rows of exact horizontal coverage. dx and dy step one device
// pixel in local coordinates
fn pathDashes(p: vec2f, dx: vec2f, dy: vec2f, item: Item, dpr: f32) -> f32 {
    let c = item.shape2;
    let r = item.radii2;
    let total = 2.0 * (c.z + c.w) - 2.0 * (r.x + r.y + r.z + r.w) + item.extra.x + item.extra.y + item.extra.z + item.extra.w;
    let mode = u32(item.uv.w + 0.5);
    var on = 0.0;
    if ((mode & 2u) == 0u) {
        var offsets = array<vec2f, 8>(
            vec2f(1.0, -3.0), vec2f(-1.0, 3.0), vec2f(5.0, 1.0), vec2f(-3.0, -5.0),
            vec2f(-5.0, 5.0), vec2f(-7.0, -1.0), vec2f(3.0, 7.0), vec2f(7.0, -7.0));
        for (var i = 0; i < 8; i++) {
            if (dashCovers(p + dx * (offsets[i].x / 16.0) + dy * (offsets[i].y / 16.0), item, total, dpr)) { on += 1.0; }
        }
        return on / 8.0;
    }
    let right = c.x + c.z;
    let bottom = c.y + c.w;
    for (var k = 0; k < 4; k++) {
        let q = p + dy * ((f32(k) + 0.5) * 0.25 - 0.5);
        let inCorner = (q.x < c.x + max(r.x, r.w) || q.x > right - max(r.y, r.z)) && (q.y < c.y + max(r.x, r.y) || q.y > bottom - max(r.z, r.w));
        let d = vec4f(abs(q.y - c.y), abs(right - q.x), abs(bottom - q.y), abs(q.x - c.x));
        let horizontal = min(d.x, d.z) <= min(d.y, d.w);
        if (!inCorner && horizontal && (mode & 1u) == 0u) {
            // Along the top or bottom the pattern runs across the row: its
            // exact share of the pixel's width
            if (abs(sdRoundRect(q, c, r)) > item.uv.z) { continue; }
            let s = pathPosition(q, c, r, item.extra, dpr);
            let halfWidth = abs(dx.x) * 0.5;
            let period = max(item.uv.y, 1e-3);
            on += (dashedLength(s + halfWidth, item.uv.x, period) - dashedLength(s - halfWidth, item.uv.x, period)) / max(2.0 * halfWidth, 1e-6);
        } else {
            for (var i = 0; i < 4; i++) {
                if (dashCovers(q + dx * ((f32(i) + 0.5) * 0.25 - 0.5), item, total, dpr)) { on += 0.25; }
            }
        }
    }
    return on / 4.0;
}

// Colour (straight alpha) of a linear gradient at q in its tile of that size.
// Its position along the gradient line through the tile's centre, as a
// fraction of the strip from its start: extra.xy is the line's direction over
// the strip's length, extra.z where the tile's centre falls. A repeating
// gradient's strip is one period (first stop to last), repeated. Texel i of
// the strip (atlas rect strip) holds the colour at (i + 0.5) / n of it. Two
// neighbours blend unless its third row marks a hard stop between them: then
// the point takes its side's colour, as Chrome does per pixel
fn linearGradientAt(q: vec2f, size: vec2f, extra: vec4f, strip: vec4f) -> vec4f {
    let t0 = dot(q - size * 0.5, extra.xy) + extra.z;
    let t = select(clamp(t0, 0.0, 1.0), fract(t0), extra.w > 0.5);
    let dim = vec2f(textureDimensions(atlas));
    let x0 = round(strip.x * dim.x);
    let n = round(strip.z * dim.x) - x0;
    let y0 = i32(round(strip.y * dim.y));
    let u = clamp(t * n - 0.5, 0.0, n - 1.0);
    let i = min(floor(u), n - 2.0);
    let f = u - i;
    let left = textureLoad(atlas, vec2i(i32(x0 + i), y0), 0);
    let right = textureLoad(atlas, vec2i(i32(x0 + i + 1.0), y0), 0);
    let hard = textureLoad(atlas, vec2i(i32(x0 + i), y0 + 2), 0);
    let place = (round(hard.g * 255.0) * 256.0 + round(hard.b * 255.0)) / 65536.0;
    return select(mix(left, right, f), select(left, right, f >= place), hard.r > 0.5);
}

// A texel of the image the browser paints a repeating tile from: the gradient
// at q, premultiplied, 8 bits a channel
fn tileImageTexel(q: vec2f, size: vec2f, extra: vec4f, strip: vec4f) -> vec4f {
    let c = linearGradientAt(q, size, extra, strip);
    return round(vec4f(c.rgb * c.a, c.a) * 255.0) / 255.0;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
    let item = items[in.index];
    // Derivatives stay in uniform control flow; textures read at level 0
    let px = max(length(vec2f(dpdx(in.local.x), dpdy(in.local.x))), length(vec2f(dpdx(in.local.y), dpdy(in.local.y))));
    let localDx = dpdx(in.local);
    let localDy = dpdy(in.local);
    let wpx = max(length(vec2f(dpdx(in.world.x), dpdy(in.world.x))), length(vec2f(dpdx(in.world.y), dpdy(in.world.y))));
    let tex = textureSampleLevel(atlas, atlasSampler, in.uv, 0.0);
    let kind = u32(item.m1.z + 0.5);
    let flags = u32(item.m1.w + 0.5);

    // Clip (rounded, in transformed scene space)
    // Measured in a composited layer, as Plauna's surfaces are: a rect drawn
    // over a rounded clip's corners is drawn with the clip as one rounded
    // rect (drawnAsClip), with its implicit corner coverage (clipCoverage)
    // when it is a gradient or an image, or a fill of one colour in a circle;
    // anything else is cut with the distance ramp. One shape of an SVG image
    // counts as a fill of one colour (1048576) when it is a rect of one colour
    // over all of the image, as nothing (524288) when it is not such a rect.
    // (In a page's own layer every draw takes the ramp, but a fill in a circle.)
    let fill = (kind == 0u && max(max(item.border.x, item.border.y), max(item.border.z, item.border.w)) <= 0.0)
        || (kind == 2u && (flags & 1048576u) != 0u);
    let painted = (kind == 2u && (flags & 1572864u) == 0u) || kind == 3u;
    let square = all(item.radii == vec4f(0.0)) && (fill || painted);
    let s0 = item.m0.xy * item.shape.x + item.m0.zw * item.shape.y + item.m1.xy;
    let s1 = item.m0.xy * (item.shape.x + item.shape.z) + item.m0.zw * (item.shape.y + item.shape.w) + item.m1.xy;
    let shapeLo = min(s0, s1) - vec2f(1e-3);
    let shapeHi = max(s0, s1) + vec2f(1e-3);
    let clipRect = vec4f(item.clip.xy, item.clip.zw - item.clip.xy);
    var clipCov = clipCoverage(in.world, clipRect, item.clipRadii, wpx,
        square && drawnAsClip(shapeLo, shapeHi, item.clip, item.clipRadii) && (painted || isCircle(clipRect, item.clipRadii)));
    if (item.clip2.z > item.clip2.x) {
        let clip2Rect = vec4f(item.clip2.xy, item.clip2.zw - item.clip2.xy);
        clipCov = clipCov * clipCoverage(in.world, clip2Rect, item.clip2Radii, wpx,
            square && drawnAsClip(shapeLo, shapeHi, item.clip2, item.clip2Radii) && (painted || isCircle(clip2Rect, item.clip2Radii)));
    }

    var rgb = vec3f(0.0);
    var alpha = 0.0;
    let dShape = sdRoundRect(in.local, item.shape, item.radii);
    // A filled box whose corners differ takes Skia's softer corner coverage
    let r4 = item.radii;
    let mixedCorners = kind == 0u && (r4.x != r4.y || r4.y != r4.z || r4.z != r4.w)
        && max(max(item.border.x, item.border.y), max(item.border.z, item.border.w)) <= 0.0;
    let shapeCov = select(coverage(dShape, px), complexRRectCoverage(in.local, item.shape, r4, dShape, px), mixedCorners);

    if (kind == 0u) {
        // Fill under the border, then the border ring on top
        let fillA = select(item.color.a * shapeCov, 0.0, (flags & 16u) != 0u);
        rgb = item.color.rgb * fillA;
        alpha = fillA;
        let w = item.border;
        if (max(max(w.x, w.y), max(w.z, w.w)) > 0.0) {
            let inner = vec4f(item.shape.x + w.w, item.shape.y + w.x,
                max(0.0, item.shape.z - w.w - w.y), max(0.0, item.shape.w - w.x - w.z));
            let innerRadii = max(item.radii - vec4f(max(w.x, w.w), max(w.x, w.y), max(w.z, w.y), max(w.z, w.w)), vec4f(0.0));
            // The ring's share of the pixel is the outer shape's less the inner
            // one's (the inner lies within it): where a side has no width the
            // two edges coincide and the ring vanishes, as in the browser
            let innerCov = coverage(sdRoundRect(in.local, inner, innerRadii), px);
            var ring = max(0.0, shapeCov - innerCov);
            var ringAlpha = ring;
            // A rounded ridge or groove is painted as Chrome paints it: the whole
            // border in its outer shading (131072), then again in its inner
            // shading (65536) clipped to the rect within its outer halves
            // (shape2), both in one layer that is laid over the page at the
            // colour's alpha. The outer item is weighed so that the inner one,
            // laid over it as usual, lands on that layer's result
            if ((flags & 196608u) != 0u) {
                let k = coverage(sdRoundRect(in.local, item.shape2, item.radii2), px);
                if ((flags & 65536u) != 0u) {
                    ring = ring * k;
                    ringAlpha = ring;
                } else {
                    let a = max(item.borderColor.a, 1e-4);
                    let rk = ring * k;
                    let rest = 1.0 - a * rk;
                    let layerAlpha = ring * (1.0 + k - rk);
                    ringAlpha = select((1.0 - (1.0 - a * layerAlpha) / rest) / a, 0.0, rest < 1e-4);
                    ring = select(ring * (1.0 - rk) / rest, 0.0, rest < 1e-4);
                }
            }
            let side = borderSide(in.local, item.shape, w);
            let mask = flags & 15u;
            let share = borderShare(in.local, item.shape, w, mask, (flags >> 8u) & 15u, (flags >> 12u) & 15u, px);
            var sideOn = 1.0;
            // Dashed (32) and dotted (64) borders as Chrome draws them: dashes of
            // 3x the width with 2x gaps under 3px, 2x and 1x from 3px; dots one
            // width apart, round from 3px. Gaps stretch so each side starts and
            // ends on a full dash; a side too short for two stays solid.
            // A side whose inner edge curves at either end (262144) follows the
            // pattern round the centreline instead; its ring is the outer shape
            // clipped out of the inner one, as the browser clips it
            let arcs = select(
                select(innerRadii.z + innerRadii.w, innerRadii.x + innerRadii.w, side == 3u),
                select(innerRadii.x + innerRadii.y, innerRadii.y + innerRadii.z, side == 1u),
                side < 2u) > 0.0;
            if ((flags & 262144u) != 0u && arcs) {
                ring = shapeCov * (1.0 - innerCov);
                ringAlpha = ring;
                sideOn = pathDashes(in.local, localDx, localDy, item, view.dpr);
            } else if ((flags & 96u) != 0u) {
                let horizontal = side == 0u || side == 2u;
                let along = select(in.local.y - item.shape.y, in.local.x - item.shape.x, horizontal);
                let sideLength = select(item.shape.w, item.shape.z, horizontal);
                let thickness = max(select(select(w.w, w.y, side == 1u), select(w.z, w.x, side == 0u), horizontal), 1.0);
                let dotted = (flags & 64u) != 0u;
                let thick = thickness >= 3.0;
                let dash = select(select(thickness * 3.0, thickness * 2.0, thick), thickness, dotted);
                let gap = select(select(thickness * 2.0, thickness, thick), thickness, dotted);
                let count = max(round((sideLength + gap) / (dash + gap)), 1.0);
                if (count >= 2.0) {
                    let period = dash + (sideLength - count * dash) / (count - 1.0);
                    let phase = along - floor(along / period) * period;
                    if (dotted && thick) {
                        let across = select(
                            select(item.shape.x + item.shape.z - in.local.x, in.local.x - item.shape.x, side == 3u),
                            select(item.shape.y + item.shape.w - in.local.y, in.local.y - item.shape.y, side == 0u),
                            horizontal) - thickness * 0.5;
                        sideOn = sideOn * coverage(length(vec2f(phase - dash * 0.5, across)) - thickness * 0.5, px);
                    } else {
                        sideOn = sideOn * select(0.0, 1.0, phase < dash);
                    }
                }
            }
            let bA = item.borderColor.a * ring * sideOn * share.x;
            let aA = item.borderColor.a * ringAlpha * sideOn * share.y;
            rgb = item.borderColor.rgb * bA + rgb * (1.0 - aA);
            alpha = aA + alpha * (1.0 - aA);
        }
    } else if (kind == 1u) {
        // Coverage as the browser rasterised it: text runs are drawn in their
        // own colour, so the mask already carries the browser's gamma and
        // contrast for that colour
        let a = item.color.a * tex.a;
        rgb = item.color.rgb * a;
        alpha = a;
    } else if (kind == 2u) {
        // Atlas images hold straight alpha; effect results (flag 128) are premultiplied.
        // Pixelated images (2097152) take the texel the pixel's centre falls in,
        // as the browser's nearest-neighbour filter does
        var t = tex;
        if ((flags & 2097152u) != 0u) {
            let dim = vec2f(textureDimensions(atlas));
            let lo = round(min(item.uv.xy, item.uv.zw) * dim);
            let hi = round(max(item.uv.xy, item.uv.zw) * dim) - vec2f(1.0);
            t = textureLoad(atlas, vec2i(clamp(floor(in.uv * dim), lo, hi)), 0);
        }
        let a = t.a * item.color.a * shapeCov;
        rgb = select(t.rgb * a, t.rgb * item.color.a * shapeCov, (flags & 128u) != 0u);
        alpha = a;
    } else if (kind == 3u) {
        // The gradient fills one background tile, shape2 (x, y, w, h), placed by
        // background-position; border.xy is 1 on axes where it repeats. Off a
        // repeating axis only the tile paints, as far as border.zw (its shown size);
        // a pixel at a corner of that takes the lesser of its two edges' shares,
        // as Skia covers an anti-aliased rect.
        let tile = item.shape2;
        let size = max(tile.zw, vec2f(1e-3));
        let q0 = in.local - tile.xy;
        let repeats = item.border.xy > vec2f(0.5);
        let edge = min(q0, item.border.zw - q0);
        let inTile = select(clamp(edge / max(px, 1e-4) + 0.5, vec2f(0.0), vec2f(1.0)), vec2f(1.0), repeats);
        var g: vec4f;
        if (item.radii2.z > 0.5) {
            // A tile that does not cover its area, painted as the browser paints
            // it: an image of radii2.zw texels repeated every radii2.xy, each
            // texel the gradient at its centre, read bilinearly in the texture
            // unit's 8-bit sub-texel steps and wrapping at the image's edges
            let n = item.radii2.zw;
            let u = round((q0 / max(item.radii2.xy, vec2f(1e-3)) * n - 0.5) * 256.0) / 256.0;
            let k = floor(u);
            let f = u - k;
            // k is whole: (k + 0.5) / n stays clear of whole numbers, where GPU division can fall short
            let ka = k - floor((k + 0.5) / n) * n;
            let kb = select(ka + 1.0, vec2f(0.0), ka + 1.0 >= n);
            let qa = (ka + 0.5) * size / n;
            let qb = (kb + 0.5) * size / n;
            let p = mix(
                mix(tileImageTexel(qa, size, item.extra, item.uv), tileImageTexel(vec2f(qb.x, qa.y), size, item.extra, item.uv), f.x),
                mix(tileImageTexel(vec2f(qa.x, qb.y), size, item.extra, item.uv), tileImageTexel(qb, size, item.extra, item.uv), f.x),
                f.y);
            g = vec4f(p.rgb / max(p.a, 1e-6), p.a);
        } else {
            let q = select(q0, q0 - floor(q0 / size) * size, repeats);
            g = linearGradientAt(q, size, item.extra, item.uv);
        }
        let a = g.a * item.color.a * shapeCov * min(inTile.x, inTile.y);
        rgb = g.rgb * a;
        alpha = a;
    } else if (kind == 4u) {
        // Outer shadow: blurred shape, not drawn under the element itself
        let a = item.color.a * roundedShadow(in.local, item.shape, item.radii, item.border.x, px)
            * (1.0 - coverage(sdRoundRect(in.local, item.shape2, item.radii2), px));
        rgb = item.color.rgb * a;
        alpha = a;
    } else if (kind == 5u) {
        // Inset shadow: inside the padding box, outside the blurred inner shape
        let inside = coverage(sdRoundRect(in.local, item.shape2, item.radii2), px);
        let a = item.color.a * inside * (1.0 - roundedShadow(in.local, item.shape, item.radii, item.border.x, px));
        rgb = item.color.rgb * a;
        alpha = a;
    } else if (kind == 6u) {
        // Hole: how much of the target to clear (the erase pipeline keeps
        // target x (1 - alpha)); no colour filter applies
        return vec4f(0.0, 0.0, 0.0, shapeCov * clipCov);
    }
    var outRgb = rgb * clipCov;
    var outA = alpha * clipCov;
    let fi = i32(item.fx.x);
    if (fi >= 0) {
        let f = filters[fi];
        let c = vec3f(dot(f.r0.xyz, outRgb), dot(f.r1.xyz, outRgb), dot(f.r2.xyz, outRgb)) + f.ok.xyz * outA;
        outRgb = clamp(c, vec3f(0.0), vec3f(outA)) * f.ok.w;
        outA = outA * f.ok.w;
    }
    return vec4f(outRgb, outA);
}
`;
