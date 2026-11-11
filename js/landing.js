import { view, stateOf } from './chain.js';
import { $ } from './ui.js';

const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

// The hero scene loops. With reduced motion it holds still on the moment the lights come on.
const scene = $('#scene');
if (scene && calm) {
  scene.setCurrentTime?.(5.2);
  scene.pauseAnimations?.();
}

// Numbers count up to their value when they first come into view.
function countTo(el, to) {
  if (calm) { el.textContent = String(to); return; }
  const start = performance.now();
  const tick = (now) => {
    const k = Math.min(1, (now - start) / 900);
    el.textContent = String(Math.round(to * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Blocks rise into place as they scroll into view.
if (!calm && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('js-motion');
  const targets = document.querySelectorAll('.band-head, .fact, .journey .feature, .grid-2 .feature, .guard, .cta .wrap > *, #agents .actions');
  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      seen.unobserve(entry.target);
      entry.target.classList.add('in');
      setTimeout(() => entry.target.classList.remove('reveal', 'in'), 1300);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  for (const el of targets) {
    el.style.setProperty('--d', Math.min([...el.parentElement.children].indexOf(el), 5) * 90 + 'ms');
    el.classList.add('reveal');
    seen.observe(el);
  }
}

// Live numbers from the contract. Without a connection, the zeros stay.
(async () => {
  let numbers = {};
  try {
    const all = await view('list_requests', { limit: 100 });
    numbers = {
      's-total': all.length,
      's-paid': all.filter((r) => stateOf(r) === 'paid').length,
      's-open': all.filter((r) => stateOf(r) === 'open').length,
    };
  } catch { /* keep the zeros */ }
  const facts = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      facts.unobserve(e.target);
      const to = e.target.dataset.to ? Number(e.target.dataset.to) : numbers[e.target.id] ?? 0;
      countTo(e.target, to);
    }
  });
  document.querySelectorAll('[data-count]').forEach((el) => facts.observe(el));
})();
