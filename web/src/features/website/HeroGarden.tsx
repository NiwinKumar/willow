import { useEffect, useRef, useState } from 'react'

import { HeroBloom } from './Decor'

/**
 * The hero's scene: a golden-hour tulip field, drawn entirely in Geist Mono glyphs on the GPU.
 *
 * Composition: a low sun sits in the gap between the headline and the buttons; striped rows of tulips
 * (coral, pink, lilac, yellow, sky, cream) run in perspective to it, under layered hazy hills and lit
 * clouds. Tall foreground tulips frame the shot, drawn with larger glyphs so they read as close to the
 * camera, backlit by the sun.
 *
 * Two passes: the scene is painted at a third of the resolution (its bilinear upscale gives the soft,
 * filmic base and a natural depth of field), then a full-resolution pass sets a crisp glyph in every cell,
 * chosen by how much "ink" the scene holds there and coloured from it, with bokeh, grain and a vignette.
 *
 *   move   the cursor is a little sun: warm light, tulips turn toward it, a trail of glitter; birds scatter from it
 *   click  on the field: plants a tulip there (sized by its distance), with a ripple through the rows;
 *          in the sky: a burst of petals
 *   drag   a gust and a trail of petals
 *   hold   the sun brightens and the tulips near the cursor open; let go and they burst into petals
 *
 * The loop stops while the hero is off screen or the tab is hidden. Under reduced motion one still frame is
 * drawn. Without WebGL2 the earlier CSS flowers are shown instead.
 */

const RAMP = [' ', '.', '·', ':', '-', '=', '+', '*', 'o', '%', '#', '@']
const SCRAMBLE = ['0', '1', '/', '\\', '<', '>', '$', '&', '?', '!']
const GLYPHS = [...RAMP, ...SCRAMBLE]
const MAX_TRAIL = 24
const MAX_BIRD = 12
const MAX_FG = 6
const MAX_PLANT = 16
const MAX_RIP = 6
const MAX_PART = 40
const PALETTES = 6

const VERT = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0., 1.); }`

const COMMON = `#version 300 es
precision highp float;
const vec3 PL[6] = vec3[6](vec3(.85,.73,1.), vec3(1.,.72,.52), vec3(1.,.66,.82), vec3(1.,.93,.6), vec3(.72,.86,1.), vec3(1.,.96,.92));
const vec3 PD[6] = vec3[6](vec3(.48,.36,1.), vec3(.95,.36,.25), vec3(.86,.27,.56), vec3(.97,.66,.22), vec3(.27,.45,.95), vec3(1.,.78,.66));
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
`

const SCENE = `${COMMON}
uniform vec2 uScene;
uniform float uAsp, uTime, uReveal, uHold, uScrollU, uMouseOn;
uniform vec2 uCam, uMouseF, uOffF;
uniform vec4 uSun; // x, horizon, radius, sun y
uniform vec4 uFgA[${MAX_FG}]; // head x, head y, radius, lean
uniform vec4 uFgB[${MAX_FG}]; // base x, palette, open, leaf side
uniform int uFgN;
uniform vec4 uPl[${MAX_PLANT}]; // x, y, planted at, palette
uniform int uPlN;
uniform vec4 uRp[${MAX_RIP}]; // x, y, started at
uniform int uRpN;
uniform vec4 uPt[${MAX_PART}]; // x, y, size, palette + life
uniform int uPtN;
out vec4 o;

float fbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return s; }
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.)); }
float sm(float x) { return smoothstep(0., 1., x); }
float ridged(float x, float seed) { float s = 0., a = .55, f = 1.; for (int i = 0; i < 5; i++) { float n = 1. - abs(2. * vnoise(vec2(x * f, seed)) - 1.); s += a * n * n; f *= 2.13; a *= .48; } return s; }

// A tulip head around its centre: a round cup, three pointed petals; op opens it into a bloom. Returns (coverage, u, v).
vec3 tulip(vec2 d, float r, float lean, float op) {
  float c = cos(lean * .8), s = sin(lean * .8);
  float U = (d.x * c + d.y * s) / r, V = (-d.x * s + d.y * c) / r;
  float body = sm(1.12 - (pow(U / (.56 + op * .22), 2.) + pow((V - .18) / (.52 - op * .12), 2.)));
  float centre = sm(1.1 - (pow(U / (.24 + .1 * max(0., V + .4)), 2.) + pow((V + .35 + op * .25) / (.66 - op * .1), 2.))) * (1. - op * .25);
  float sl = .3 + op * .55, cs = cos(sl), ss = sin(sl);
  float ly = V + .25 - op * .1;
  float lx = U + .3 + op * .4;
  float lu = lx * cs - ly * ss, lv = lx * ss + ly * cs;
  float left = sm(1.1 - (pow(lu / (.2 + .1 * max(0., lv + .3)), 2.) + pow(lv / .68, 2.)));
  float rx = U - .3 - op * .4;
  float ru = rx * cs + ly * ss, rv = -rx * ss + ly * cs;
  float right = sm(1.1 - (pow(ru / (.2 + .1 * max(0., rv + .3)), 2.) + pow(rv / .68, 2.)));
  return vec3(max(max(body, centre), max(left, right)), U, V);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uScene; uv.y = 1. - uv.y;
  vec2 P = vec2(uv.x * uAsp, uv.y);
  float t = uTime, H0 = uSun.y;
  float rev = smoothstep(0., 1., uReveal);

  // sky: lilac overhead, pink, then peach-gold at the horizon; the sun low in it
  vec2 Ps = P + uCam * .15 - vec2(0., uScrollU * .35);
  vec2 S = vec2(uSun.x, uSun.w);
  vec3 low = vec3(1., .87, .73);
  vec3 col = mix(vec3(.80, .76, .97), vec3(.98, .82, .88), smoothstep(-.05, .42, Ps.y));
  col = mix(col, low, smoothstep(.3, H0, Ps.y));
  float d = length(Ps - S);
  float glow = (exp(-d * 4.5) * .32 + exp(-d * 13.) * .4) * (1. + uHold * .8) * rev;
  col += vec3(1., .72, .45) * glow * .55;
  // long clouds, lit from below on the sun's side
  float band = smoothstep(.02, .14, Ps.y) * smoothstep(.5, .28, Ps.y);
  float cn = fbm(vec2(Ps.x * 1.3 + t * .012, Ps.y * 6.5));
  float cl = smoothstep(.42, .66, cn) * band;
  float under = smoothstep(.0, .02, fbm(vec2(Ps.x * 1.3 + t * .012, (Ps.y - .012) * 6.5)) - cn);
  vec3 cloudC = mix(vec3(1., .96, .98), vec3(1., .8, .62), exp(-d * 2.2));
  cloudC = mix(cloudC, vec3(.86, .74, .9), under * .5);
  col = mix(col, cloudC, cl * .88);
  float ink = .05 + cl * .38 + glow * .2;
  // the sun: a golden disc with a bright rim, glittering with light glyphs
  float disc = smoothstep(uSun.z, uSun.z * .95, d) * rev;
  float rimS = smoothstep(uSun.z * .8, uSun.z * .97, d) * disc;
  col = mix(col, mix(vec3(1., .9, .66), vec3(1., .99, .94), smoothstep(uSun.z, 0., d)), disc);
  col += vec3(.1, .06, 0.) * rimS;
  ink = mix(ink, .3 + .25 * rimS, disc);

  // two mountain ranges with snow, opening into a valley where the sun sets; faces toward the sun catch alpenglow
  vec2 Pm = P + uCam * .25 - vec2(0., uScrollU * .32);
  float valley = smoothstep(.03, .26, abs(Pm.x - S.x));
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    float seed = 3. + fk * 8.;
    float freq = 1.5 + fk * .9;
    float base = H0 - .09 + fk * .02;
    float amp = (.46 - fk * .16) * (.2 + .8 * valley);
    float top = base - amp * ridged(Pm.x * freq, seed);
    if (Pm.y > top) {
      float e = .018;
      float slope = (ridged((Pm.x + e) * freq, seed) - ridged((Pm.x - e) * freq, seed)) / (2. * e) * -amp;
      vec2 n = normalize(vec2(slope, -1.));
      float lit = clamp(dot(n, normalize(S - vec2(Pm.x, top))) * 1.4, 0., 1.);
      vec3 rock = mix(vec3(.63, .6, .84), vec3(.5, .5, .76), fk);
      vec3 c = mix(rock * .86, mix(rock, vec3(1., .8, .72), .55), lit);
      float snow = smoothstep(.045, .0, Pm.y - top) * smoothstep(base - .12, base - .24, top);
      c = mix(c, mix(vec3(.84, .84, .96), vec3(1., .93, .9), lit), snow * .9);
      // soft gullies running down from the ridge, not vertical bands
      float strata = fbm(vec2(Pm.x * 22. + Pm.y * 9., Pm.y * 26.));
      c *= .95 + .08 * strata;
      float mist = smoothstep(top + .03, base + .05, Pm.y);
      float far = .26 - fk * .12;
      col = mix(c, mix(low, col, .3), clamp(far + mist * .5 + exp(-abs(Pm.x - S.x) * 3.) * .2, 0., .9));
      ink = .2 + fk * .07 + snow * .25 + lit * .12 + strata * .08;
    }
  }

  // three hills, far to near, hazier toward the sun, rim-lit along their tops
  vec2 Ph = P + uCam * .4 - vec2(0., uScrollU * .3);
  float sunHaze = exp(-abs(Ph.x - S.x) * 2.);
  float hF = H0 - .085 - .06 * fbm(vec2(Ph.x * 1.1 + 2., 1.));
  float hM = H0 - .048 - .04 * vnoise(vec2(Ph.x * 2.1 + 7., 3.));
  float hN = H0 - .018 - .02 * vnoise(vec2(Ph.x * 3.6 + 1., 5.));
  float trees = smoothstep(.45, .85, vnoise(vec2(Ph.x * 38., 2.))) * smoothstep(.3, .6, vnoise(vec2(Ph.x * 3., 8.)));
  hN -= .016 * trees;
  float tex = fbm(Ph * vec2(26., 52.));
  if (Ph.y > hF) {
    float rim = smoothstep(.007, 0., Ph.y - hF) * sunHaze;
    col = mix(vec3(.84, .76, .93), low, .22 + .35 * sunHaze) * (.96 + .06 * tex) + vec3(1., .8, .55) * rim * .5;
    ink = .2 + rim * .3 + tex * .08;
  }
  if (Ph.y > hM) {
    float rim = smoothstep(.006, 0., Ph.y - hM) * sunHaze;
    col = mix(vec3(.7, .66, .88), low, .2 + .35 * sunHaze) * (.94 + .08 * tex) + vec3(1., .8, .55) * rim * .45;
    ink = .28 + rim * .3 + tex * .1;
  }
  if (Ph.y > hN) {
    float rim = smoothstep(.005, 0., Ph.y - hN) * sunHaze;
    col = mix(mix(vec3(.5, .7, .58), vec3(.36, .58, .5), trees), low, .1 + .3 * sunHaze) * (.92 + .1 * tex) + vec3(1., .82, .55) * rim * .45;
    ink = .36 + rim * .3 + tex * .12;
  }

  // the field: colour-striped rows running to the sun
  vec2 Pf = P + uOffF;
  vec2 dm = Pf - uMouseF;
  float fall = exp(-dot(dm, dm) / .014) * uMouseOn;
  if (Pf.y > H0) {
    float dd = Pf.y - H0;
    float z = .08 / max(dd, .0015);
    float wx = (Pf.x - S.x) * z;
    float gust = vnoise(vec2(wx * 5. - t * .45, z * 1.1 - t * .3));
    wx += sin(t * 1.2 + z * 5.) * .0012 + (gust - .5) * .003;
    wx += dm.x / (length(dm) + .015) * fall * .03 * z;
    for (int i = 0; i < ${MAX_RIP}; i++) {
      if (i >= uRpN) break;
      vec4 r = uRp[i];
      float age = t - r.z;
      vec2 dr = Pf - r.xy;
      float L = length(dr);
      float ring = exp(-pow((L - age * .85) / .035, 2.)) * max(0., 1. - age / 1.4);
      wx -= dr.x / (L + .01) * ring * .03 * z;
    }
    float sx = wx / .032, si = floor(sx), sf = fract(sx);
    int pi = int(mod(si, 6.));
    vec3 fc = mix(PL[pi], PD[pi], .5);
    float aisle = smoothstep(0., .14, sf) * smoothstep(1., .86, sf);
    vec2 q = vec2(fract(sf * 4.) - .5, fract(z * 20. + h21(vec2(si, 3.))) - .5);
    float blob = smoothstep(.5, .1, length(q * vec2(1., 1.5)) - fall * (.06 + uHold * .12));
    float rowD = smoothstep(.1, .24, dd), strD = smoothstep(.004, .03, dd);
    float fl = mix(.62, blob, rowD) * aisle;
    vec3 green = mix(vec3(.3, .58, .4), vec3(.47, .74, .5), vnoise(vec2(wx * 40., z * 8.)));
    vec3 fieldC = mix(green, fc, fl);
    fieldC = mix(mix(green, vec3(.95, .68, .74), .6), fieldC, strD);
    fieldC += vec3(1., .85, .6) * smoothstep(.55, .85, gust) * .12 * fl;
    fieldC = mix(fieldC, PL[pi], fall * uHold * fl * .8);
    float back = exp(-dd * 7.) * exp(-abs(Pf.x - S.x) * 1.5);
    fieldC += vec3(1., .78, .5) * back * .35 * rev;
    float haze = exp(-dd * 28.);
    col = mix(fieldC, mix(low, vec3(1., .9, .78), .5), haze * .85);
    ink = mix(.32, .42 + fl * .5, strD) * (1. - haze * .6) + fall * uHold * .2;
  }

  // planted tulips, sized by how far away they stand
  for (int i = 0; i < ${MAX_PLANT}; i++) {
    if (i >= uPlN) break;
    vec4 pl = uPl[i];
    float age = t - pl.z, g = clamp(age / 1.2, 0., 1.);
    float dep = max(pl.y - H0, .01);
    float hgt = dep * 1.25 * smoothstep(0., .65, g), r = dep * .2 * smoothstep(.4, 1., g);
    float lean = sin(t * 1.3 + pl.z) * .07 + (vnoise(vec2(t * .4, pl.x * 3.)) - .5) * .2 + dm.x / (length(dm) + .02) * fall * .3;
    vec2 hd = pl.xy + vec2(sin(lean), -cos(lean)) * hgt;
    if (seg(Pf, pl.xy, hd) < dep * .012 + .0015) { col = vec3(.28, .56, .38); ink = .55; }
    if (r > .001) {
      vec3 tv = tulip(Pf - hd, r, lean, .08 + .08 * sin(t + pl.z));
      if (tv.x > .05) { int pp = int(pl.w); col = mix(PL[pp], PD[pp], clamp((tv.z + 1.) * .5, 0., 1.)); ink = .45 + .5 * tv.x; }
    }
  }

  // petals in the air
  for (int i = 0; i < ${MAX_PART}; i++) {
    if (i >= uPtN) break;
    vec4 q = uPt[i];
    float L = length(Pf - q.xy);
    if (L < q.z) {
      int pp = int(q.w); float lf = fract(q.w);
      col = mix(col, mix(PL[pp], PD[pp], .4), smoothstep(0., .5, 1. - L / q.z) * (1. - lf));
      ink = max(ink, .85 * (1. - lf));
    }
  }

  // light shafts from the sun
  float ang = atan(Ps.y - S.y, Ps.x - S.x);
  float ry = smoothstep(.55, .95, vnoise(vec2(ang * 6., t * .08))) * exp(-d * 1.6) * (.22 + uHold * .45) * rev;
  col += vec3(1., .82, .58) * ry * .5;
  ink += ry * .15;

  // foreground tulips: near the lens, backlit
  vec2 Pg = P + uCam * 1.1;
  bool fg = false;
  for (int i = 0; i < ${MAX_FG}; i++) {
    if (i >= uFgN) break;
    vec4 A = uFgA[i], B = uFgB[i];
    vec2 hd = A.xy, bs = vec2(B.x, 1.12);
    float r = A.z, lean = A.w;
    vec2 ctl = vec2(bs.x, mix(bs.y, hd.y, .5));
    float sd = 1e3; vec2 prev = bs;
    for (int k = 1; k <= 6; k++) {
      float u = float(k) / 6.;
      vec2 pt = mix(mix(bs, ctl, u), mix(ctl, hd, u), u);
      sd = min(sd, seg(Pg, prev, pt)); prev = pt;
    }
    if (sd < r * .09) { fg = true; col = mix(vec3(.2, .46, .32), vec3(.45, .72, .5), smoothstep(r * .09, 0., sd)); ink = .6; }
    // leaf
    float lu0 = .35;
    vec2 lp = mix(mix(bs, ctl, lu0), mix(ctl, hd, lu0), lu0);
    float la = -1.5708 + B.w * .95 + lean * .6;
    vec2 ld = vec2(cos(la), sin(la));
    vec2 lc = lp + ld * r * 1.3;
    vec2 lq = Pg - lc;
    float lf = sm(1.05 - (pow(dot(lq, ld) / (r * 1.3), 2.) + pow(dot(lq, vec2(-ld.y, ld.x)) / (r * .32), 2.)));
    if (lf > .1) { fg = true; col = mix(vec3(.24, .52, .36), vec3(.5, .78, .52), lf); ink = .45 + .4 * lf; }
    vec3 tv = tulip(Pg - hd, r, lean, B.z);
    if (tv.x > .06) {
      fg = true;
      int pp = int(B.y);
      vec3 c = mix(PL[pp], PD[pp], clamp((tv.z + .9) * .6, 0., 1.));
      float facing = max(0., dot(normalize(S - hd), normalize(Pg - hd + 1e-4)));
      float edge = smoothstep(.06, .3, tv.x) * (1. - smoothstep(.3, .7, tv.x));
      c = mix(c, vec3(1., .95, .84), edge * facing * .8) * (.9 + .1 * tv.x);
      col = c; ink = .5 + .45 * tv.x;
      float heart = clamp(1. - (tv.y * tv.y + pow(tv.z + .05, 2.)) / (.06 + B.z * .06), 0., 1.) * smoothstep(.15, .55, B.z);
      if (heart > .3) { col = vec3(.98, .84, .32); ink = .95; }
    }
  }

  o = vec4(clamp(col, 0., 1.), fg ? .5 + clamp(ink, 0., 1.) * .5 : clamp(ink, 0., 1.) * .5);
}`

const MAIN = `${COMMON}
uniform sampler2D uScene, uAtlasS, uAtlasL;
uniform vec2 uDev, uCellS, uCellL, uMouse;
uniform float uTime, uReveal, uDpr, uMouseOn, uHold;
uniform vec4 uSunD;
uniform vec4 uCalm[2]; // the copy block and the buttons, device px
uniform vec4 uRpD[${MAX_RIP}];
uniform int uRpN;
uniform vec4 uTrail[${MAX_TRAIL}]; // x, y, age 0..1
uniform int uTrailN;
uniform vec4 uBird[${MAX_BIRD}]; // x, y, wing (-1 down .. 1 up), alpha
uniform int uBirdN;
out vec4 o;
const float RAMP = ${RAMP.length}.;
const float SCR = ${SCRAMBLE.length}.;

vec4 sceneAt(vec2 p) { // p: device px, top-left origin
  vec2 ts = vec2(textureSize(uScene, 0));
  return texelFetch(uScene, ivec2(clamp(vec2(p.x, uDev.y - p.y) / uDev * ts, vec2(0), ts - 1.)), 0);
}
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.)); }
float glint(vec2 d) { // a four-point star of light with a soft core
  vec2 a = abs(d);
  return (exp(-a.x * 7.) * exp(-a.y * .9) + exp(-a.y * 7.) * exp(-a.x * .9)) * .5 + exp(-dot(d, d) * 2.5);
}
float calmAt(vec4 r, vec2 p, float pad) {
  vec2 c = smoothstep(r.xy - pad, r.xy, p) * (1. - smoothstep(r.zw, r.zw + pad, p));
  return c.x * c.y;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uDev.y - gl_FragCoord.y);
  vec2 uv = p / uDev;
  vec3 base = texture(uScene, vec2(uv.x, 1. - uv.y)).rgb;

  // foreground cells are twice the size: the glyphs of near tulips read as close to the lens
  vec2 cL = floor(p / uCellL);
  vec4 sL = sceneAt((cL + .5) * uCellL);
  bool fg = sL.a >= .5;
  vec2 cs = fg ? uCellL : uCellS;
  vec2 cell = floor(p / cs);
  vec2 ctr = (cell + .5) * cs;
  vec4 s = fg ? sL : sceneAt(ctr);
  float ink = s.a >= .5 ? (s.a - .5) * 2. : s.a * 2.;

  float gi = floor(clamp(ink, 0., .999) * RAMP);
  float h = h21(cell + floor(uTime * 7.) * vec2(13.1, 7.7));
  if (h < .05) gi = max(gi - 1., 0.); else if (h > .96) gi = min(gi + 1., RAMP - 1.);

  // the cursor is a little sun: warm light, and the glyphs under it fill in and turn gold
  vec2 dmv = ctr - uMouse;
  float lr = (150. + uHold * 90.) * uDpr;
  float light = uMouseOn * exp(-dot(dmv, dmv) / (lr * lr));
  gi = min(gi + floor(light * 2.6), RAMP - 1.);

  // ...and leaves a trail of glitter that twinkles out
  float tr = 0.;
  for (int i = 0; i < ${MAX_TRAIL}; i++) {
    if (i >= uTrailN) break;
    vec4 q = uTrail[i];
    float rr = (30. - q.z * 14.) * uDpr;
    vec2 dq = ctr - q.xy;
    tr = max(tr, exp(-dot(dq, dq) / (rr * rr)) * (1. - q.z));
  }
  float hs = h21(cell * 2.3 + floor(uTime * 12.));
  bool spark = tr > .15 && hs < tr * .85;
  if (spark) gi = tr > .55 ? ${RAMP.indexOf('*')}. : hs < tr * .4 ? ${RAMP.indexOf('+')}. : ${RAMP.indexOf('·')}.;

  // scramble: along ripples, and as the scene decodes in from the sun
  float scr = 0.;
  float ringLit = 0.;
  for (int i = 0; i < ${MAX_RIP}; i++) {
    if (i >= uRpN) break;
    vec4 r = uRpD[i];
    float age = uTime - r.z;
    float ring = exp(-pow((length(ctr - r.xy) - age * 760. * uDpr) / (16. * uDpr), 2.)) * max(0., 1. - age / 1.4);
    scr = max(scr, ring * .9); ringLit = max(ringLit, ring);
  }
  float wave = uReveal * 1.5 - length(ctr - uSunD.xy) / length(uDev);
  scr = max(scr, 1. - smoothstep(0., .22, wave));
  bool scramble = h21(cell * 1.7 + floor(uTime * 16.)) < scr;
  if (scramble) gi = RAMP + floor(h21(cell + floor(uTime * 20.) * .37) * SCR);

  vec2 lp = p - cell * cs;
  float m = fg ? texelFetch(uAtlasL, ivec2(int(gi * uCellL.x + lp.x), int(lp.y)), 0).a
               : texelFetch(uAtlasS, ivec2(int(gi * uCellS.x + lp.x), int(lp.y)), 0).a;

  float lum = dot(s.rgb, vec3(.3, .59, .11));
  vec3 gc = mix(s.rgb * (fg ? .66 : .74), min(s.rgb * 1.15 + .08, vec3(1.)), smoothstep(.86, .97, lum));
  gc = mix(vec3(dot(gc, vec3(.3, .59, .11))), gc, 1.25);
  gc = mix(gc, vec3(1., .74, .3), light * .85);
  if (spark) gc = mix(vec3(1., .82, .4), vec3(1., .99, .95), h21(cell + floor(uTime * 9.)));
  if (scramble) gc = mix(gc, vec3(1., .98, .94), .55 + ringLit * .3);

  // behind the headline, the copy and the buttons the scene is calmer and lighter, so they read first
  float calm = max(calmAt(uCalm[0], p, 70. * uDpr), calmAt(uCalm[1], p, 56. * uDpr) * .95);
  vec3 col = mix(base, vec3(1., .96, .92), calm * .26);
  col += vec3(1., .82, .5) * light * .24 * (1. - calm * .5);
  col = mix(col, clamp(gc, 0., 1.), clamp(m, 0., 1.) * (spark ? .95 : mix(.9, .28, calm)));
  col += vec3(1., .86, .55) * tr * .14;

  // a flock crossing the sky: thin wing strokes that flap
  for (int i = 0; i < ${MAX_BIRD}; i++) {
    if (i >= uBirdN) break;
    vec4 b = uBird[i];
    float w = (b.w > .6 ? 10. : 7.) * uDpr;
    vec2 q = p - b.xy;
    if (abs(q.x) > w * 1.3 || abs(q.y) > w * 1.3) continue;
    float flap = b.z; // -1 wings down .. 1 wings up
    vec2 tipL = vec2(-w, -flap * w * .55), tipR = vec2(w, -flap * w * .55);
    vec2 midL = vec2(-w * .5, -flap * w * .1 - w * .18), midR = vec2(w * .5, -flap * w * .1 - w * .18);
    float dB = min(min(seg(q, vec2(0.), midL), seg(q, midL, tipL)), min(seg(q, vec2(0.), midR), seg(q, midR, tipR)));
    float bm = smoothstep(1.1 * uDpr, .3 * uDpr, dB);
    col = mix(col, vec3(.3, .25, .43), bm * min(1., b.w * 1.1));
  }

  // sunlight glints along the trail, and a small sun at the cursor
  for (int i = 0; i < ${MAX_TRAIL}; i++) {
    if (i >= uTrailN) break;
    if (i % 3 != 0) continue;
    vec4 q = uTrail[i];
    float life = 1. - q.z;
    float tw = .75 + .25 * sin(uTime * 18. + float(i) * 2.1);
    col += vec3(1., .9, .7) * glint((p - q.xy) / (uDpr * (3. + 11. * life))) * life * life * .55 * tw;
  }
  vec2 dc = (p - uMouse) / (uDpr * 16.);
  col += vec3(1., .88, .62) * (exp(-dot(dc, dc) * .5) * .3 + glint(dc * .45) * .35) * uMouseOn;

  // bokeh drifting up through the light
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float sp = .01 + .015 * h21(vec2(fi, 2.));
    vec2 c = vec2(uSunD.x / uDev.x + (h21(vec2(fi, 1.)) - .5) * .7 + sin(uTime * .2 + fi) * .02, 1.1 - fract(h21(vec2(fi, 4.)) + uTime * sp) * .62) * uDev;
    float r = (20. + 44. * h21(vec2(fi, 3.))) * uDpr;
    float dd = length(p - c) / r;
    float disc = smoothstep(1., .92, dd);
    float rim = smoothstep(.7, .98, dd) * disc;
    col += vec3(1., .9, .76) * (disc * .045 + rim * .05) * (1. - calm * .8);
  }

  // grade: a soft vignette, warm lift, grain; the scene fades in from the intro's white
  col *= mix(1., .95, smoothstep(.6, 1.2, length((uv - .5) * vec2(1.25, 1.))));
  col += (h21(p + fract(uTime * 3.7) * 311.) - .5) * .028;
  col = mix(vec3(1., .985, .97), col, smoothstep(0., .45, uReveal));
  o = vec4(col, 1.);
}`

type Fg = { hx: number; hy: number; bx: number; r: number; pal: number; side: number; th: number; om: number; open: number; phase: number }
type Plant = { x: number; y: number; t: number; pal: number }
type Rip = { x: number; y: number; t: number; hit: Set<Fg> }
type Bird = { x: number; y: number; vx: number; vy: number; ox: number; oy: number; flock: number; phase: number; a: number }
type Part = { x: number; y: number; vx: number; vy: number; s: number; pal: number; life: number; max: number; seed: number }

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
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
  g.font = `600 ${Math.round(ch * 0.86)}px "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace`
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

export function HeroGarden({ start }: { start: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const startRef = useRef(start)
  const [touched, setTouched] = useState(false)
  const [fallback, setFallback] = useState(false)
  useEffect(() => {
    startRef.current = start
  }, [start])

  useEffect(() => {
    const cv = canvas.current
    const host = cv?.closest('section')
    const gl = cv?.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' })
    if (!cv || !host || !gl) {
      if (cv && !gl) queueMicrotask(() => setFallback(true))
      return
    }
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let scene: ReturnType<typeof compile>
    let main: ReturnType<typeof compile>
    try {
      scene = compile(gl, VERT, SCENE)
      main = compile(gl, VERT, MAIN)
    } catch (e) {
      console.warn('hero garden:', e)
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

    const sceneTex = gl.createTexture()
    const fbo = gl.createFramebuffer()
    let atlasS: WebGLTexture | null = null
    let atlasL: WebGLTexture | null = null

    let W = 1
    let H = 1
    let dpr = 1
    let asp = 1
    let wide = true
    let sw = 1
    let sh = 1
    let cellS = [14, 24]
    let cellL = [28, 48]
    let horizon = 0.635
    let sunX = 0.9
    let sunR = 0.075
    const calm = new Float32Array(8)
    const trail: { x: number; y: number; t: number }[] = []
    let birds: Bird[] = []
    let fg: Fg[] = []
    const plants: Plant[] = []
    const rips: Rip[] = []
    const parts: Part[] = []
    const ptr = { x: -1e4, y: -1e4, vx: 0, vy: 0, last: -9, down: false, moved: 0, hold: 0 }
    const cam = { x: 0, y: 0 }
    let hold = 0
    let t = 0
    let revealT = 0
    let fontsReady = false

    const fgA = new Float32Array(MAX_FG * 4)
    const fgB = new Float32Array(MAX_FG * 4)
    const plA = new Float32Array(MAX_PLANT * 4)
    const rpA = new Float32Array(MAX_RIP * 4)
    const rpD = new Float32Array(MAX_RIP * 4)
    const ptA = new Float32Array(MAX_PART * 4)
    const trA = new Float32Array(MAX_TRAIL * 4)
    const bdA = new Float32Array(MAX_BIRD * 4)

    function layout() {
      const r = cv!.getBoundingClientRect()
      W = Math.max(1, r.width)
      H = Math.max(1, r.height)
      asp = W / H
      wide = W >= 900
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (W * H * dpr * dpr > 6e6) dpr = Math.sqrt(6e6 / (W * H))
      cv!.width = Math.round(W * dpr)
      cv!.height = Math.round(H * dpr)
      sw = Math.ceil(W / 3)
      sh = Math.ceil(H / 3)
      gl!.bindTexture(gl!.TEXTURE_2D, sceneTex)
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, sw, sh, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo)
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, sceneTex, 0)
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null)
      const s = wide ? [6, 10] : [5, 9]
      cellS = [Math.round(s[0] * dpr), Math.round(s[1] * dpr)]
      cellL = [cellS[0] * 2, cellS[1] * 2]
      atlasS = atlas(gl!, cellS[0], cellS[1], atlasS)
      atlasL = atlas(gl!, cellL[0], cellL[1], atlasL)
      // the copy block and the buttons, so the scene calms down behind them
      const c = host!.querySelector('[data-garden-copy]')?.getBoundingClientRect()
      const nav = host!.querySelector('[data-garden-calm]')?.getBoundingClientRect()
      calm.fill(-1e5)
      ;[c, nav].forEach((b, i) => b && calm.set([(b.left - r.left) * dpr, (b.top - r.top) * dpr, (b.right - r.left) * dpr, (b.bottom - r.top) * dpr], i * 4))
      // the flock: a V of seven and three stragglers further off
      if (!birds.length)
        birds = Array.from({ length: 10 }, (_, i) => {
          const k = Math.ceil(i / 2)
          const flock = i < 7 ? 0 : 1
          const j = flock ? i - 7 : 0
          return { x: -999, y: -999, vx: 0, vy: 0, ox: flock ? j * 34 : k * 26, oy: flock ? (j % 2 ? 9 : -6) * j : (i % 2 ? 1 : -1) * k * 14, flock, phase: i * 1.3, a: flock ? 0.45 : 0.8 }
        })
      if (wide) {
        horizon = 0.635
        sunX = 0.548 * asp
        sunR = 0.062
      } else {
        horizon = Math.min(0.7, Math.max(0.28, (c ? c.bottom - r.top : H * 0.3) / H + 0.015))
        sunX = 0.8 * asp
        sunR = Math.min(0.05, asp * 0.11)
      }
      // [head x (fraction of width), head y, radius, palette, base x (fraction of width)]
      const spec = wide
        ? [
            [0.04, 0.84, 0.1, 1, 0.065],
            [0.515, 0.47, 0.052, 2, 0.53],
            [0.965, 0.83, 0.105, 0, 0.94],
            [0.655, 0.9, 0.055, 3, 0.64],
            [0.3, 0.95, 0.062, 5, 0.285],
          ]
        : [
            [0.1, 0.95, 0.045, 1, 0.08],
            [0.9, 0.94, 0.05, 0, 0.93],
          ]
      const old = fg
      fg = spec.map(([hx, hy, r_, pal, bx], i) => ({ hx: hx * asp, hy, r: r_, pal, bx: bx * asp, side: i % 2 ? 1 : -1, th: old[i]?.th ?? 0, om: old[i]?.om ?? 0, open: old[i]?.open ?? 0, phase: i * 1.7 }))
    }

    const sunY = () => horizon - 0.1 + (1 - Math.pow(Math.min(1, revealT / 2.6), 0.6)) * 0.2
    const scrollU = () => Math.min(window.scrollY, H) / H
    const offF = () => [cam.x * 0.7, cam.y * 0.7 - scrollU() * 0.25]
    const toField = (x: number, y: number) => {
      const o = offF()
      return [x / H + o[0], y / H + o[1]]
    }
    const fgHead = (f: Fg) => {
      const bx = f.bx
      const by = 1.12
      const dx = f.hx - bx
      const dy = f.hy - by
      const c = Math.cos(f.th)
      const s = Math.sin(f.th)
      return [bx + dx * c - dy * s, by + dx * s + dy * c]
    }

    function emit(x: number, y: number, n: number, pal: number, speed = 0.25) {
      for (let i = 0; i < n && parts.length < MAX_PART; i++) {
        const a = Math.random() * Math.PI * 2
        const v = speed * (0.3 + Math.random() * 0.7)
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.08, s: 0.004 + Math.random() * 0.006, pal: pal < 0 ? Math.floor(Math.random() * PALETTES) : pal, life: 0, max: 1.4 + Math.random() * 1.6, seed: Math.random() * 6 })
      }
    }

    function step(dt: number) {
      t += dt
      if (startRef.current || still) revealT += dt
      const wind = Math.sin(t * 0.37) * 0.05 + Math.sin(t * 1.13 + 1) * 0.03
      if (ptr.down && ptr.moved < 10) ptr.hold += dt
      hold += ((ptr.hold > 0.22 ? 1 : 0) - hold) * Math.min(1, dt * 3)
      const on = t - ptr.last < 1.5
      const mx = on ? ptr.x / W - 0.5 : 0
      const my = on ? ptr.y / H - 0.5 : 0
      cam.x += (mx * 0.05 - cam.x) * Math.min(1, dt * 1.6)
      cam.y += (my * 0.025 - cam.y) * Math.min(1, dt * 1.6)
      const mg = [ptr.x / H + cam.x * 1.1, ptr.y / H + cam.y * 1.1]
      const speed = Math.hypot(ptr.vx, ptr.vy)
      for (const f of fg) {
        const [hx, hy] = fgHead(f)
        const dx = hx - mg[0]
        const d = Math.hypot(dx, hy - mg[1])
        const k = on && d < 0.32 ? (1 - d / 0.32) ** 2 : 0
        const target = wind + Math.sin(t * 1.1 + f.phase) * 0.03 + -Math.sign(dx) * k * 0.28 + Math.max(-1, Math.min(1, ptr.vx / 1800)) * k * 0.5
        f.om += ((target - f.th) * 22 - f.om * 4) * dt
        f.th = Math.max(-0.6, Math.min(0.6, f.th + f.om * dt))
        const near = hold > 0.5 && d < 0.3 + hold * 0.15
        f.open += ((near ? 1 : 0.05 + 0.04 * Math.sin(t * 0.8 + f.phase)) - f.open) * Math.min(1, dt * (near ? 3 : 1.5))
        if (speed > 900 && on && t - ptr.last < 0.05 && d < f.r * 1.4 && Math.random() < 0.5) {
          const o = offF()
          emit(hx - cam.x * 1.1 + o[0], hy - cam.y * 1.1 + o[1], 2, f.pal, 0.2)
        }
      }
      for (const r of rips) {
        const rad = (t - r.t) * 0.85
        const o = offF()
        for (const f of fg) {
          const [hx, hy] = fgHead(f)
          const fx = hx - cam.x * 1.1 + o[0]
          const fy = hy - cam.y * 1.1 + o[1]
          if (!r.hit.has(f) && Math.abs(Math.hypot(fx - r.x, fy - r.y) - rad) < 0.05) {
            r.hit.add(f)
            f.om += Math.sign(fx - r.x || 1) * 2.4 * (1 - (t - r.t) / 1.4)
          }
        }
      }
      while (rips.length && t - rips[0].t > 1.4) rips.shift()
      while (trail.length && t - trail[0].t > 1.3) trail.shift()
      // the flock follows its leader across the sky, scatters from the cursor, then regroups
      const span = W + 300
      const lead = [
        [W + 120 - ((t * 30 + W * 0.25) % span), (wide ? H * 0.13 : 108) + Math.sin(t * 0.35) * (wide ? H * 0.02 : 6)],
        [W + 120 - ((t * 19 + W * 0.95) % span), (wide ? H * 0.25 : 124) + Math.sin(t * 0.5 + 2) * (wide ? H * 0.015 : 4)],
      ]
      for (const b of birds) {
        const tx = lead[b.flock][0] + b.ox + Math.sin(t * 1.3 + b.phase) * 3
        const ty = lead[b.flock][1] + b.oy + Math.cos(t * 1.1 + b.phase) * 3
        if (Math.abs(tx - b.x) > W * 0.4) {
          b.x = tx
          b.y = ty
          b.vx = 0
          b.vy = 0
        }
        let fear = 0
        const dx = b.x - ptr.x
        const dy = b.y - ptr.y
        const d = Math.hypot(dx, dy)
        if (on && d < 140) {
          fear = 1 - d / 140
          b.vx += (dx / (d || 1)) * fear * 2600 * dt
          b.vy += ((dy / (d || 1)) * fear - 0.6 * fear) * 2600 * dt
        }
        b.vx += ((tx - b.x) * 3 - b.vx * 2.2) * dt
        b.vy += ((ty - b.y) * 3 - b.vy * 2.2) * dt
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.phase += dt * (7 + fear * 14 + Math.min(10, Math.hypot(b.vx, b.vy) / 40))
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i]
        q.life += dt
        if (q.life > q.max) {
          parts.splice(i, 1)
          continue
        }
        q.vx += (wind * 1.6 + Math.sin(t * 3 + q.seed) * 0.05 - q.vx) * 1.2 * dt
        q.vy += (0.05 - q.vy) * 1.1 * dt
        q.x += q.vx * dt
        q.y += q.vy * dt
      }
      ptr.vx *= Math.exp(-dt * 6)
      ptr.vy *= Math.exp(-dt * 6)
    }

    function render() {
      if (!fontsReady) return
      const on = t - ptr.last < 1.5 && ptr.x > -1e3 ? Math.min(1, Math.max(0, 1.5 - (t - ptr.last)) * 2) : 0
      const reveal = Math.min(1, revealT / 2.6)
      const o = offF()
      fgA.fill(0)
      fgB.fill(0)
      fg.forEach((f, i) => {
        const [hx, hy] = fgHead(f)
        fgA.set([hx, hy, f.r, f.th], i * 4)
        fgB.set([f.bx, f.pal, f.open, f.side], i * 4)
      })
      plants.forEach((p, i) => plA.set([p.x, p.y, p.t, p.pal], i * 4))
      rips.forEach((r, i) => {
        rpA.set([r.x, r.y, r.t, 0], i * 4)
        rpD.set([(r.x - o[0]) * H * dpr, (r.y - o[1]) * H * dpr, r.t, 0], i * 4)
      })
      parts.forEach((q, i) => ptA.set([q.x, q.y, q.s * Math.min(1, q.life / 0.2 + 0.3), q.pal + Math.min(0.99, q.life / q.max)], i * 4))

      const g = gl!
      g.bindVertexArray(vao)
      g.bindFramebuffer(g.FRAMEBUFFER, fbo)
      g.viewport(0, 0, sw, sh)
      g.useProgram(scene.prog)
      const u = scene.u
      g.uniform2f(u('uScene'), sw, sh)
      g.uniform1f(u('uAsp'), asp)
      g.uniform1f(u('uTime'), t)
      g.uniform1f(u('uReveal'), reveal)
      g.uniform1f(u('uHold'), hold)
      g.uniform1f(u('uScrollU'), scrollU())
      g.uniform1f(u('uMouseOn'), on)
      g.uniform2f(u('uCam'), cam.x, cam.y)
      g.uniform2f(u('uMouseF'), ptr.x / H + o[0], ptr.y / H + o[1])
      g.uniform2f(u('uOffF'), o[0], o[1])
      g.uniform4f(u('uSun'), sunX, horizon, sunR, sunY())
      g.uniform4fv(u('uFgA'), fgA)
      g.uniform4fv(u('uFgB'), fgB)
      g.uniform1i(u('uFgN'), fg.length)
      g.uniform4fv(u('uPl'), plA)
      g.uniform1i(u('uPlN'), plants.length)
      g.uniform4fv(u('uRp'), rpA)
      g.uniform1i(u('uRpN'), rips.length)
      g.uniform4fv(u('uPt'), ptA)
      g.uniform1i(u('uPtN'), parts.length)
      g.drawArrays(g.TRIANGLES, 0, 3)

      g.bindFramebuffer(g.FRAMEBUFFER, null)
      g.viewport(0, 0, cv!.width, cv!.height)
      g.useProgram(main.prog)
      const v = main.u
      g.activeTexture(g.TEXTURE0)
      g.bindTexture(g.TEXTURE_2D, sceneTex)
      g.activeTexture(g.TEXTURE1)
      g.bindTexture(g.TEXTURE_2D, atlasS)
      g.activeTexture(g.TEXTURE2)
      g.bindTexture(g.TEXTURE_2D, atlasL)
      g.uniform1i(v('uScene'), 0)
      g.uniform1i(v('uAtlasS'), 1)
      g.uniform1i(v('uAtlasL'), 2)
      g.uniform2f(v('uDev'), cv!.width, cv!.height)
      g.uniform2f(v('uCellS'), cellS[0], cellS[1])
      g.uniform2f(v('uCellL'), cellL[0], cellL[1])
      g.uniform2f(v('uMouse'), ptr.x * dpr, ptr.y * dpr)
      g.uniform1f(v('uTime'), t)
      g.uniform1f(v('uReveal'), reveal)
      g.uniform1f(v('uDpr'), dpr)
      g.uniform1f(v('uMouseOn'), on)
      g.uniform1f(v('uHold'), hold)
      g.uniform4fv(v('uCalm'), calm)
      trA.fill(0)
      trail.slice(-MAX_TRAIL).forEach((q, i) => trA.set([q.x * dpr, q.y * dpr, (t - q.t) / 1.3, 0], i * 4))
      g.uniform4fv(v('uTrail'), trA)
      g.uniform1i(v('uTrailN'), Math.min(trail.length, MAX_TRAIL))
      birds.forEach((b, i) => {
        const f = Math.sin(b.phase) * 0.8 + 0.2
        bdA.set([b.x * dpr, b.y * dpr, f, b.a * Math.min(1, revealT / 3)], i * 4)
      })
      g.uniform4fv(v('uBird'), bdA)
      g.uniform1i(v('uBirdN'), birds.length)
      g.uniform4f(v('uSunD'), (sunX - cam.x * 0.15) * H * dpr, (sunY() + scrollU() * 0.35) * H * dpr, 0, 0)
      g.uniform4fv(v('uRpD'), rpD)
      g.uniform1i(v('uRpN'), rips.length)
      g.drawArrays(g.TRIANGLES, 0, 3)
    }

    layout()
    if (still) revealT = 9

    let raf = 0
    let prev = 0
    let visible = true
    let alive = true
    const loop = (now: number) => {
      const dt = Math.min(0.05, prev ? (now - prev) / 1000 : 0.016)
      prev = now
      step(dt)
      render()
      raf = requestAnimationFrame(loop)
    }
    const run = () => {
      cancelAnimationFrame(raf)
      prev = 0
      if (!still && visible && !document.hidden) raf = requestAnimationFrame(loop)
    }
    document.fonts
      .load(`600 24px "Geist Mono"`)
      .catch(() => null)
      .then(() => {
        if (!alive) return
        fontsReady = true
        layout()
        render()
        run()
      })
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      run()
    })
    io.observe(cv)
    const onVis = () => run()
    document.addEventListener('visibilitychange', onVis)
    const ro = new ResizeObserver(() => {
      layout()
      render()
    })
    ro.observe(cv)

    const local = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top] as const
    }
    const inHero = (e: PointerEvent) => host.contains(e.target as Node)
    const interactive = (e: PointerEvent) => !!(e.target as Element).closest?.('a,button,input,textarea,select,[role=button]')
    let lastMove = 0
    const onMove = (e: PointerEvent) => {
      if (!inHero(e) || still) return
      const [x, y] = local(e)
      const now = performance.now()
      const gap = Math.max(8, now - lastMove) / 1000
      if (t - ptr.last < 0.2) {
        ptr.vx = ptr.vx * 0.5 + ((x - ptr.x) / gap) * 0.5
        ptr.vy = ptr.vy * 0.5 + ((y - ptr.y) / gap) * 0.5
      }
      lastMove = now
      if (ptr.down) {
        ptr.moved += Math.hypot(x - ptr.x, y - ptr.y)
        if (ptr.moved > 10 && Math.random() < 0.6) {
          const [fx, fy] = toField(x, y)
          emit(fx, fy, 1, -1, 0.06)
        }
      }
      const tl = trail[trail.length - 1]
      if (!tl || Math.hypot(x - tl.x, y - tl.y) > 7) {
        trail.push({ x, y, t })
        if (trail.length > MAX_TRAIL) trail.shift()
      }
      ptr.x = x
      ptr.y = y
      ptr.last = t
    }
    const onDown = (e: PointerEvent) => {
      if (!inHero(e) || interactive(e) || e.button > 0 || still) return
      const [x, y] = local(e)
      Object.assign(ptr, { x, y, down: true, moved: 0, hold: 0, last: t })
      setTouched(true)
    }
    const onUp = (e: PointerEvent) => {
      if (!ptr.down) return
      const [x, y] = local(e)
      const [fx, fy] = toField(x, y)
      if (ptr.hold > 0.35) {
        // let go of a hold: the open blooms burst
        const o = offF()
        for (const f of fg) {
          if (f.open < 0.5) continue
          const [hx, hy] = fgHead(f)
          emit(hx - cam.x * 1.1 + o[0], hy - cam.y * 1.1 + o[1], 9, f.pal, 0.35)
        }
        rips.push({ x: fx, y: fy, t, hit: new Set() })
      } else if (ptr.moved < 10 && e.type === 'pointerup') {
        if (fy > horizon + 0.008) {
          plants.push({ x: fx, y: fy, t, pal: Math.floor(Math.random() * PALETTES) })
          if (plants.length > MAX_PLANT) plants.shift()
        } else emit(fx, fy, 12, -1, 0.3)
        rips.push({ x: fx, y: fy, t, hit: new Set() })
      }
      if (rips.length > MAX_RIP) rips.shift()
      ptr.down = false
      ptr.hold = 0
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('pointerup', onUp, { passive: true })
    window.addEventListener('pointercancel', onUp, { passive: true })
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      io.disconnect()
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      gl.deleteTexture(sceneTex)
      gl.deleteTexture(atlasS)
      gl.deleteTexture(atlasL)
      gl.deleteFramebuffer(fbo)
      gl.deleteBuffer(buf)
      gl.deleteVertexArray(vao)
      gl.deleteProgram(scene.prog)
      gl.deleteProgram(main.prog)
    }
  }, [])

  if (fallback) return <HeroBloom className="absolute inset-y-0 right-0 w-[min(68%,1100px)]" />
  return (
    <>
      <canvas ref={canvas} aria-hidden className="pointer-events-none block h-full w-full" />
      <span
        aria-hidden
        className={`pointer-events-none absolute right-[clamp(20px,4vw,56px)] bottom-[clamp(22px,3vw,34px)] z-[1] hidden rounded-pill bg-white/55 px-3.5 py-1.5 font-mono text-[11px] tracking-[.08em] text-ink-2 backdrop-blur-md transition-opacity duration-700 md:block ${touched || !start ? 'opacity-0' : 'opacity-100'}`}
      >
        ✿ MOVE TO SHINE · CLICK THE FIELD TO PLANT · HOLD TO BLOOM
      </span>
    </>
  )
}
