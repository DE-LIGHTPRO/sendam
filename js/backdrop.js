// The living backdrop behind every page: a faint power grid with current running through it.
// Pulses of light travel along the wires; when one reaches a home, the home lights up and
// slowly fades, like lights coming on across a city. The cursor lights the wires near it.
// It sits behind all content, pauses when the tab is hidden, and stays still for anyone
// who prefers reduced motion.

const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const AMBER = '246, 190, 96';
const INK = '18, 18, 17';

const canvas = document.createElement('canvas');
canvas.className = 'backdrop';
canvas.setAttribute('aria-hidden', 'true');
document.body.prepend(canvas);
const ctx = canvas.getContext('2d');

// A seeded random source, so the grid keeps its shape between visits.
function seeded(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let W = 0, H = 0, dpr = 1;
let nodes = [];
let wires;          // the grid, drawn once: faint ink
let wiresLit;       // the same grid in amber, shown under the cursor
let pulses = [];
const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, on: false };
const torch = document.createElement('canvas');
torch.width = 400; torch.height = 400;
const torchCtx = torch.getContext('2d');

function layer() {
  const c = document.createElement('canvas');
  c.width = W * dpr; c.height = H * dpr;
  const x = c.getContext('2d');
  x.scale(dpr, dpr);
  return [c, x];
}

function build() {
  dpr = Math.min(devicePixelRatio || 1, 1.5);
  W = innerWidth; H = innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const rand = seeded(20261114);
  const cell = W < 700 ? 86 : 118;
  const cols = Math.ceil(W / cell) + 2;
  const rows = Math.ceil(H / cell) + 2;
  nodes = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      nodes.push({
        x: (c - 0.5) * cell + (rand() - 0.5) * cell * 0.34,
        y: (r - 0.5) * cell + (rand() - 0.5) * cell * 0.34,
        links: [], home: rand() < 0.2, glow: 0,
      });
    }
  }
  const at = (r, c) => nodes[r * cols + c];
  const join = (a, b) => { a.links.push(b); b.links.push(a); };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && rand() < 0.66) join(at(r, c), at(r, c + 1));
      if (r + 1 < rows && rand() < 0.58) join(at(r, c), at(r + 1, c));
    }
  }

  const draw = (x, color, width, dot) => {
    x.strokeStyle = color; x.lineWidth = width; x.lineCap = 'round';
    x.beginPath();
    for (const n of nodes) for (const m of n.links) if (m.x > n.x || m.y > n.y) { x.moveTo(n.x, n.y); x.lineTo(m.x, m.y); }
    x.stroke();
    x.fillStyle = dot;
    for (const n of nodes) if (n.links.length) { x.beginPath(); x.arc(n.x, n.y, n.home ? 2.2 : 1.3, 0, Math.PI * 2); x.fill(); }
  };
  let x;
  [wires, x] = layer();
  draw(x, `rgba(${INK}, 0.055)`, 1, `rgba(${INK}, 0.12)`);
  [wiresLit, x] = layer();
  draw(x, `rgba(${AMBER}, 0.75)`, 1.4, `rgba(${AMBER}, 0.95)`);

  pulses = [];
  if (calm) for (const n of nodes) if (n.home && n.links.length && rand() < 0.35) n.glow = 0.4 + rand() * 0.5;
}

function spawn() {
  const starts = nodes.filter((n) => n.links.length);
  if (!starts.length) return;
  const from = starts[(Math.random() * starts.length) | 0];
  const to = from.links[(Math.random() * from.links.length) | 0];
  pulses.push({ from, to, t: 0, speed: 110 + Math.random() * 120, trail: [], life: 10 + ((Math.random() * 14) | 0) });
}

function glowAt(x, y, radius, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, `rgba(${AMBER}, ${alpha})`);
  g.addColorStop(1, `rgba(${AMBER}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
}

function frame(dt) {
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(wires, 0, 0, W, H);

  // The cursor's torch: the wires near it show in amber.
  if (mouse.on) {
    mouse.x += (mouse.tx - mouse.x) * Math.min(1, dt * 8);
    mouse.y += (mouse.ty - mouse.y) * Math.min(1, dt * 8);
    glowAt(mouse.x, mouse.y, 260, 0.1);
    // The amber wires, faded out softly towards the torch's edge.
    const R = 200;
    torchCtx.globalCompositeOperation = 'copy';
    torchCtx.drawImage(wiresLit, (mouse.x - R) * dpr, (mouse.y - R) * dpr, R * 2 * dpr, R * 2 * dpr, 0, 0, R * 2, R * 2);
    torchCtx.globalCompositeOperation = 'destination-in';
    const fade = torchCtx.createRadialGradient(R, R, 0, R, R, R);
    fade.addColorStop(0, 'rgba(0,0,0,0.6)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
    torchCtx.fillStyle = fade;
    torchCtx.fillRect(0, 0, R * 2, R * 2);
    ctx.drawImage(torch, mouse.x - R, mouse.y - R);
  }

  // Homes that current has reached glow, then fade.
  for (const n of nodes) {
    if (n.glow < 0.01) continue;
    glowAt(n.x, n.y, 34, 0.42 * n.glow);
    ctx.fillStyle = `rgba(${AMBER}, ${Math.min(1, n.glow + 0.2)})`;
    ctx.beginPath(); ctx.arc(n.x, n.y, 2.6, 0, Math.PI * 2); ctx.fill();
    if (!calm) n.glow *= Math.pow(0.42, dt); // about a second and a half to fade by half
  }

  // Current: each pulse runs along a wire, then picks a new one at the junction.
  for (const p of pulses) {
    p.t += (p.speed * dt) / Math.max(1, Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y));
    while (p.t >= 1 && p.life > 0) {
      p.t -= 1; p.life--;
      if (p.to.home) p.to.glow = 1;
      const next = p.to.links.filter((m) => m !== p.from);
      const prev = p.to;
      p.to = next.length ? next[(Math.random() * next.length) | 0] : p.from;
      p.from = prev;
    }
    const x = p.from.x + (p.to.x - p.from.x) * Math.min(p.t, 1);
    const y = p.from.y + (p.to.y - p.from.y) * Math.min(p.t, 1);
    p.trail.push([x, y]);
    if (p.trail.length > 14) p.trail.shift();
    for (let i = 1; i < p.trail.length; i++) {
      const a = (i / p.trail.length) * 0.55;
      ctx.strokeStyle = `rgba(${AMBER}, ${a})`;
      ctx.lineWidth = 1 + (i / p.trail.length) * 1.4;
      ctx.beginPath(); ctx.moveTo(p.trail[i - 1][0], p.trail[i - 1][1]); ctx.lineTo(p.trail[i][0], p.trail[i][1]); ctx.stroke();
    }
    glowAt(x, y, 12, 0.6);
  }
  pulses = pulses.filter((p) => p.life > 0);
}

build();
let resizeTimer = 0;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { build(); if (calm) frame(0); }, 150); });

if (calm) {
  frame(0);
} else {
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    mouse.tx = e.clientX; mouse.ty = e.clientY;
    if (!mouse.on) { mouse.x = mouse.tx; mouse.y = mouse.ty; mouse.on = true; }
  }, { passive: true });
  document.addEventListener('pointerleave', () => { mouse.on = false; });

  const target = () => Math.max(6, Math.min(26, Math.round((W * H) / 70000)));
  let last = performance.now();
  let sinceSpawn = 0;
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!document.hidden) {
      sinceSpawn += dt;
      if (pulses.length < target() && sinceSpawn > 0.35) { spawn(); sinceSpawn = 0; }
      frame(dt);
    }
    requestAnimationFrame(loop);
  };
  for (let i = 0; i < 6; i++) spawn();
  requestAnimationFrame(loop);
}
