import { useEffect, useRef, useState } from 'react'

/*
 * The waitlist's background: the Willow bud, stem and leaf as a 3D hologram written in words, in the spirit of
 * the old all-ASCII Midjourney homepage. Two WebGL2 passes, like the hero garden:
 *   1. per character cell, march a ray into the mark's distance field (bud of three petals, stem, leaf) and two
 *      tilted rings of orbiting text; a hit takes its character from lines of skincare words wrapped around the
 *      surface, so the words turn with the mark. Stars, stray word streams and a slow scan line fill the night.
 *   2. per pixel, draw that cell's glyph from an atlas, with a small RGB split, a CRT halo from the cell
 *      texture's mipmaps, scanlines and a vignette.
 * It moves on its own (spin, scrolling words, orbits, scan). The pointer is a light and a soft lens, the bud leans
 * toward it, and moving it uncovers what lies under the night: a page of Willow lines, still and aligned to the
 * grid, shows along the pointer's path and closes again behind it. A click drops a stone in water: a splash, then a ring of words (the next line of a small week-1-to-week-8
 * story) with softer crests following it, bending the field as they pass. The waves take turns: a circle, a star,
 * a heart.
 * A click on the bud also makes it open its petals for a breath. A drag spins the mark. The form talks to it
 * through `fx` events: each keystroke sends a pulse up the stem, a bad address glitches the field, sending scans
 * it, and joining opens the bud and rewrites the ring.
 */

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))
const GLYPHS = [...ASCII, '·', '→']
const gi = (ch: string) => Math.max(0, GLYPHS.indexOf(ch))

// Lines of words wrapped around the mark (0-11), the second ring (12), the first ring before and after joining
// (13, 14). Cosmetic words only; nothing ranks or diagnoses.
const LINES = [
  '/check-in week 6 · same light · same angle · same you · ',
  'does your serum actually work? · let the photos answer · ',
  'niacinamide · retinol · vitamin c · azelaic acid · ceramides · spf 50 · ',
  'your skin against your own baseline · nobody else\'s · ',
  'week 1 · week 2 · week 3 · week 4 · week 5 · week 6 · week 7 · week 8 · ',
  'measured, not guessed · cosmetic tracking only · ',
  '/check-in morning · /check-in evening · /compare week 1 → week 8 · ',
  'dryness · oiliness · dark spots · fine lines · pores · texture · ',
  'keep what works · drop what doesn\'t · ',
  'hydration · barrier · calm · even · smooth · glow · ',
  'small changes, seen early · your routine, with receipts · ',
  'photos stay yours · delete anytime · willow · ',
  '/check-in · baseline · noise band · real change · ',
  'JOIN THE WAITLIST · WILLOW · EARLY ACCESS · ',
  'YOU\'RE ON THE LIST · WELCOME TO WILLOW · ',
  'willow · willow · willow · ',
  // click ripples, in order: a small story from the first check-in to the eighth
  'week 1 · this is your baseline · ',
  'same light · same angle · same you · ',
  'week 4 · is that change real, or just the light? · ',
  'measured against you, never anyone else · ',
  'week 8 · keep what works, drop what doesn\'t · ',
  'see whether your skin really changed · ',
  // the heart waves, then the star waves
  'be kind to your skin · same you · ',
  'small changes, seen early · you shine · ',
]
const RIPPLE_FIRST = 16
const RIPPLES = 6
const HEART = RIPPLE_FIRST + RIPPLES
const STAR = HEART + 1
// the pointer's path, a point every TAIL_EVERY css px, each uncovering the page under the night for TAIL_LIFE s
const TAIL_EVERY = 18
const TAIL_LIFE = 0.9
const MAX_TAIL = 48
const MAX_RIPPLE = 4
const TEXT_W = 256

const VERT = `#version 300 es
layout(location=0) in vec2 a;
void main(){ gl_Position = vec4(a, 0., 1.); }`

const FORM = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uGrid;      // cols, rows
uniform vec2 uCell;      // css px per cell
uniform vec2 uView;      // css px
uniform float uT;
uniform float uYaw;
uniform float uPitch;
uniform float uScale;
uniform float uLift;
uniform float uShift;     // the mark's centre, sideways (q units)
uniform vec3 uLight;
uniform vec3 uPtr;       // q.x, q.y, on (0..1)
uniform vec3 uShatter;   // q.x, q.y, amount (the opening assembly)
uniform vec4 uTail[${MAX_TAIL}];    // the pointer's path, oldest first: q.x, q.y, age (< 0 = none), 1 = a stroke starts here
uniform vec4 uRipple[${MAX_RIPPLE}]; // click rings: q.x, q.y, age, text line
uniform vec3 uBurst;     // joining: where the light bursts from (q), and its age (< 0 = not yet)
uniform float uPulse[6]; // age of each keystroke pulse (s), <0 = none
uniform float uGlitch;
uniform float uBloom;
uniform float uWin;      // seconds since joining, <0 = not yet
uniform float uScan;
uniform float uRingLine;
uniform highp sampler2D uText;
out vec4 o;

#define TAU 6.2831853
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 rot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float smin(float a, float b, float k){ float h = clamp(.5 + .5 * (b - a) / k, 0., 1.); return mix(b, a, h) - k * h * (1. - h); }
float sdEll(vec3 p, vec3 r){ float k0 = length(p / r); float k1 = length(p / (r * r)); return k0 * (k0 - 1.) / k1; }
float sdCap(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h) - r; }
float dot2(vec2 v){ return dot(v, v); }
// iq's heart: tip at the origin, lobes up to y ~ 1
float sdHeart(vec2 p){
  p.x = abs(p.x);
  if (p.y + p.x > 1.) return sqrt(dot2(p - vec2(.25, .75))) - sqrt(2.) / 4.;
  return sqrt(min(dot2(p - vec2(0., 1.)), dot2(p - .5 * max(p.x + p.y, 0.)))) * sign(p.x - p.y);
}
// iq's five-point star of radius r, inner radius factor rf, one point up
float sdStar5(vec2 p, float r, float rf){
  const vec2 k1 = vec2(.809016994375, -.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2. * max(dot(k1, p), 0.) * k1;
  p -= 2. * max(dot(k2, p), 0.) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0., 1.);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0., r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
// which shape a ripple's text line makes: 0 circle, 1 star, 2 heart
float shapeOf(float line){ return line > ${STAR}. - .5 ? 1. : line > ${HEART}. - .5 ? 2. : 0.; }
// Signed distance from d (relative to where the stone fell) to a wave front of size R
float front(vec2 d, float R, float shape){
  if (shape < .5) return length(d) - R;
  if (shape < 1.5) return sdStar5(d, R * 1.1, .5);
  float s = R * 1.05;
  return sdHeart(d / s + vec2(0., .52)) * s;
}
// how far a wave has spread: quick at first, easing as it goes, like a ripple losing energy
float spread(float age){ return .03 + .66 * age - .05 * age * age; }
const float WAVE = .1;     // distance between crests, in q units
float glyphAt(float line, float col){ return floor(texelFetch(uText, ivec2(int(mod(col, ${TEXT_W}.)), int(line)), 0).r * 255. + .5); }

vec3 toObj(vec3 p){
  vec3 q = (p - vec3(uShift, uLift, 0.)) / uScale;
  q.yz = rot(q.yz, uPitch);
  q.xz = rot(q.xz, uYaw);
  return q;
}

// The bud: three petals that are one egg while closed and lean apart as it opens.
float bud(vec3 o){
  float d = 1e3;
  for (int i = 0; i < 3; i++){
    vec3 q = o;
    q.xz = rot(q.xz, float(i) * 2.0944 + .4);
    q.y += .12;
    q.yz = rot(q.yz, -uBloom * .62);
    q.y -= .12;
    q.z -= uBloom * .2;
    q.y -= .36;
    q.xz *= 1. + .26 * smoothstep(-.25, .62, q.y);
    d = smin(d, sdEll(q, vec3(.47, .58, .47 - uBloom * .3)), .05 * (1. - uBloom) + .015);
  }
  return d;
}
float stem(vec3 o){
  vec3 s = o; s.x -= .05 * sin(o.y * 2.3 + 1.1);
  return sdCap(s, vec3(0., -.15, 0.), vec3(0., -1.22, 0.), .06);
}
float leaf(vec3 o){
  vec3 l = o - vec3(.34, -.5, .02);
  l.xy = rot(l.xy, -.6);
  l.z += 1.1 * l.x * l.x - .05;
  return sdEll(l, vec3(.31, .085, .03));
}
float core(vec3 o){ return length(o - vec3(0., .2, 0.)) - .13 * uBloom; }

// distance in world units; id 0 bud, 1 stem, 2 leaf, 3 core
float map(vec3 p, out float id){
  vec3 o = toObj(p);
  float b = bud(o), s = stem(o), l = leaf(o), c = uBloom > .01 ? core(o) : 1e3;
  float d = b; id = 0.;
  if (s < d){ d = s; id = 1.; }
  if (l < d){ d = l; id = 2.; }
  if (c < d){ d = c; id = 3.; }
  return d * uScale * .8;
}
float mapD(vec3 p){ float id; return map(p, id); }
vec3 nrm(vec3 p){
  const vec2 k = vec2(1., -1.) * .0015;
  return normalize(k.xyy * mapD(p + k.xyy) + k.yyx * mapD(p + k.yyx) + k.yxy * mapD(p + k.yxy) + k.xxx * mapD(p + k.xxx));
}

// A thin cylinder of text around the mark: nearest visible hit as (t, angle, front?) or t < 0.
vec3 ring(vec3 ro, vec3 rd, float R, float tilt, float roll, float halfH){
  vec3 o = ro - vec3(uShift, uLift, 0.), d = rd;
  o.xy = rot(o.xy, roll); d.xy = rot(d.xy, roll);
  o.yz = rot(o.yz, tilt); d.yz = rot(d.yz, tilt);
  float a = dot(d.xz, d.xz), b = dot(o.xz, d.xz), c = dot(o.xz, o.xz) - R * R;
  float disc = b * b - a * c;
  if (disc < 0.) return vec3(-1.);
  float s = sqrt(disc);
  for (int i = 0; i < 2; i++){
    float t = (-b + (i == 0 ? -s : s)) / a;
    vec3 p = o + d * t;
    if (t > 0. && abs(p.y) < halfH) return vec3(t, atan(p.z, p.x), i == 0 ? 1. : 0.);
  }
  return vec3(-1.);
}

const vec3 CORAL = vec3(1., .42, .29), PINK = vec3(.95, .37, .66), LILAC = vec3(.79, .66, 1.);
const vec3 SKY = vec3(.24, .48, 1.), ICE = vec3(.61, .83, 1.), STEM = vec3(.44, .68, .61), LEAF = vec3(.53, .77, .69);
const vec3 GOLD = vec3(.96, .87, .36), LIME = vec3(.72, .91, .53);

void main(){
  vec2 cell = floor(gl_FragCoord.xy);
  float row = uGrid.y - 1. - cell.y;               // from the top
  vec2 px = (cell + .5) * uCell;                    // css px, y up
  vec2 q = (px - uView * .5) / (uView.y * .5);      // y up, height 2
  vec2 cellU = uCell / (uView.y * .5);              // one cell in q units
  float rnd = h21(cell + 7.1);
  float flick = floor(uT * 14.);

  // glitch: rows tear sideways while it lasts
  if (uGlitch > .01){
    float hr = h21(vec2(row, floor(uT * 22.)));
    if (hr > 1. - .45 * uGlitch) q.x += (h21(vec2(row, flick + 3.)) - .5) * .6 * uGlitch;
  }

  // shatter: every cell shows what was a random way back toward the blast, so the mark flies apart
  vec2 qs = q;
  if (uShatter.z > .001){
    vec2 away = q - uShatter.xy;
    float r = length(away) + 1e-3;
    vec2 dir = away / r;
    vec2 jig = vec2(h21(cell + 1.3), h21(cell + 9.7)) - .5;
    float k = uShatter.z * (.25 + 1.1 * h21(cell + 3.3)) * (.6 + .5 * smoothstep(.9, 0., r));
    qs = q - (dir * k + vec2(-dir.y, dir.x) * k * .45 * (rnd - .5) * 2. + jig * k * .9);
  }

  // water: behind each wave front the field bends back and forth, so the mark and the stars wobble as it passes
  for (int i = 0; i < ${MAX_RIPPLE}; i++){
    vec4 rp = uRipple[i];
    if (rp.z < 0. || rp.z > 3.4) continue;
    vec2 d = q - rp.xy;
    float shape = shapeOf(rp.w);
    float f = front(d, spread(rp.z) * (shape > .5 ? .8 : 1.), shape);
    if (f > .03 || f < -WAVE * 4.) continue;
    float amp = smoothstep(-WAVE * 4., -WAVE * .3, f) * smoothstep(.03, -.01, f) * (1. - smoothstep(1., 3.4, rp.z));
    qs += d / (length(d) + 1e-3) * sin(f / WAVE * TAU) * .022 * amp;
  }

  // the pointer is a soft lens: the field swells a little around it
  if (uPtr.z > .01){
    vec2 d = qs - uPtr.xy;
    qs = uPtr.xy + d * mix(1. - .32 * uPtr.z, 1., smoothstep(0., .26, length(d)));
  }

  vec3 ro = vec3(0., 0., 4.);
  vec3 rd = normalize(vec3(qs, -4.));

  vec3 col = vec3(0.);
  float g = 0.;            // glyph index, 0 = empty
  float tHit = 1e9;

  // --- the mark
  vec3 bc = vec3(uShift, uLift, 0.);
  float bR = 1.3 * uScale;
  vec3 oc = ro - bc;
  float bb = dot(oc, rd), cc = dot(oc, oc) - bR * bR, hh = bb * bb - cc;
  if (hh > 0.){
    float t = max(0., -bb - sqrt(hh)), tEnd = -bb + sqrt(hh);
    float id = 0.;
    for (int i = 0; i < 64; i++){
      float d = map(ro + rd * t, id);
      if (d < .0015){ tHit = t; break; }
      t += d;
      if (t > tEnd) break;
    }
    if (tHit < 1e8){
      vec3 p = ro + rd * tHit;
      vec3 n = nrm(p);
      vec3 ob = toObj(p);
      vec3 L = normalize(uLight);
      float dif = max(dot(n, L), 0.);
      float fr = pow(1. - max(dot(n, -rd), 0.), 2.2);
      float spec = pow(max(dot(reflect(rd, n), L), 0.), 18.);
      vec3 alb;
      if (id < .5){
        float hgt = clamp((ob.y + .15) / 1.05, 0., 1.);
        alb = hgt < .5 ? mix(CORAL, PINK, hgt * 2.) : mix(PINK, LILAC, hgt * 2. - 1.);
        alb = mix(alb, LILAC, fr * .6);
      } else if (id < 1.5) alb = STEM; else if (id < 2.5) alb = LEAF; else alb = mix(GOLD, vec3(1.), .3);
      float br = .2 + .9 * dif + .55 * fr + .6 * spec;
      col = alb * br + LILAC * fr * .35 + vec3(1.) * spec * .35;

      // words on the surface: each band of latitude is a line, laid along the screen row so it stays readable,
      // carried round as the mark turns and scrolling its own way
      float rowsU = uScale / cellU.y;                     // character rows per object unit
      float lat = floor(ob.y * rowsU);
      float line = mod(lat + 40., 12.);
      float dirn = mod(lat, 2.) < 1. ? 1. : -1.;
      float speed = (1.5 + 2.5 * h21(vec2(lat, 3.))) * dirn;
      float turn = uYaw / TAU * (TAU * .45 * uScale / cellU.x);
      float colI = cell.x + floor(uT * speed - turn) + lat * 17.;
      g = glyphAt(line, colI);
      if (id > 2.5) g = float(${gi('*')});
      if (g < .5){                                       // gaps between words keep the form solid
        g = br > 1.05 ? float(${gi('=')}) : br > .7 ? float(${gi(':')}) : float(${gi('·')});
        col *= .5;
      }

      // keystroke pulses climb from the stem to the tip
      for (int i = 0; i < 6; i++){
        float a = uPulse[i];
        if (a < 0.) continue;
        float y = -1.25 + a * 3.2;
        float k = smoothstep(.075, 0., abs(ob.y - y)) * smoothstep(1., .45, a);
        col = mix(col, vec3(1.) + alb * .4, k * .75);
        if (k > .6) g = float(${gi('#')});
      }
      // submitting: quick scan bands
      if (uScan > .01){
        float y = mod(uT * 2.4, 2.8) - 1.3;
        float k = smoothstep(.1, 0., abs(ob.y - y)) * uScan;
        col += vec3(.7, .9, 1.) * k;
        if (k > .3) g = float(${gi('=')});
      }
    }
  }

  // --- two orbiting rings of text, drawn wherever they are nearer than the mark
  for (int r = 0; r < 2; r++){
    float R = (r == 0 ? 1.1 : 1.36) * uScale;
    float tilt = r == 0 ? -.3 : .22;
    float roll = r == 0 ? .16 : -.32;
    float hH = cellU.y * .62;
    vec3 hit = ring(ro, rd, R, tilt, roll, hH);
    if (hit.x > 0. && hit.x < tHit){
      float circ = TAU * R / cellU.x * .98;
      float spin = uT * (r == 0 ? .16 : -.1);
      float colI = floor(-(hit.y + spin) / TAU * circ);
      float line = r == 0 ? uRingLine : 12.;
      float c = glyphAt(line, colI);
      float front = hit.z;
      vec3 tint = r == 0 ? (uRingLine > 13.5 ? mix(GOLD, LIME, .3) : ICE) : LILAC;
      float lum = (front > .5 ? 1. : .38) * (r == 0 ? 1. : .6);
      g = c > .5 ? c : float(${gi('·')});
      col = tint * lum * (c > .5 ? 1. : .35);
      tHit = hit.x;
    }
  }

  float solid = g;          // the mark or a ring is here (the path brightens it rather than uncovering)

  // --- the night behind
  if (g < .5){
    // stars on two layers that drift against the pointer
    for (int l = 0; l < 2; l++){
      float dep = l == 0 ? .5 : 1.2;
      vec2 sc = floor(cell + uPtr.xy * vec2(-3., -2.) * dep * uPtr.z + vec2(uT * .35 * dep, 0.));
      float s = h21(sc + float(l) * 31.);
      if (s > .986){
        float tw = .5 + .5 * sin(uT * (1. + 3. * h21(sc + 5.)) + s * 40.);
        g = s > .997 ? float(${gi('+')}) : (s > .992 ? float(${gi('·')}) : float(${gi('.')}));
        col = mix(ICE, LILAC, h21(sc + 2.)) * (.25 + .5 * tw) * (l == 0 ? .6 : 1.);
      }
    }
    // stray word streams drifting across, like signals passing
    float sr = h21(vec2(row, 11.));
    if (sr > .9){
      float speed = (3. + 5. * h21(vec2(row, 4.))) * (sr > .95 ? 1. : -1.);
      float x = cell.x - uT * speed;
      float win = sin(x * .045 + row) * .5 + .5;
      if (win > .78){
        float c = glyphAt(mod(row, 12.), floor(x));
        if (c > .5){ g = c; col = SKY * .55 * smoothstep(.78, .95, win); }
      }
    }
  }

  // the pointer's path uncovers a page of Willow lines lying still under the night, one line per row, and it closes
  // again behind: white where the pointer is, cooling to gold, pink and lilac as it fades. Over the mark the path
  // only brightens what is there.
  float rv = 0., ra = 0.;
  for (int i = 0; i < ${MAX_TAIL}; i++){
    vec4 a = uTail[i];
    if (a.z < 0. || a.z > ${TAIL_LIFE.toFixed(2)}) continue;
    vec4 b = i > 0 ? uTail[i - 1] : a;           // the point before it on the path
    if (b.z < 0. || a.w > .5) b = a;
    vec2 pa = q - a.xy, ba = b.xy - a.xy;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0., 1.);
    float age = mix(a.z, b.z, h);
    float r = cellU.y * (.8 - .35 * age / ${TAIL_LIFE.toFixed(2)});
    float k = smoothstep(r, r * .3, length(pa - ba * h)) * (1. - smoothstep(${(TAIL_LIFE * 0.4).toFixed(2)}, ${TAIL_LIFE.toFixed(2)}, age));
    if (k > rv){ rv = k; ra = age / ${TAIL_LIFE.toFixed(2)}; }
  }
  if (rv > .02){
    vec3 warm = mix(vec3(1.), mix(GOLD, mix(PINK, LILAC, smoothstep(.45, .9, ra)), smoothstep(.15, .45, ra)), smoothstep(0., .2, ra));
    if (solid > .5) col = mix(col, warm * 1.3, rv * .55);
    else {
      float c = glyphAt(mod(row * 5., 12.), cell.x + floor(h21(vec2(row, 3.)) * 200.));
      if (c > .5){ g = c; col = warm * rv * 1.25; }
      else if (g > .5) col *= 1. - rv;            // a star in a gap between words steps aside
    }
  }

  // --- sweeps across everything
  float sweepY = 1.25 - mod(uT, 9.) / 9. * 2.9;
  float sw = smoothstep(cellU.y * 3., 0., abs(q.y - sweepY));
  if (sw > .01){
    if (g < .5 && h21(cell + flick) < sw * .35){ g = float(${gi(':')}); col = ICE * .35 * sw; }
    else col *= 1. + sw * .8;
  }
  // keystroke rings leave the card
  for (int i = 0; i < 6; i++){
    float a = uPulse[i];
    if (a < 0. || a > 1.4) continue;
    float rr = .25 + a * 1.5;
    float k = smoothstep(cellU.y * 1.6, 0., abs(length(q * vec2(1., 1.25)) - rr)) * (1. - a / 1.4);
    if (k > .2){
      if (g < .5) g = float(${gi('·')});
      col = mix(col, ICE, k * .7);
    }
  }
  // click ripples, like a stone in water: a splash where it fell, a leading front of words (circles read left to
  // right along their top and bottom arcs, the steep sides dotted; stars and hearts take their letters from the
  // column),
  // and three softer crests following behind it
  for (int i = 0; i < ${MAX_RIPPLE}; i++){
    vec4 rp = uRipple[i];
    if (rp.z < 0. || rp.z > 3.4) continue;
    float shape = shapeOf(rp.w);
    bool shaped = shape > .5;
    float R = spread(rp.z) * (shaped ? .8 : 1.);
    vec2 d = q - rp.xy;
    float fade = smoothstep(0., .08, rp.z) * (1. - smoothstep(1.6, 3.4, rp.z));
    float k = rp.w - ${RIPPLE_FIRST}.;
    vec3 tint = shape > 1.5 ? mix(PINK, CORAL, .35) : shaped ? mix(GOLD, vec3(1.), .15) : k < .5 ? GOLD : k < 1.5 ? ICE : k < 2.5 ? LILAC : k < 3.5 ? LIME : k < 4.5 ? SKY * 1.4 : mix(GOLD, PINK, .4);
    // the splash
    float sr = cellU.y * (1.6 - rp.z * 4.);
    if (sr > 0. && length(d * vec2(1., 1.6)) < sr){
      g = rp.z < .12 ? float(${gi('@')}) : float(${gi('o')});
      col = mix(vec3(1.), tint, rp.z * 3.) * 1.4;
      continue;
    }
    // the crests behind, fainter and thinner each
    bool drawn = false;
    for (int c = 1; c < 4; c++){
      float Rc = R - float(c) * WAVE;
      if (Rc < .02) break;
      if (abs(front(d, Rc, shape)) < cellU.y * (.6 - float(c) * .08)){
        if (g < .5 || c == 1) g = c == 1 ? float(${gi('~')}) : c == 2 ? float(${gi('-')}) : float(${gi('·')});
        col = mix(col, tint * (1.05 - float(c) * .25), fade);
        drawn = true;
        break;
      }
    }
    if (drawn) continue;
    // the leading front
    if (abs(front(d, R, shape)) > cellU.y * (shaped ? .75 : .6)) continue;
    float c;
    if (shaped) c = glyphAt(rp.w, cell.x + floor(rp.x * 40.));
    else {
      if (abs(d.y) < R * .42){
        g = float(${gi('~')}); col = tint * .8 * fade;
        continue;
      }
      float a = atan(d.y, d.x);
      c = glyphAt(rp.w, floor((d.y >= 0. ? -a : a) / TAU * (TAU * R / cellU.x) + (d.y >= 0. ? 0. : 23.)));
    }
    g = c > .5 ? c : float(${gi('~')});
    col = mix(vec3(1.), tint, smoothstep(.3, 1.6, rp.z)) * fade * (c > .5 ? 1.6 : shaped ? 1.3 : .9);
  }
  // joining: sparks burst from the button, fast then drifting down as they fade
  if (uBurst.z >= 0. && uBurst.z < 1.8){
    float t = uBurst.z;
    for (int i = 0; i < 56; i++){
      float fi = float(i);
      float a = h21(vec2(fi, 1.7)) * TAU;
      float v = .35 + 1.25 * h21(vec2(fi, 4.1));
      vec2 p = uBurst.xy + vec2(cos(a), sin(a) * .8) * v * (1. - exp(-t * 4.)) / 2.2 + vec2(0., -.22 * t * t);
      if (floor((p * uView.y * .5 + uView * .5) / uCell) != cell) continue;
      float f = 1. - smoothstep(.5, 1.8, t);
      float k = h21(vec2(fi, 9.3));
      g = k < .35 ? float(${gi('*')}) : k < .6 ? float(${gi('+')}) : k < .85 ? float(${gi('·')}) : float(${gi('o')});
      col = mix(vec3(1.), k < .5 ? GOLD : k < .8 ? LIME : PINK, smoothstep(0., .35, t)) * f * 1.6;
    }
  }
  // joining: a gold shockwave and sparks of words
  if (uWin >= 0. && uWin < 3.){
    float rr = uWin * 1.7;
    float k = smoothstep(cellU.y * 4., 0., abs(length(q - vec2(uShift, uLift + .25 * uScale)) - rr)) * (1. - uWin / 3.);
    if (k > .05){
      if (g < .5 || h21(cell + flick) < k * .5) g = float(${gi('*')}) + floor(h21(cell + flick) * 2.) * float(${gi('+') - gi('*')});
      col = mix(col, mix(GOLD, LIME, rnd), k);
    }
  }
  if (uGlitch > .01 && g > .5){
    col = mix(col, CORAL * 1.2, uGlitch * .5);
    if (h21(cell + flick + 9.) < uGlitch * .25) g = float(${gi('!')}) + floor(h21(cell + flick) * 30.);
  }

  o = vec4(min(col, vec3(1.)), g / 255.);
}`

const SCREEN = `#version 300 es
precision highp float;
uniform sampler2D uCells;
uniform sampler2D uAtlas;
uniform vec2 uCellD;     // device px per cell
uniform vec2 uGridD;     // cols, rows
uniform vec2 uRes;       // device px
uniform float uDpr;
uniform float uT;
uniform float uGlitch;
uniform float uWin;
uniform float uShift;
uniform vec4 uGlass;     // the card in device px, y up: x0, y0, x1, y1 (x1 <= x0: none)
uniform float uGlassR;   // its corner radius, device px
uniform vec3 uLightD;    // the pointer in device px, and how present it is
out vec4 o;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float cov(ivec2 cell, float g, vec2 lp){
  vec2 l = clamp(floor(lp), vec2(0.), uCellD - 1.);
  return texelFetch(uAtlas, ivec2(int(g) * int(uCellD.x) + int(l.x), int(uCellD.y - 1. - l.y)), 0).a;
}
float sdRR(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }

// the night: deep indigo, a violet lift behind the mark
vec3 ground(vec2 px){
  vec2 q = (px - uRes * .5) / (uRes.y * .5);
  float r = length(q * vec2(.8, 1.));
  vec3 col = mix(vec3(.075, .058, .19), vec3(.024, .02, .07), smoothstep(0., 1.5, r));
  float rm = length((q - vec2(uShift, 0.)) * vec2(.8, 1.));
  col += vec3(.3, .18, .6) * .16 * exp(-rm * rm * 2.2);
  if (uWin >= 0.) col += vec3(.35, .3, .1) * .1 * exp(-rm * rm * 3.) * exp(-uWin * .4);
  return col;
}
// everything at one pixel: ground, the cell's glyph with a slight RGB split, and the CRT halo from the mips
vec3 scene(vec2 px){
  vec3 col = ground(px);
  ivec2 cell = ivec2(floor(px / uCellD));
  vec4 c = texelFetch(uCells, cell, 0);
  float g = floor(c.a * 255. + .5);
  if (g > .5){
    vec2 lp = px - vec2(cell) * uCellD;
    float sp = (.45 + 3. * uGlitch) * uDpr;
    col += c.rgb * vec3(cov(cell, g, lp + vec2(sp, 0.)), cov(cell, g, lp), cov(cell, g, lp - vec2(sp, 0.))) * 1.15;
  }
  vec2 uv = px / (uGridD * uCellD);
  return col + textureLod(uCells, uv, 1.6).rgb * .22 + textureLod(uCells, uv, 3.4).rgb * .3;
}

void main(){
  vec2 px = gl_FragCoord.xy;
  bool glassy = uGlass.z > uGlass.x;
  vec2 c = (uGlass.xy + uGlass.zw) * .5, b = (uGlass.zw - uGlass.xy) * .5;
  float R = uGlassR;
  float d = glassy ? sdRR(px - c, b, R) : 1e9;
  // under the glass the field is drawn once, by the glass itself
  vec3 col = d > -1. ? scene(px) : vec3(0.);

  // The card is liquid glass, drawn here so it can bend the field: a thick convex bevel round the edge pulls in
  // what lies just outside it and splits it into colour, the body softens what's behind so the words on it read,
  // and light runs round the rim toward the pointer, with a fainter counter-light opposite.
  if (glassy){
    float sh = sdRR(px - c + vec2(0., 22. * uDpr), b * vec2(.97, 1.), R);
    if (d > 0.) col *= 1. - .55 * (1. - smoothstep(-10. * uDpr, 70. * uDpr, sh));
    if (d < 1.){
      vec2 e = vec2(1., 0.);
      vec2 n = normalize(vec2(sdRR(px - c + e.xy, b, R) - sdRR(px - c - e.xy, b, R), sdRR(px - c + e.yx, b, R) - sdRR(px - c - e.yx, b, R)) + 1e-5);
      float band = 40. * uDpr;
      float rim = clamp(1. + d / band, 0., 1.);       // 1 at the edge, 0 past the bevel
      float h = rim * rim * rim;
      // the body is a slightly magnifying lens; the bevel sees what lies outside the edge
      vec2 sp = c + (px - c) * .97 + n * h * 26. * uDpr;
      float disp = h * 1.8 * uDpr;
      vec3 mid = scene(sp);
      // the colour split only where the bevel bends light; the body takes one look
      vec3 sharp = disp > .05 ? vec3(scene(sp + n * disp).r, mid.g, scene(sp - n * disp).b) : mid;
      vec2 uvb = sp / (uGridD * uCellD);
      vec3 soft = ground(sp) * 1.15 + textureLod(uCells, uvb, 2.4).rgb * .7 + textureLod(uCells, uvb, 4.2).rgb * .55;
      // it adapts like the real thing: where what's behind is busy and bright it frosts and dims, so the words
      // on the card always read; over the quiet night it stays clear
      float busy = smoothstep(.04, .22, dot(textureLod(uCells, uvb, 3.).rgb, vec3(.3, .5, .2)));
      vec3 body = mix(soft, sharp, mix(.3, .05, busy) + (1. - mix(.3, .05, busy)) * smoothstep(.05, .7, rim));
      body = body * mix(.95, .62, busy * (1. - rim)) + vec3(.045, .04, .075) + vec3(.04, .035, .06) * rim * rim;
      vec2 L = normalize(mix(vec2(-.55, .85), normalize(uLightD.xy - c + vec2(1e-3)), uLightD.z));
      float edge = 1. - smoothstep(0., 1.5 * uDpr, -d);
      // reflections the way glass has them: a hairline rim that brightens only where it faces the light, and a
      // faint broad glint along that edge
      float facing = max(dot(n, L), 0.);
      float spec = pow(facing, 8.) * pow(rim, 6.);
      float back = pow(max(dot(n, -L), 0.), 8.) * pow(rim, 8.);
      body += vec3(1., .97, 1.) * (edge * (.08 + .32 * pow(facing, 3.)) + spec * .22 + back * .06);
      // a soft sheen across the top, as if the glass were domed
      body += vec3(.9, .9, 1.) * .03 * smoothstep(-.1, 1., (px.y - c.y) / b.y) * (1. - rim);
      col = mix(col, body, smoothstep(1., -1., d));
    }
  }

  // scanlines, a little flicker and grain, vignette
  vec2 q = (px - uRes * .5) / (uRes.y * .5);
  float r = length(q * vec2(.8, 1.));
  col *= .9 + .1 * sin(px.y / uDpr * 3.14159);
  col *= .985 + .015 * sin(uT * 60.);
  col += (h21(px + fract(uT) * 100.) - .5) * .025;
  col *= 1. - .35 * smoothstep(.7, 1.8, r);
  o = vec4(col, 1.);
}`

type Shader = { prog: WebGLProgram; u: (n: string) => WebGLUniformLocation | null }

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): Shader {
  const prog = gl.createProgram()!
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const sh = gl.createShader(type)!
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader')
    gl.attachShader(prog, sh)
  }
  gl.bindAttribLocation(prog, 0, 'a')
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link')
  const locs = new Map<string, WebGLUniformLocation | null>()
  const u = (n: string) => {
    if (!locs.has(n)) locs.set(n, gl.getUniformLocation(prog, n))
    return locs.get(n)!
  }
  return { prog, u }
}

/** Every glyph, white on clear, in one row of exact device-pixel cells. */
function atlas(gl: WebGL2RenderingContext, cw: number, ch: number, tex: WebGLTexture | null) {
  const c = document.createElement('canvas')
  c.width = cw * GLYPHS.length
  c.height = ch
  const g = c.getContext('2d')!
  g.font = `500 ${Math.round(ch * 0.8)}px "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#fff'
  GLYPHS.forEach((glyph, i) => g.fillText(glyph, i * cw + cw / 2, ch / 2 + ch * 0.04))
  const t = tex ?? gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return t
}

/** The lines as glyph indices, each repeated to fill one row of the text texture. */
function textTexture(gl: WebGL2RenderingContext) {
  const data = new Uint8Array(TEXT_W * LINES.length)
  LINES.forEach((line, r) => {
    for (let i = 0; i < TEXT_W; i++) data[r * TEXT_W + i] = gi(line[i % line.length])
  })
  const t = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, TEXT_W, LINES.length, 0, gl.RED, gl.UNSIGNED_BYTE, data)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  return t
}

/** The card's corner radius, which the glass drawn here has to match (css px). */
export const GLASS_RADIUS = 28

// pixel-ratio caps, best first; the field steps down them when frames run slow
const DPR_STEPS = [2, 1.5, 1]

export type FieldEvent = 'pulse' | 'glitch' | 'scan' | 'idle' | 'win'

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)
/** Out fast, hang, then glide home. */
const shatterAt = (age: number) => (age < 0.16 ? 1 - (1 - age / 0.16) ** 3 : age < 0.5 ? 1 : Math.max(0, 1 - ease(Math.min(1, (age - 0.5) / 1.2))))

export function WaitlistField({ fx }: { fx: EventTarget }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    const cv = canvas.current
    const gl = cv?.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' })
    if (!cv || !gl) {
      if (cv) queueMicrotask(() => setFallback(true))
      return
    }
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let form: Shader
    let screen: Shader
    try {
      form = compile(gl, VERT, FORM)
      screen = compile(gl, VERT, SCREEN)
    } catch (e) {
      console.warn('waitlist field:', e)
      queueMicrotask(() => setFallback(true))
      return
    }
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    const text = textTexture(gl)
    const cells = gl.createTexture()
    const fbo = gl.createFramebuffer()
    let atl: WebGLTexture | null = null

    let W = 1
    let H = 1
    let dpr = 1
    let quality = 0
    let cols = 1
    let rows = 1
    let cellD = [18, 32]
    let scale = 0.72
    let lift = 0.05
    let shift = 0
    const calm = [9, 9, 9, 9]
    const glass = [0, 0, 0, 0]
    let card: Element | null = null
    const ptr = { x: 0, y: 0, on: 0, last: -9, down: false, sx: 0, sy: 0, moved: 0, lx: 0 }
    const st = {
      t: 0,
      yaw: 0.6,
      spin: 0.32,
      pitch: 0,
      light: [-0.6, 0.8, 1],
      shatterAt: -0.2,
      shatterQ: [0, 0],
      shatterK: 1.25,
      pulses: [] as number[],
      glitchAt: -9,
      scan: 0,
      scanning: false,
      bloom: 0,
      winAt: -1,
      burst: [0, 0] as number[],
      breathAt: -9,
      lean: 0,
      tail: [] as { x: number; y: number; t: number; start: boolean }[],
      ripples: [] as { x: number; y: number; t: number; line: number }[],
      told: 0,
      clicks: 0,
      pen: null as null | { x: number; y: number },
    }
    const tailA = new Float32Array(MAX_TAIL * 4)
    const rippleA = new Float32Array(MAX_RIPPLE * 4)
    const pulses = new Float32Array(6)

    function layout() {
      const r = cv!.getBoundingClientRect()
      W = Math.max(1, r.width)
      H = Math.max(1, r.height)
      dpr = Math.min(window.devicePixelRatio || 1, DPR_STEPS[quality])
      if (W * H * dpr * dpr > 6e6) dpr = Math.sqrt(6e6 / (W * H))
      cv!.width = Math.round(W * dpr)
      cv!.height = Math.round(H * dpr)
      const wide = W >= 700
      const c = wide ? [9, 16] : [7, 13]
      cellD = [Math.max(4, Math.round(c[0] * dpr)), Math.max(7, Math.round(c[1] * dpr))]
      cols = Math.ceil(cv!.width / cellD[0])
      rows = Math.ceil(cv!.height / cellD[1])
      gl!.bindTexture(gl!.TEXTURE_2D, cells)
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, cols, rows, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR_MIPMAP_LINEAR)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
      gl!.generateMipmap(gl!.TEXTURE_2D)
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo)
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, cells, 0)
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null)
      atl = atlas(gl!, cellD[0], cellD[1], atl)
      place()
    }

    /** Follow the card every frame (it rises in and changes height): the glass is drawn over it, and the mark
     * is placed around it. */
    function place() {
      const r = cv!.getBoundingClientRect()
      const asp = W / H
      const el = card ?? (card = document.querySelector('[data-waitlist-card]'))
      const box = el?.getBoundingClientRect()
      if (box) {
        const toQ = (x: number, y: number) => [(x - r.left - W / 2) / (H / 2), (H / 2 - (y - r.top)) / (H / 2)]
        const [x0, y1] = toQ(box.left, box.top)
        const [x1, y0] = toQ(box.right, box.bottom)
        calm.splice(0, 4, x0, y0, x1, y1)
        glass.splice(0, 4, (box.left - r.left) * dpr, (r.bottom - box.bottom) * dpr, (box.right - r.left) * dpr, (r.bottom - box.top) * dpr)
      }
      // (In the mark's own units the bud's half-width is .47, its middle .36 and its tip .94.)
      // Where the card sits at the left (a wide screen), the mark fills the height in the space to its right.
      // Otherwise the bud is bigger than the card: on a mid-width screen its dome rises above the card and its
      // sides show either side; on a phone it fills the width behind it.
      shift = 0
      if (calm[0] + calm[2] < -0.15) {
        scale = Math.min(1.4, 1.62 / 1.16)
        lift = 0.86 - 0.94 * scale
        shift = Math.min((calm[2] + asp) / 2 + 0.04, asp - 0.1 - 0.47 * scale)
      } else if (asp >= 0.9) {
        const half = calm[2] > 0 && calm[2] < 5 ? calm[2] : 0.5
        scale = Math.max(0.9, Math.min(1.5, (half * 1.26) / 0.47))
        lift = 0.86 - 0.94 * scale
      } else {
        scale = Math.min(1, (asp * 1.02) / 0.47)
        lift = 0.12 - 0.36 * scale
      }
    }

    const toQ = (x: number, y: number) => {
      const r = cv!.getBoundingClientRect()
      return [(x - r.left - W / 2) / (H / 2), (H / 2 - (y - r.top)) / (H / 2)]
    }

    function step(dt: number) {
      st.t += dt
      const t = st.t
      ptr.on += ((t - ptr.last < 2.5 ? 1 : 0) - ptr.on) * Math.min(1, dt * 4)
      // spin: a drag throws it, then it settles back to its own slow turn
      if (!ptr.down) st.spin += (0.32 - st.spin) * Math.min(1, dt * 1.4)
      st.yaw += st.spin * dt
      st.lean += ((ptr.down ? st.lean : ptr.on * toQ(ptr.x, ptr.y)[0] * 0.35) - st.lean) * Math.min(1, dt * 2)
      while (st.tail.length && t - st.tail[0].t > TAIL_LIFE) st.tail.shift()
      while (st.ripples.length && t - st.ripples[0].t > 3.4) st.ripples.shift()
      const [qx, qy] = toQ(ptr.x, ptr.y)
      st.pitch += ((ptr.on * -qy * 0.3) - st.pitch) * Math.min(1, dt * 2)
      const lt = ptr.on > 0.05 ? [qx * 1.6, qy * 1.6 + 0.2, 1.3] : [-0.7, 0.8, 1]
      for (let i = 0; i < 3; i++) st.light[i] += (lt[i] - st.light[i]) * Math.min(1, dt * 3)
      st.scan += ((st.scanning ? 1 : 0) - st.scan) * Math.min(1, dt * 5)
      if (st.winAt >= 0) st.bloom += (1 - st.bloom) * Math.min(1, dt * 2.2)
      while (st.pulses.length && t - st.pulses[0] > 1.5) st.pulses.shift()
    }

    function draw() {
      const t = st.t
      place()
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo)
      gl!.viewport(0, 0, cols, rows)
      gl!.useProgram(form.prog)
      const u = form.u
      gl!.uniform2f(u('uGrid'), cols, rows)
      gl!.uniform2f(u('uCell'), cellD[0] / dpr, cellD[1] / dpr)
      gl!.uniform2f(u('uView'), W, H)
      gl!.uniform1f(u('uT'), t)
      gl!.uniform1f(u('uYaw'), st.yaw + st.lean)
      gl!.uniform1f(u('uPitch'), st.pitch)
      gl!.uniform1f(u('uScale'), scale)
      gl!.uniform1f(u('uLift'), lift)
      gl!.uniform1f(u('uShift'), shift)
      gl!.uniform3f(u('uLight'), st.light[0], st.light[1], st.light[2])
      const [qx, qy] = toQ(ptr.x, ptr.y)
      gl!.uniform3f(u('uPtr'), qx, qy, still ? 0 : ptr.on)
      gl!.uniform3f(u('uShatter'), st.shatterQ[0], st.shatterQ[1], still ? 0 : shatterAt(t - st.shatterAt) * st.shatterK)
      pulses.fill(-1)
      st.pulses.forEach((p, i) => (pulses[i] = t - p))
      gl!.uniform1fv(u('uPulse'), pulses)
      gl!.uniform1f(u('uGlitch'), Math.max(0, 1 - (t - st.glitchAt) / 0.7) ** 1.5)
      const breath = t - st.breathAt < 1.8 ? Math.sin(((t - st.breathAt) / 1.8) * Math.PI) * 0.42 : 0
      gl!.uniform1f(u('uBloom'), Math.min(1, st.bloom + breath))
      tailA.fill(-1)
      st.tail.forEach((p, i) => tailA.set([p.x, p.y, t - p.t, p.start ? 1 : 0], i * 4))
      gl!.uniform4fv(u('uTail'), tailA)
      rippleA.fill(-1)
      st.ripples.forEach((r, i) => rippleA.set([r.x, r.y, t - r.t, r.line], i * 4))
      gl!.uniform4fv(u('uRipple'), rippleA)
      gl!.uniform1f(u('uWin'), st.winAt < 0 ? -1 : t - st.winAt)
      gl!.uniform3f(u('uBurst'), st.burst[0], st.burst[1], st.winAt < 0 ? -1 : t - st.winAt)
      gl!.uniform1f(u('uScan'), st.scan)
      gl!.uniform1f(u('uRingLine'), st.winAt < 0 ? 13 : 14)
      gl!.activeTexture(gl!.TEXTURE0)
      gl!.bindTexture(gl!.TEXTURE_2D, text)
      gl!.uniform1i(u('uText'), 0)
      gl!.drawArrays(gl!.TRIANGLES, 0, 3)

      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null)
      gl!.viewport(0, 0, cv!.width, cv!.height)
      gl!.useProgram(screen.prog)
      const s = screen.u
      gl!.activeTexture(gl!.TEXTURE0)
      gl!.bindTexture(gl!.TEXTURE_2D, cells)
      gl!.generateMipmap(gl!.TEXTURE_2D)
      gl!.uniform1i(s('uCells'), 0)
      gl!.activeTexture(gl!.TEXTURE1)
      gl!.bindTexture(gl!.TEXTURE_2D, atl)
      gl!.uniform1i(s('uAtlas'), 1)
      gl!.uniform2f(s('uCellD'), cellD[0], cellD[1])
      gl!.uniform2f(s('uGridD'), cols, rows)
      gl!.uniform2f(s('uRes'), cv!.width, cv!.height)
      gl!.uniform1f(s('uDpr'), dpr)
      gl!.uniform1f(s('uT'), t)
      gl!.uniform1f(s('uGlitch'), Math.max(0, 1 - (t - st.glitchAt) / 0.7) ** 1.5)
      gl!.uniform1f(s('uWin'), st.winAt < 0 ? -1 : t - st.winAt)
      gl!.uniform1f(s('uShift'), shift)
      gl!.uniform4f(s('uGlass'), glass[0], glass[1], glass[2], glass[3])
      gl!.uniform1f(s('uGlassR'), GLASS_RADIUS * dpr)
      const rr = cv!.getBoundingClientRect()
      gl!.uniform3f(s('uLightD'), (ptr.x - rr.left) * dpr, (rr.bottom - ptr.y) * dpr, still ? 0 : ptr.on)
      gl!.drawArrays(gl!.TRIANGLES, 0, 3)
    }

    let raf = 0
    let prev = 0
    let visible = true
    // If this device can't keep up (a slow phone GPU), draw at a lower resolution: after each second of frames,
    // a typical frame over ~24 ms steps the pixel ratio down, at most twice.
    const times: number[] = []
    const watch = (ms: number) => {
      // a hidden or backgrounded page is throttled, not slow: those frames say nothing
      if (quality >= DPR_STEPS.length - 1 || st.t < 1.5 || ms > 200) return
      times.push(ms)
      if (times.length < 60) return
      times.sort((a, b) => a - b)
      const typical = times[30]
      times.length = 0
      if (typical > 24) {
        quality++
        layout()
      }
    }
    const frame = (now: number) => {
      if (prev) watch(now - prev)
      const dt = Math.min(0.05, prev ? (now - prev) / 1000 : 0.016)
      prev = now
      step(dt)
      draw()
      raf = visible && !document.hidden ? requestAnimationFrame(frame) : 0
    }
    const run = () => {
      if (still) {
        step(0)
        draw()
        return
      }
      if (!raf && visible && !document.hidden) {
        prev = 0
        raf = requestAnimationFrame(frame)
      }
    }

    // the pen: a point every TAIL_EVERY px along the pointer's path; a jump starts a new stroke
    const write = (x: number, y: number) => {
      const fresh = !st.pen || Math.hypot(x - st.pen.x, y - st.pen.y) > 220
      if (fresh || Math.hypot(x - st.pen!.x, y - st.pen!.y) >= TAIL_EVERY) {
        st.pen = { x, y }
        const [qx, qy] = toQ(x, y)
        st.tail.push({ x: qx, y: qy, t: st.t, start: fresh })
        if (st.tail.length > MAX_TAIL) st.tail.shift()
      }
    }

    // pointer: light, lens and pen on move, drag to spin, click to send a ring of words
    const onMove = (e: PointerEvent) => {
      if (!ptr.down && !still) write(e.clientX, e.clientY)
      if (ptr.down) {
        const dx = e.clientX - ptr.lx
        ptr.moved += Math.abs(dx) + Math.abs(e.clientY - ptr.y)
        st.spin = Math.max(-9, Math.min(9, (dx / Math.max(1, W)) * 260))
        st.yaw += (dx / W) * 5
      }
      ptr.lx = e.clientX
      ptr.x = e.clientX
      ptr.y = e.clientY
      ptr.last = st.t
    }
    const onDown = (e: PointerEvent) => {
      ptr.down = true
      ptr.moved = 0
      ptr.sx = ptr.lx = ptr.x = e.clientX
      ptr.sy = ptr.y = e.clientY
      ptr.last = st.t
    }
    const onUp = (e: PointerEvent) => {
      if (!ptr.down) return
      ptr.down = false
      if (ptr.moved < 8) {
        const [qx, qy] = toQ(e.clientX, e.clientY)
        // the waves take turns, circle, star, heart; the circles tell the story a line at a time
        const turn = st.clicks++ % 3
        const line = turn === 1 ? STAR : turn === 2 ? HEART : RIPPLE_FIRST + (st.told++ % RIPPLES)
        st.ripples.push({ x: qx, y: qy, t: st.t, line })
        if (st.ripples.length > MAX_RIPPLE) st.ripples.shift()
        // on the bud itself, it opens for a breath
        const bx = (qx - shift) / (0.47 * scale)
        const by = (qy - lift - 0.36 * scale) / (0.58 * scale)
        if (bx * bx + by * by < 1 && st.t - st.breathAt > 1.2) st.breathAt = st.t
        if (still) run()
      }
    }
    cv.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)

    const onFx = (e: Event) => {
      const kind = e.type as FieldEvent
      if (kind === 'pulse') {
        if (st.pulses.length && st.t - st.pulses[st.pulses.length - 1] < 0.09) return
        st.pulses.push(st.t)
        if (st.pulses.length > 6) st.pulses.shift()
      } else if (kind === 'glitch') st.glitchAt = st.t
      else if (kind === 'scan') st.scanning = true
      else if (kind === 'idle') st.scanning = false
      else if (kind === 'win') {
        st.scanning = false
        st.winAt = st.t
        // the light leaves from the button, with a ring of welcome words spreading after it
        const at = (e as CustomEvent<{ x: number; y: number } | undefined>).detail
        if (at) {
          st.burst = toQ(at.x, at.y)
          st.ripples.push({ x: st.burst[0], y: st.burst[1], t: st.t, line: 14 })
          if (st.ripples.length > MAX_RIPPLE) st.ripples.shift()
        }
        if (still) st.bloom = 1
      }
      if (still) run()
    }
    const kinds: FieldEvent[] = ['pulse', 'glitch', 'scan', 'idle', 'win']
    kinds.forEach((k) => fx.addEventListener(k, onFx))

    const ro = new ResizeObserver(() => {
      layout()
      if (still || !raf) draw()
    })
    ro.observe(cv)
    const cardEl = document.querySelector('[data-waitlist-card]')
    const ro2 = new ResizeObserver(() => {
      if (still || !raf) draw()
    })
    if (cardEl) ro2.observe(cardEl)
    // the page's CSS keeps its own frosted card only where this glass isn't drawn
    document.documentElement.dataset.liquid = '1'
    const io = new IntersectionObserver(([en]) => {
      visible = en.isIntersecting
      run()
    })
    io.observe(cv)
    const onVis = () => run()
    document.addEventListener('visibilitychange', onVis)
    let gone = false
    document.fonts?.load(`500 ${cellD[1]}px "Geist Mono"`).then(() => {
      if (gone) return
      atl = atlas(gl!, cellD[0], cellD[1], atl)
      if (still) draw()
    })

    layout()
    if (still) st.t = 4
    run()

    return () => {
      gone = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      ro2.disconnect()
      delete document.documentElement.dataset.liquid
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      cv.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      kinds.forEach((k) => fx.removeEventListener(k, onFx))
      gl.deleteTexture(cells)
      gl.deleteTexture(text)
      gl.deleteTexture(atl)
      gl.deleteFramebuffer(fbo)
      gl.deleteBuffer(buf)
      gl.deleteVertexArray(vao)
      gl.deleteProgram(form.prog)
      gl.deleteProgram(screen.prog)
    }
  }, [fx])

  if (fallback) return <div aria-hidden className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_45%,#2a1d5c_0%,#0b0920_70%)]" />
  return <canvas ref={canvas} aria-hidden className="absolute inset-0 block h-full w-full touch-pan-y select-none" />
}
