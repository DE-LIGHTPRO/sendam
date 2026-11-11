import { CONTRACT, USDC, EXPLORER, SUGGESTED_RATE as MARKET_RATE, USDC_DECIMALS } from './config.js';
import { view, usd, naira, timeLeft, providerName, maskMeter } from './chain.js';
import { $, escapeHtml, icon, show, toast, confirmDialog } from './ui.js';
import { mountAccount, explain, connect } from './session.js';

let account = null;
let w;
let tab = 'open';
let timer = 0;
let open = [];
let mine = [];

async function drawBalance() {
  try {
    const [bal, storage] = await Promise.all([
      view('ft_balance_of', { account_id: account }, USDC),
      view('storage_balance_of', { account_id: account }, USDC),
    ]);
    $('#balance').textContent = usd(bal || '0');
    const registered = !!storage;
    $('#register').hidden = registered;
    $('#register-note').hidden = registered;
  } catch {
    $('#balance').textContent = 'Unavailable';
  }
}

/** What taking a request is worth to an agent, in naira, at the demo's market rate. */
function earnings(r) {
  const worth = Math.round((Number(r.amount) / 10 ** USDC_DECIMALS) * MARKET_RATE);
  return { worth, profit: worth - r.naira };
}

function card(r, actions) {
  const s = r.status;
  const { worth, profit } = earnings(r);
  const yours = s.state !== 'open' && s.agent === account;
  const earn = profit >= 0
    ? `<div class="earn"><span>You earn</span><b>≈ ${naira(profit)}</b></div>`
    : `<div class="earn low"><span>Below market</span><b>${naira(profit).replace('₦-', '−₦')}</b></div>`;
  return `<div class="card job" data-id="${r.id}">
    <div class="job-top">
      <div><span class="job-label">You pay</span><div class="big">${naira(r.naira)}</div><div class="small muted">${escapeHtml(providerName(r.provider))}<span class="mono">Meter ${escapeHtml(yours ? r.meter : maskMeter(r.meter))}</span></div></div>
      ${s.state === 'fulfilled' ? '' : earn}
    </div>
    <div class="job-meta">
      <span>You get <b>${usd(r.amount)}</b> ≈ ${naira(worth)}</span>
      ${s.state === 'fulfilled' ? `<span>Ref <b class="mono">${escapeHtml(s.reference)}</b></span>` : `<span>${s.state === 'claimed' && s.agent === account ? `Yours for ${timeLeft(s.until_ms).replace(' left', '')}` : timeLeft(r.expires_ms)}</span>`}
    </div>
    ${actions}
  </div>`;
}

function draw() {
  const now = Date.now();
  const holding = mine.filter((r) => r.status.state === 'claimed' && r.status.agent === account && r.status.until_ms > now);
  const done = mine.filter((r) => r.status.state === 'fulfilled' && r.status.agent === account);
  $('#n-open').textContent = String(open.length);
  $('#n-mine').textContent = String(holding.length);
  $('#done-count').textContent = String(done.length);
  let html;
  if (tab === 'open') {
    html = open.length
      ? open.map((r) => card(r, `<button class="btn primary block" type="button" data-act="claim"${r.sender === account ? ' disabled' : ''}>${r.sender === account ? 'Your own request' : 'Take this job'}</button>`)).join('')
      : '<p class="empty-note">No open requests right now. New ones appear here as families send them.</p>';
  } else {
    html = holding.map((r) => card(r, `<div class="row"><button class="btn" type="button" data-act="release">Give it back</button><button class="btn primary" type="button" data-act="pay">${icon('bolt')}Pay the bill</button></div>`)).join('')
      + done.map((r) => card(r, `<span class="chip ok">${icon('check')}Paid · you earned ${usd(r.amount)}</span>`)).join('');
    if (!html) html = '<p class="empty-note">Take a request from Open requests to start.</p>';
  }
  $('#panel').innerHTML = html;
}

async function refresh() {
  clearTimeout(timer);
  try {
    [open, mine] = await Promise.all([view('list_open', { limit: 50 }), view('list_by_account', { account, limit: 50 })]);
    draw();
  } catch {
    $('#panel').innerHTML = '<p class="empty-note">Could not reach NEAR. Retrying…</p>';
  }
  timer = setTimeout(refresh, 10_000);
}

function selectTab(name) {
  tab = name;
  for (const [id, n] of [['#tab-open', 'open'], ['#tab-mine', 'mine']]) $(id).setAttribute('aria-selected', String(n === name));
  $('#panel').setAttribute('aria-labelledby', name === 'open' ? 'tab-open' : 'tab-mine');
  draw();
}
$('#tab-open').addEventListener('click', () => selectTab('open'));
$('#tab-mine').addEventListener('click', () => selectTab('mine'));

// ---- Paying a bill -------------------------------------------------------------
function step(name, state) {
  const li = document.querySelector(`#pay-steps [data-step="${name}"]`);
  li.classList.toggle('done', state === 'done');
  li.classList.toggle('now', state === 'now');
}

// The settlement screen's meter display.
function lcd(mode, main, fill, { lit = false, blink = false } = {}) {
  $('#pay-lcd-mode').textContent = mode;
  $('#pay-lcd-main').replaceChildren(blink ? Object.assign(document.createElement('span'), { className: 'blink', textContent: main }) : main);
  $('#pay-lcd-bar').style.setProperty('--fill', fill);
  $('#pay-lcd').classList.toggle('lit', lit);
}
function countUsdc(el, units) {
  const to = Number(units) / 10 ** USDC_DECIMALS;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = `+${to.toFixed(2)}`; return; }
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / 1100);
    el.textContent = `+${(to * (1 - Math.pow(1 - t, 3))).toFixed(2)}`;
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function pay(req) {
  $('#pay-text').textContent = `${naira(req.naira)} to meter ${req.meter}, ${providerName(req.provider)}.`;
  $('#pay-error').hidden = true;
  $('#pay-done').hidden = true;
  ['pay', 'check', 'release'].forEach((s) => step(s, ''));
  step('pay', 'now');
  lcd('Bill payment', `PAYING ${naira(req.naira)}`, '30%', { blink: true });
  show('paying');
  for (let attempt = 0; attempt < 10; attempt++) {
    let res;
    let body;
    try {
      res = await fetch('api/fulfil', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: req.id, agent: account }) });
      body = await res.json();
    } catch {
      body = { error: 'Could not reach the verifier. Check your connection and try again.' };
    }
    if (res?.status === 202) {
      step('pay', 'done');
      step('check', 'now');
      lcd('Bill provider', 'CHECKING', '60%', { blink: true });
      await new Promise((r) => setTimeout(r, 4000));
      continue;
    }
    if (res?.ok && body.state === 'fulfilled') {
      ['pay', 'check', 'release'].forEach((s) => step(s, 'done'));
      lcd('Confirmed', 'PAID', '100%', { lit: true });
      $('#pay-ref').textContent = body.reference;
      $('#pay-earned').textContent = usd(req.amount);
      $('#pay-profit').textContent = `≈ ${naira(earnings(req).profit)}`;
      $('#pay-tx').hidden = !body.txHash;
      $('#pay-tx').href = `${EXPLORER}/txns/${body.txHash}`;
      $('#pay-done').hidden = false;
      countUsdc($('#pay-big'), req.amount);
      return;
    }
    $('#pay-error span').textContent = body.error || 'The payment did not go through.';
    $('#pay-error').hidden = false;
    lcd('Error', 'NOT PAID', '0%');
    return;
  }
  $('#pay-error span').textContent = 'The bill provider is still processing the payment. Try "Pay the bill" again in a minute; it will not pay twice.';
  $('#pay-error').hidden = false;
}

$('#panel').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = Number(btn.closest('[data-id]').dataset.id);
  const req = [...open, ...mine].find((r) => r.id === id);
  const act = btn.dataset.act;
  btn.disabled = true;
  try {
    if (act === 'claim') {
      const ok = await confirmDialog({ title: `Take ${naira(req.naira)}?`, body: `It is reserved for you for 30 minutes. Pay it promptly: you receive ${usd(req.amount)}, about ${naira(earnings(req).worth)} at ₦${MARKET_RATE.toLocaleString('en-NG')} per USDC, once the payment is confirmed.`, confirm: 'Take this job' });
      if (!ok) return;
      await w.call({ receiverId: CONTRACT, methodName: 'claim', args: { id }, tgas: 30 });
      toast('Reserved for you. Pay it from My jobs.');
      await refresh();
      selectTab('mine');
    } else if (act === 'release') {
      await w.call({ receiverId: CONTRACT, methodName: 'release', args: { id }, tgas: 30 });
      toast('Given back');
      await refresh();
    } else if (act === 'pay') {
      await pay(req);
    }
  } catch (err) {
    toast(explain(err), 'warn');
  } finally {
    btn.disabled = false;
  }
});

$('#register').addEventListener('click', async () => {
  try {
    await w.call({ receiverId: USDC, methodName: 'register', args: { account_id: account }, tgas: 30 });
    toast('Ready to receive USDC');
    drawBalance();
  } catch (err) {
    toast(explain(err), 'warn');
  }
});
$('#back-desk').addEventListener('click', () => { show('desk'); refresh(); drawBalance(); });
$('#connect').addEventListener('click', connect);

w = await mountAccount((id) => {
  account = id;
  clearTimeout(timer);
  if (!id) return show('connect');
  show('desk');
  drawBalance();
  refresh();
});
