// Landing page motion. Without JavaScript, or with reduced motion, everything shows complete
// and still: the meter already credited, every block in place.
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

// The nav gains a hairline once the page scrolls.
const nav = document.querySelector('.l-nav');
const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Blocks rise in as they scroll into view, a beat apart.
if (!calm && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('js-motion');
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      e.target.classList.add('in');
      setTimeout(() => e.target.classList.remove('reveal', 'in'), 1600);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  document.querySelectorAll('.reveal').forEach((el) => {
    const i = [...el.parentElement.children].filter((c) => c.classList.contains('reveal')).indexOf(el);
    el.style.setProperty('--d', Math.max(0, i) * 90 + 'ms');
    seen.observe(el);
  });
} else {
  document.querySelectorAll('.reveal').forEach((el) => el.classList.remove('reveal'));
}

// The meter: a token is typed in, accepted, and the credit climbs. Then it starts again.
const TOKEN = '43218765210965430987';
const BEFORE = 12.3;
const ADDED = 64.5;
const stage = document.getElementById('stage');
const meter = document.getElementById('meter');
const lcd = document.getElementById('lcd');
const mode = document.getElementById('lcd-mode');
const bar = document.getElementById('lcd-bar');
const keys = [...document.querySelectorAll('#keys span')];
const keyFor = (ch) => keys.find((k) => k.textContent === ch);

let visible = true;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function beat(ms) {
  await wait(ms);
  while (!visible || document.hidden) await wait(250);
}
async function press(key) {
  key.classList.add('press');
  await wait(110);
  key.classList.remove('press');
}
const show = (text, cls = '') => { lcd.className = `m-lcd-main ${cls}`.trim(); lcd.textContent = text; };
const grouped = (s) => s.slice(-12).replace(/(\d{4})(?=\d)/g, '$1 ');

async function loop() {
  for (;;) {
    stage.classList.remove('lit');
    meter.classList.remove('flowing');
    mode.textContent = 'CREDIT';
    show(BEFORE.toFixed(1));
    bar.style.width = '14%';
    await beat(1600);
    mode.textContent = 'TOKEN';
    let typed = '';
    for (const ch of TOKEN) {
      typed += ch;
      show(grouped(typed), 'typing');
      await press(keyFor(ch));
      await beat(70);
    }
    await beat(350);
    await press(keyFor('↵'));
    mode.textContent = 'STATUS';
    for (let i = 0; i < 2; i++) { show('ACCEPT', 'word'); await beat(380); show('', 'word'); await beat(200); }
    show('ACCEPT', 'word');
    await beat(500);
    mode.textContent = 'CREDIT';
    stage.classList.add('lit');
    meter.classList.add('flowing');
    bar.style.width = '78%';
    const start = performance.now();
    await new Promise((done) => {
      const tick = (now) => {
        const t = Math.min(1, (now - start) / 1300);
        const eased = 1 - Math.pow(1 - t, 3);
        show((BEFORE + ADDED * eased).toFixed(1));
        if (t < 1) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
    await beat(6500);
  }
}

if (!calm && stage) {
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(stage);
  loop();
}
