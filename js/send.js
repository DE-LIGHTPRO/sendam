import { CONTRACT, USDC, PROVIDERS, SUGGESTED_RATE, SUGGESTED_TIP } from './config.js';
import { view, eventsOf, eventsFromOutcome, toUnits, usd, naira, maskMeter, timeLeft, stateOf, providerName } from './chain.js';
import { $, escapeHtml, icon, show, toast, copyText, confirmDialog } from './ui.js';
import { mountAccount, explain } from './session.js';

const PENDING = 'sendam.pending';
const SENT = 'sendam.sent'; // request id -> secret, so the sender can reopen their links
let account = null;
let w;

const sent = () => { try { return JSON.parse(localStorage.getItem(SENT) || '{}'); } catch { return {}; } };
const remember = (id, secret) => localStorage.setItem(SENT, JSON.stringify({ ...sent(), [id]: secret }));

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- Quote --------------------------------------------------------------------
function quote() {
  const n = Number($('#naira').value);
  const rate = Number($('#rate').value);
  const tip = Number($('#tip').value);
  if (!(n > 0) || !(rate > 0) || !(tip >= 0)) return null;
  const base = Math.ceil((n / rate) * 100) / 100;
  const total = Math.ceil(base * (1 + tip / 100) * 100) / 100;
  return { naira: n, base, tip: Math.round((total - base) * 100) / 100, total };
}
function drawQuote() {
  const q = quote();
  const rate = Number($('#rate').value);
  const tip = Number($('#tip').value);
  $('#q-naira').textContent = q ? naira(q.naira) : '-';
  $('#q-rate-label').textContent = rate > 0 ? `At ₦${rate.toLocaleString('en-NG')} per USDC` : 'At your rate';
  $('#q-base').textContent = q ? `${q.base.toFixed(2)} USDC` : '-';
  $('#q-tip-label').textContent = tip >= 0 ? `Agent tip, ${tip}%` : 'Agent tip';
  $('#q-tip').textContent = q ? `${q.tip.toFixed(2)} USDC` : '-';
  $('#q-total').textContent = q ? `${q.total.toFixed(2)} USDC` : '-';
  $('#q-expiry').textContent = `after ${$('#expiry').selectedOptions[0].textContent}`;
  drawWho();
}

// ---- Meter check ------------------------------------------------------------------
// Looks up the name on the meter as it is typed, the way Nigerian bill apps do, so a
// wrong digit is caught before any money is locked.
const lookups = new Map(); // "provider:meter" -> { found, name, address } | { unavailable: true }
let lookupTimer = 0;
const meterValue = () => $('#meter').value.replace(/\s/g, '');
const lookupKey = () => `${$('#provider').value}:${meterValue()}`;

function drawWho() {
  const res = lookups.get(lookupKey());
  $('#r-name').textContent = res?.found ? res.name : "Your family's meter";
  const m = meterValue();
  $('#r-meter').textContent = [providerName($('#provider').value), /^\d{6,20}$/.test(m) ? `meter ${maskMeter(m)}` : ''].filter(Boolean).join(' · ');
}

function drawCheck() {
  const box = $('#meter-check');
  const m = meterValue();
  const res = lookups.get(lookupKey());
  box.dataset.state = '';
  if (!/^\d{6,20}$/.test(m)) box.innerHTML = '<span class="hint">Sandbox test meter: 1111111111111</span>';
  else if (!res) { box.dataset.state = 'checking'; box.innerHTML = `<span class="mc-spin" aria-hidden="true"></span><span>Checking the meter…</span>`; }
  else if (res.found) { box.dataset.state = 'found'; box.innerHTML = `${icon('check')}<span><b>${escapeHtml(res.name)}</b>${res.address ? `<small>${escapeHtml(res.address)}</small>` : ''}</span>`; }
  else if (res.unavailable) { box.dataset.state = 'unknown'; box.innerHTML = `${icon('info')}<span>We could not check this meter right now. Make sure the number is right.</span>`; }
  else { box.dataset.state = 'missing'; box.innerHTML = `${icon('alert')}<span>${escapeHtml(res.message)}. Check the number and the company.</span>`; }
  drawWho();
}

async function lookUp() {
  const key = lookupKey();
  const [provider, meter] = key.split(':');
  if (!/^\d{6,20}$/.test(meter) || lookups.has(key)) return drawCheck();
  drawCheck();
  let res;
  try {
    const r = await fetch('api/meter', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider, meter }) });
    res = r.ok ? await r.json() : { unavailable: true };
  } catch {
    res = { unavailable: true };
  }
  lookups.set(key, res);
  if (key === lookupKey()) drawCheck();
}
function scheduleLookUp() {
  clearTimeout(lookupTimer);
  drawCheck();
  lookupTimer = setTimeout(lookUp, 450);
}

// ---- Balance and history ----------------------------------------------------
async function drawBalance() {
  try {
    const bal = await view('ft_balance_of', { account_id: account }, USDC);
    $('#balance').textContent = usd(bal || '0');
    $('#faucet').hidden = BigInt(bal || '0') >= 100_000_000n;
  } catch {
    $('#balance').textContent = 'Unavailable';
  }
}

async function drawMine() {
  let list = [];
  try {
    list = (await view('list_by_account', { account, limit: 20 })).filter((r) => r.sender === account);
  } catch {
    $('#mine').innerHTML = '<p class="empty-note">Could not reach NEAR. Try again shortly.</p>';
    return;
  }
  if (!list.length) {
    $('#mine').innerHTML = '<p class="empty-note">Nothing sent yet.</p>';
    return;
  }
  const secrets = sent();
  const label = { open: ['neutral', 'Waiting for an agent'], claimed: ['warn', 'Agent paying'], paid: ['ok', 'Paid'], refunded: ['neutral', 'Refunded'], expired: ['bad', 'Expired: refund it'] };
  $('#mine').innerHTML = list.map((r) => {
    const st = stateOf(r);
    const [tone, text] = label[st];
    const canRefund = st === 'open' || st === 'expired';
    const link = secrets[r.id] ? `track?id=${r.id}#${secrets[r.id]}` : `track?id=${r.id}`;
    return `<div class="card job" data-id="${r.id}">
      <div class="job-top"><div><div class="big">${naira(r.naira)}</div><div class="small muted">${escapeHtml(providerName(r.provider))} · meter ${maskMeter(r.meter)}</div></div><span class="chip ${tone}">${text}</span></div>
      <div class="job-meta"><span>Locked <b>${usd(r.amount)}</b></span>${st === 'open' ? `<span>${timeLeft(r.expires_ms)}</span>` : ''}</div>
      <div class="row">
        <a class="btn sm" href="${link}">Track</a>
        ${canRefund ? `<button class="btn sm danger" type="button" data-act="refund">${st === 'expired' ? 'Refund me' : 'Cancel and refund'}</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

$('#mine').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act="refund"]');
  if (!btn) return;
  const id = Number(btn.closest('[data-id]').dataset.id);
  const ok = await confirmDialog({ title: 'Cancel this request?', body: 'The USDC goes back to your wallet and no agent can take it.', confirm: 'Cancel and refund', danger: true });
  if (!ok) return;
  try {
    await w.call({ receiverId: CONTRACT, methodName: 'refund', args: { id }, tgas: 60 });
    toast('Refunded');
    drawMine();
    drawBalance();
  } catch (err) {
    toast(explain(err), 'warn');
  }
});

// ---- Sending -------------------------------------------------------------------
function finish(id, secret) {
  remember(id, secret);
  localStorage.removeItem(PENDING);
  const link = new URL(`track?id=${id}#${secret}`, location.href).href;
  $('#sent-text').textContent = `Request ${id} is waiting for an agent. You are only charged once the bill is paid.`;
  $('#share-link').textContent = link;
  $('#open-track').href = link;
  $('#whatsapp').href = 'https://wa.me/?text=' + encodeURIComponent(`I've paid for electricity for you. Open this link to follow it and get the token: ${link}`);
  $('#copy-link').onclick = () => copyText(link, 'Link copied');
  show('sent');
}

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = quote();
  const meter = $('#meter').value.replace(/\s/g, '');
  if (!/^\d{6,20}$/.test(meter)) { $('#meter').focus(); return toast('Enter the meter number: digits only.', 'warn'); }
  if (!lookups.has(lookupKey())) { clearTimeout(lookupTimer); await lookUp(); }
  if (lookups.get(lookupKey())?.found === false) { $('#meter').focus(); return toast('That meter was not found. Check the number and the company.', 'warn'); }
  if (!q || q.naira < 500 || q.naira > 500000) { $('#naira').focus(); return toast('The amount must be between ₦500 and ₦500,000.', 'warn'); }
  const secret = randomSecret();
  const msg = {
    naira: q.naira,
    provider: $('#provider').value,
    meter,
    expires_in_minutes: Number($('#expiry').value),
    secret_hash: await sha256hex(secret),
  };
  // Kept in case the wallet leaves the page to sign, so the link can be rebuilt on return.
  localStorage.setItem(PENDING, JSON.stringify({ secret, at: Date.now() }));
  show('sending');
  try {
    const outcome = await w.call({
      receiverId: USDC,
      methodName: 'ft_transfer_call',
      args: { receiver_id: CONTRACT, amount: toUnits(q.total.toFixed(2)), msg: JSON.stringify(msg) },
      tgas: 120,
      depositYocto: '1',
    });
    if (!outcome) return; // the wallet redirected away; we pick up on return
    const created = eventsFromOutcome(outcome).find((ev) => ev.event === 'create');
    if (!created) throw new Error('The transaction went through, but the request was not created. Your USDC was returned.');
    finish(created.data[0].id, secret);
  } catch (err) {
    localStorage.removeItem(PENDING);
    show('form');
    toast(explain(err), 'warn');
  }
});

// A redirecting wallet (such as MyNearWallet) comes back with the transaction hash in the address.
async function resumeAfterRedirect() {
  const params = new URLSearchParams(location.search);
  const hash = params.get('transactionHashes')?.split(',').pop();
  const failed = params.get('errorCode');
  history.replaceState(null, '', location.pathname);
  const pending = JSON.parse(localStorage.getItem(PENDING) || 'null');
  if (failed) {
    localStorage.removeItem(PENDING);
    toast('You cancelled in your wallet. Nothing was sent.', 'warn');
    return false;
  }
  if (!hash || !pending) return false;
  show('sending');
  try {
    const created = (await eventsOf(hash, account)).find((ev) => ev.event === 'create');
    if (created) { finish(created.data[0].id, pending.secret); return true; }
  } catch { /* fall through */ }
  localStorage.removeItem(PENDING);
  toast('The request was not created. Check your wallet history.', 'warn');
  return false;
}

// ---- Set up ---------------------------------------------------------------------
$('#provider').innerHTML = PROVIDERS.map(([v, l]) => `<option value="${v}"${v === 'ibadan-electric' ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
$('#rate').value = SUGGESTED_RATE;
$('#tip').value = SUGGESTED_TIP;
$('#presets').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-n]');
  if (!b) return;
  $('#naira').value = b.dataset.n;
  drawQuote();
});
$('#form').addEventListener('input', drawQuote);
$('#form').addEventListener('change', drawQuote);
$('#meter').addEventListener('input', scheduleLookUp);
$('#provider').addEventListener('change', scheduleLookUp);
drawQuote();
$('#faucet').addEventListener('click', async () => {
  try {
    await w.call({ receiverId: USDC, methodName: 'faucet', args: {}, tgas: 30 });
    toast('100 test USDC added');
    drawBalance();
  } catch (err) {
    toast(explain(err), 'warn');
  }
});
$('#refresh-mine').addEventListener('click', () => { drawMine(); drawBalance(); });
$('#another').addEventListener('click', () => { show('form'); drawMine(); drawBalance(); });
$('#connect').addEventListener('click', () => w.signIn());

w = await mountAccount(async (id) => {
  account = id;
  if (!id) return show('connect');
  if (await resumeAfterRedirect()) return;
  if (!document.querySelector('[data-view="sent"]').hidden) return;
  show('form');
  drawBalance();
  drawMine();
});
