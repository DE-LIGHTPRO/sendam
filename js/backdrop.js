// "Lights on": the background behind every page.
//
// Two layers, both on the GPU:
//  1. Light: a shader of liquid light (domain-warped noise in cream, sand and amber) with
//     soft rays from a source above the top-right corner. When the page opens, the light
//     flickers on like a bulb catching, then pours out.
//  2. Liquid: a real fluid simulation (advection, vorticity, pressure) that the cursor stirs,
//     that scrolling pushes, and that drifts on its own when nobody touches it. It carries
//     warm dye and bends the silk of the light layer as it moves.
//
// Engineering: both layers render below screen resolution, quality steps down if frames run
// slow, everything pauses in hidden tabs, reduced motion gets one still frame, and if the
// device cannot run the simulation the light layer runs alone. Without WebGL at all, the
// CSS glow underneath shows instead.

const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = document.createElement('canvas');
canvas.className = 'backdrop';
canvas.setAttribute('aria-hidden', 'true');
const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' };
const gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
const isGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

// ---- Shaders ---------------------------------------------------------------------------
const QUAD_VERT = `
precision highp float;
attribute vec2 a;
varying vec2 vUv;
varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
uniform vec2 texel;
void main() {
  vUv = a * 0.5 + 0.5;
  vL = vUv - vec2(texel.x, 0.0); vR = vUv + vec2(texel.x, 0.0);
  vT = vUv + vec2(0.0, texel.y); vB = vUv - vec2(0.0, texel.y);
  gl_Position = vec4(a, 0.0, 1.0);
}`;

const LIGHT_FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uLight;
uniform float uScroll;
uniform float uOn;
uniform float uFluid;
uniform sampler2D uDye;
uniform sampler2D uVel;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = r * p * 2.02 + 3.1; a *= 0.48; }
  return v;
}

void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  // The liquid bends the silk as it flows.
  vec2 flow = uFluid > 0.5 ? texture2D(uVel, uv).xy : vec2(0.0);
  vec2 p = vec2(uv.x * aspect, uv.y) * 0.95 - flow * 0.00018;
  p.y -= uScroll * 0.00035;
  float t = uTime * 0.045;

  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t * 0.8));
  vec2 r = vec2(fbm(p + 2.6 * q + vec2(1.7, 9.2) + t * 0.6), fbm(p + 2.6 * q + vec2(8.3, 2.8) - t * 0.5));
  float f = fbm(p + 2.4 * r);

  vec3 cream = vec3(0.957, 0.949, 0.929);
  vec3 sand  = vec3(0.905, 0.872, 0.800);
  vec3 amber = vec3(0.973, 0.760, 0.400);
  vec3 sage  = vec3(0.820, 0.870, 0.790);
  vec3 col = mix(cream, sand, smoothstep(0.3, 0.8, f) * 0.85);
  col = mix(col, sage, smoothstep(0.55, 0.9, q.y) * 0.22);

  vec2 lp = vec2(uLight.x * aspect, uLight.y);
  vec2 d = vec2(uv.x * aspect, uv.y) - lp;
  float dist = length(d);
  float glow = exp(-dist * 1.45) * uOn;
  float ang = atan(d.y, d.x);
  float rays = fbm(vec2(ang * 5.5, t * 1.4)) * 0.75 + fbm(vec2(ang * 13.0 - 2.0, -t * 2.0)) * 0.35;
  rays = pow(clamp(rays, 0.0, 1.0), 3.0) * smoothstep(1.7, 0.05, dist) * uOn;

  float pool = smoothstep(0.5, 0.95, f * (0.6 + r.x)) * (0.08 + glow * 1.1);
  col = mix(col, amber, clamp(pool * 0.5 + glow * 0.38 + rays * 0.55, 0.0, 0.72));
  float sheen = pow(1.0 - abs(f - 0.52) * 2.0, 12.0);
  col += vec3(1.0, 0.98, 0.93) * sheen * 0.12 * (0.4 + glow);
  col += vec3(1.0, 0.92, 0.75) * glow * 0.10;

  // The liquid's dye, laid over the light like light through honey.
  if (uFluid > 0.5) {
    vec3 dye = texture2D(uDye, uv).rgb;
    float d = min(0.72, 1.0 - exp(-length(dye) * 2.2)); // how much liquid light is here (capped for legibility)
    vec3 hue = dye / max(max(dye.r, dye.g), max(dye.b, 0.0001));
    // Tint towards the dye's colour (like honey in light), with a little glow of its own.
    col = mix(col, col * mix(vec3(1.0), hue, 0.78), d * 0.46);
    col += hue * d * 0.07;
    // A bright rim where the liquid thins, so it reads as glass, not paint.
    float edge = d * (1.0 - d) * 4.0;
    col += vec3(1.0, 0.95, 0.85) * edge * 0.05;
  }

  float vig = smoothstep(1.35, 0.35, length((uv - 0.5) * vec2(aspect * 0.9, 1.0)));
  col *= mix(0.93, 1.0, vig);
  col = mix(cream * 0.965, col, 0.3 + 0.7 * uOn);
  col += (hash(gl_FragCoord.xy + fract(uTime) * 17.0) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

const SPLAT_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTarget;
uniform float aspect;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
void main() {
  vec2 p = vUv - point;
  p.x *= aspect;
  vec3 splat = exp(-dot(p, p) / radius) * color;
  gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + splat, 1.0);
}`;

const ADVECT_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texel;
uniform float dt;
uniform float dissipation;
void main() {
  vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texel;
  gl_FragColor = texture2D(uSource, coord) / (1.0 + dissipation * dt);
}`;

const DIVERGENCE_FRAG = `
precision highp float;
varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
uniform sampler2D uVelocity;
void main() {
  float L = texture2D(uVelocity, vL).x, R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y, B = texture2D(uVelocity, vB).y;
  vec2 C = texture2D(uVelocity, vUv).xy;
  if (vL.x < 0.0) L = -C.x;
  if (vR.x > 1.0) R = -C.x;
  if (vT.y > 1.0) T = -C.y;
  if (vB.y < 0.0) B = -C.y;
  gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;

const CURL_FRAG = `
precision highp float;
varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
uniform sampler2D uVelocity;
void main() {
  float L = texture2D(uVelocity, vL).y, R = texture2D(uVelocity, vR).y;
  float T = texture2D(uVelocity, vT).x, B = texture2D(uVelocity, vB).x;
  gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`;

const VORTICITY_FRAG = `
precision highp float;
varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
void main() {
  float L = texture2D(uCurl, vL).x, R = texture2D(uCurl, vR).x;
  float T = texture2D(uCurl, vT).x, B = texture2D(uCurl, vB).x;
  float C = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  vec2 v = texture2D(uVelocity, vUv).xy + force * dt;
  gl_FragColor = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
}`;

const PRESSURE_FRAG = `
precision highp float;
varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main() {
  float L = texture2D(uPressure, vL).x, R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x, B = texture2D(uPressure, vB).x;
  float div = texture2D(uDivergence, vUv).x;
  gl_FragColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}`;

const GRADIENT_FRAG = `
precision highp float;
varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main() {
  float L = texture2D(uPressure, vL).x, R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x, B = texture2D(uPressure, vB).x;
  vec2 v = texture2D(uVelocity, vUv).xy - vec2(R - L, T - B);
  gl_FragColor = vec4(v, 0.0, 1.0);
}`;

const SCALE_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTexture;
uniform float value;
void main() { gl_FragColor = value * texture2D(uTexture, vUv); }`;

// ---- Plumbing --------------------------------------------------------------------------
function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const vert = () => compile(gl.VERTEX_SHADER, QUAD_VERT);
function program(frag) {
  const p = gl.createProgram();
  gl.attachShader(p, vert());
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(p, 0, 'a');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; uniforms[name] = gl.getUniformLocation(p, name); }
  return { p, u: uniforms, use() { gl.useProgram(p); return uniforms; } };
}

// Render targets for the simulation: half-float when the device can render to it.
function floatFormat() {
  if (!isGL2) return null;
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return null;
  return { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
}
function target(w, h, fmt) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, fmt.format, fmt.type, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('render target unsupported');
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { tex, fbo, w, h, texel: [1 / w, 1 / h], bind(unit) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); return unit; } };
}
function pair(w, h, fmt) {
  let a = target(w, h, fmt), b = target(w, h, fmt);
  return { get read() { return a; }, get write() { return b; }, swap() { [a, b] = [b, a]; }, w, h, texel: a.texel };
}

function start() {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const blit = (t) => {
    if (t) { gl.viewport(0, 0, t.w, t.h); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); }
    else { gl.viewport(0, 0, canvas.width, canvas.height); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const light = program(LIGHT_FRAG);
  const small = innerWidth < 700;
  let scale = small ? 0.4 : 0.55;

  // ---- The liquid ----
  let fluid = null;
  const fmt = calm ? null : floatFormat();
  if (fmt) {
    try {
      const simW = small ? 96 : 128;
      const res = (base) => { const a = innerWidth / innerHeight; return a >= 1 ? [Math.round(base * a), base] : [base, Math.round(base / a)]; };
      const [sw, sh] = res(simW);
      const [dw, dh] = res(small ? 256 : 384);
      fluid = {
        vel: pair(sw, sh, fmt), dye: pair(dw, dh, fmt), pressure: pair(sw, sh, fmt),
        div: target(sw, sh, fmt), curl: target(sw, sh, fmt),
        splat: program(SPLAT_FRAG), advect: program(ADVECT_FRAG), divergence: program(DIVERGENCE_FRAG),
        curlP: program(CURL_FRAG), vort: program(VORTICITY_FRAG), press: program(PRESSURE_FRAG),
        grad: program(GRADIENT_FRAG), scaleP: program(SCALE_FRAG),
      };
    } catch (err) {
      console.warn('Liquid layer off:', err.message);
      fluid = null;
    }
  }

  const PALETTE = [[1.0, 0.66, 0.24], [1.0, 0.8, 0.42], [0.98, 0.56, 0.32], [0.95, 0.72, 0.36], [0.6, 0.78, 0.52]];
  function splat(x, y, dx, dy, color, radius = 0.0028) {
    if (!fluid) return;
    const aspect = innerWidth / innerHeight;
    let u = fluid.splat.use();
    gl.uniform1f(u.aspect, aspect);
    gl.uniform2f(u.point, x, y);
    gl.uniform1f(u.radius, radius * (aspect > 1 ? aspect : 1));
    gl.uniform1i(u.uTarget, fluid.vel.read.bind(0));
    gl.uniform3f(u.color, dx, dy, 0);
    gl.uniform2f(u.texel, ...fluid.vel.texel);
    blit(fluid.vel.write); fluid.vel.swap();
    gl.uniform1i(u.uTarget, fluid.dye.read.bind(0));
    gl.uniform3f(u.color, color[0], color[1], color[2]);
    gl.uniform2f(u.texel, ...fluid.dye.texel);
    blit(fluid.dye.write); fluid.dye.swap();
  }
  const warm = (k = 0.16) => PALETTE[(Math.random() * (Math.random() < 0.85 ? 4 : 5)) | 0].map((c) => c * k);

  function step(dt) {
    const f = fluid;
    let u = f.curlP.use();
    gl.uniform2f(u.texel, ...f.vel.texel);
    gl.uniform1i(u.uVelocity, f.vel.read.bind(0));
    blit(f.curl);

    u = f.vort.use();
    gl.uniform2f(u.texel, ...f.vel.texel);
    gl.uniform1i(u.uVelocity, f.vel.read.bind(0));
    gl.uniform1i(u.uCurl, f.curl.bind(1));
    gl.uniform1f(u.curl, 24);
    gl.uniform1f(u.dt, dt);
    blit(f.vel.write); f.vel.swap();

    u = f.divergence.use();
    gl.uniform2f(u.texel, ...f.vel.texel);
    gl.uniform1i(u.uVelocity, f.vel.read.bind(0));
    blit(f.div);

    u = f.scaleP.use();
    gl.uniform1i(u.uTexture, f.pressure.read.bind(0));
    gl.uniform1f(u.value, 0.8);
    blit(f.pressure.write); f.pressure.swap();

    u = f.press.use();
    gl.uniform2f(u.texel, ...f.vel.texel);
    gl.uniform1i(u.uDivergence, f.div.bind(0));
    for (let i = 0; i < 16; i++) {
      gl.uniform1i(u.uPressure, f.pressure.read.bind(1));
      blit(f.pressure.write); f.pressure.swap();
    }

    u = f.grad.use();
    gl.uniform2f(u.texel, ...f.vel.texel);
    gl.uniform1i(u.uPressure, f.pressure.read.bind(0));
    gl.uniform1i(u.uVelocity, f.vel.read.bind(1));
    blit(f.vel.write); f.vel.swap();

    u = f.advect.use();
    gl.uniform2f(u.texel, ...f.vel.texel);
    gl.uniform1i(u.uVelocity, f.vel.read.bind(0));
    gl.uniform1i(u.uSource, f.vel.read.bind(0));
    gl.uniform1f(u.dt, dt);
    gl.uniform1f(u.dissipation, 0.25);
    blit(f.vel.write); f.vel.swap();

    gl.uniform2f(u.texel, ...f.vel.texel);
    gl.uniform1i(u.uVelocity, f.vel.read.bind(0));
    gl.uniform1i(u.uSource, f.dye.read.bind(1));
    gl.uniform1f(u.dissipation, 0.4);
    blit(f.dye.write); f.dye.swap();
  }

  function size() {
    canvas.width = Math.max(2, Math.round(innerWidth * scale));
    canvas.height = Math.max(2, Math.round(innerHeight * scale));
  }
  size();
  addEventListener('resize', size);

  // ---- The light ----
  const home = { x: 0.9, y: 1.05 };
  const lamp = { ...home };
  const aim = { ...home };
  let scroll = scrollY;
  let lastScroll = scrollY;
  const pointer = { x: 0, y: 0, moved: false, last: 0 };
  let lastTouch = performance.now();

  // A new touch starts a new stroke; without this, lifting a finger and touching somewhere
  // else would read as one enormous swipe.
  const lift = (e) => { if (e.pointerType !== 'mouse') pointer.moved = false; };
  addEventListener('pointerdown', lift, { passive: true });
  addEventListener('pointerup', lift, { passive: true });
  addEventListener('pointercancel', lift, { passive: true });
  addEventListener('pointermove', (e) => {
    const x = e.clientX / innerWidth, y = 1 - e.clientY / innerHeight;
    if (e.pointerType === 'mouse') {
      aim.x = home.x * 0.55 + x * 0.45;
      aim.y = home.y * 0.6 + y * 0.4;
    }
    if (pointer.moved) {
      const cap = (v) => Math.max(-1400, Math.min(1400, v));
      const dx = cap((x - pointer.x) * 6000), dy = cap((y - pointer.y) * 6000);
      if (Math.abs(dx) + Math.abs(dy) > 1) pending.push([x, y, dx, dy, warm(0.06 + Math.min(0.08, Math.hypot(dx, dy) / 50000))]);
    }
    pointer.x = x; pointer.y = y; pointer.moved = true;
    lastTouch = performance.now();
  }, { passive: true });
  document.addEventListener('pointerleave', () => { aim.x = home.x; aim.y = home.y; pointer.moved = false; });
  const pending = [];

  // The bulb catching: a few flickers, then it holds.
  const FLICKER = [[0, 0], [0.3, 0], [0.36, 0.75], [0.44, 0.1], [0.56, 0.9], [0.63, 0.3], [0.76, 1]];
  const flicker = (s) => {
    if (s >= 0.76) return 1;
    for (let i = 1; i < FLICKER.length; i++) {
      const [t1, v1] = FLICKER[i], [t0, v0] = FLICKER[i - 1];
      if (s <= t1) return v0 + (v1 - v0) * ((s - t0) / (t1 - t0));
    }
    return 1;
  };
  let poured = false;

  const t0 = performance.now();
  function frame(now, dt) {
    const secs = (now - t0) / 1000;
    const on = calm ? 1 : flicker(secs);
    const k = 1 - Math.exp(-2.2 * dt);
    lamp.x += (aim.x - lamp.x) * k;
    lamp.y += (aim.y - lamp.y) * k;
    scroll += (scrollY - scroll) * (1 - Math.exp(-5 * dt));

    if (fluid && !calm) {
      // The light pours out the moment it holds.
      if (!poured && secs >= 0.76) {
        poured = true;
        for (let i = 0; i < 9; i++) {
          const a = Math.PI * (1.05 + i * 0.07);
          splat(0.9, 0.98, Math.cos(a) * 900, Math.sin(a) * 900, warm(0.32), 0.006);
        }
      }
      // Scrolling pushes the liquid past.
      const ds = scrollY - lastScroll;
      lastScroll = scrollY;
      if (Math.abs(ds) > 2) pending.push([0.15 + Math.random() * 0.7, 0.5, 0, ds * 18, warm(0.05)]);
      // Left alone, a soft current drifts out from the light now and then.
      if (now - lastTouch > 2600 && Math.random() < dt * 0.9) {
        const a = Math.PI * (1.1 + Math.random() * 0.35);
        pending.push([lamp.x - 0.05 + Math.random() * 0.1, Math.min(0.98, lamp.y - 0.05), Math.cos(a) * 500, Math.sin(a) * 500, warm(0.14)]);
      }
      while (pending.length) { const [x, y, dx, dy, c] = pending.shift(); splat(x, y, dx, dy, c); }
      step(Math.min(dt, 1 / 30));
    }

    const u = light.use();
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.uniform2f(u.texel, 1 / canvas.width, 1 / canvas.height);
    gl.uniform1f(u.uTime, calm ? 12 : secs + 12);
    gl.uniform2f(u.uLight, lamp.x, lamp.y);
    gl.uniform1f(u.uScroll, scroll);
    gl.uniform1f(u.uOn, on);
    gl.uniform1f(u.uFluid, fluid ? 1 : 0);
    if (fluid) { gl.uniform1i(u.uDye, fluid.dye.read.bind(0)); gl.uniform1i(u.uVel, fluid.vel.read.bind(1)); }
    blit(null);
  }

  document.body.prepend(canvas);
  // The canvas covers the CSS glow, so that layer stops animating underneath it.
  document.documentElement.classList.add('has-backdrop');
  requestAnimationFrame(() => canvas.classList.add('on'));
  if (calm) {
    frame(performance.now(), 1);
    addEventListener('resize', () => frame(performance.now(), 1));
    return;
  }

  // Watch the frame time and step resolution down if the device is struggling.
  let last = performance.now();
  let slow = 0, frames = 0;
  const loop = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!document.hidden) {
      frame(now, dt);
      frames++;
      if (dt > (small ? 0.034 : 0.022)) slow++;
      if (frames === 90) {
        if (slow > 45 && scale > 0.28) { scale = Math.max(0.28, scale - 0.12); size(); }
        frames = 0; slow = 0;
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

if (gl) {
  const giveUp = () => { canvas.remove(); document.documentElement.classList.remove('has-backdrop'); };
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); giveUp(); });
  try { start(); } catch (err) { console.warn('Background shader unavailable:', err.message); giveUp(); }
}
