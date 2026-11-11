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

// How it works: the three cards act out one bill, in order, while they are on screen.
const journey = document.getElementById('journey');
if (!calm && journey) {
  const [s1, s2, s3] = journey.querySelectorAll('.j-step');
  const q = (el, sel) => el.querySelector(sel);
  const name = q(s1, '.u-name'), big = q(s1, '.u-big'), row1 = q(s1, '.u-row'), lock = q(s1, '.u-state');
  const earn = q(s2, '.u-earn'), row2 = q(s2, '.u-row'), btn = q(s2, '.u-btn');
  const token = q(s3, '.u-token'), row3 = q(s3, '.u-row'), lights = q(s3, '.u-state');
  const FINAL = token.textContent;
  const NAME = name.innerHTML;
  const line = document.querySelector('#j-rail .j-line');
  const stops = [...document.querySelectorAll('#j-rail .j-stop')];
  const rail = (p, ms, upTo) => {
    line.style.setProperty('--dur', ms + 'ms');
    line.style.setProperty('--p', p);
    stops.forEach((st, i) => st.classList.toggle('on', i <= upTo));
  };
  let onScreen = false;
  let started = false;
  const pace = async (ms) => { await wait(ms); while (!onScreen || document.hidden) await wait(250); };
  const hide = (...els) => els.forEach((e) => e.classList.add('hide'));
  const reveal = (...els) => els.forEach((e) => e.classList.remove('hide'));
  const turn = (step, ms) => { step.style.setProperty('--dur', ms + 'ms'); step.classList.add('active'); };
  const finish = (step) => { step.classList.remove('active'); step.classList.add('done'); };

  function countUp(el, to, ms) {
    return new Promise((done) => {
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - start) / ms);
        el.textContent = '₦' + Math.round(to * (1 - Math.pow(1 - t, 3))).toLocaleString('en-NG');
        if (t < 1) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
  }

  async function settleToken() {
    const chars = [...FINAL];
    for (let i = 0; i <= chars.length; i++) {
      for (let r = 0; r < 2; r++) {
        token.innerHTML = chars.map((c, j) => (j < i || c === ' ' ? c : `<span class="settling">${Math.floor(Math.random() * 10)}</span>`)).join('');
        await wait(28);
      }
    }
    token.textContent = FINAL;
  }

  function reset() {
    journey.classList.add('playing');
    [s1, s2, s3].forEach((st) => st.classList.remove('active', 'done'));
    name.textContent = 'Checking meter…';
    name.classList.add('pending');
    rail('0%', 0, -1);
    big.textContent = '₦0';
    hide(row1, lock, earn, row2, row3, lights);
    btn.className = 'u-btn';
    btn.textContent = 'Take this job';
    token.textContent = '•••• •••• •••• •••• ••••';
  }

  async function play() {
    for (;;) {
      reset();
      await pace(700);
      // 01: the sender checks the meter and locks the money.
      turn(s1, 3200);
      rail('0%', 0, 0);
      await pace(900);
      name.innerHTML = NAME;
      name.classList.remove('pending');
      await pace(300);
      await countUp(big, 20000, 900);
      reveal(row1);
      await pace(500);
      reveal(lock);
      await pace(700);
      finish(s1);
      rail('50%', 900, 0);
      await pace(900);
      stops[1].classList.add('on');
      // 02: the agent sees the earnings, takes the job and pays.
      turn(s2, 3600);
      await pace(300);
      reveal(earn, row2);
      earn.classList.add('pop');
      await pace(900);
      earn.classList.remove('pop');
      btn.classList.add('pressed');
      await wait(160);
      btn.classList.remove('pressed');
      btn.classList.add('busy');
      btn.innerHTML = '<span class="u-spin"></span>Paying ₦20,000…';
      await pace(1400);
      btn.className = 'u-btn ok';
      btn.textContent = 'Paid · 13.30 USDC received';
      await pace(800);
      finish(s2);
      rail('100%', 700, 1);
      await pace(700);
      stops[2].classList.add('on');
      // 03: the family gets the token.
      turn(s3, 2600);
      await pace(400);
      await settleToken();
      reveal(row3);
      await pace(400);
      reveal(lights);
      await pace(900);
      finish(s3);
      journey.classList.remove('playing');
      await pace(6000);
    }
  }

  new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    if (onScreen && !started) { started = true; setTimeout(play, 900); }
  }, { threshold: 0.35 }).observe(journey);
}
