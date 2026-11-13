import { view, naira, providerName, stateOf, timeLeft } from './chain.js';
import { CONTRACT, EXPLORER } from './config.js';
import { $, show, copyText } from './ui.js';

const id = Number(new URLSearchParams(location.search).get('id'));
$('#t-proof').href = `${EXPLORER}/address/${CONTRACT}`;
const secret = location.hash.replace(/^#/, '').replace(/^s=/, '');
let timer = 0;
let tokenShown = false;
let badLink = false;
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The meter display beside the progress: it shows the state, then types the token in.
function lcd(mode, main, fill, { lit = false, blink = false, small = false } = {}) {
  $('#t-lcd-mode').textContent = mode;
  const el = $('#t-lcd-main');
  el.className = `lcd-main${small ? ' small' : ''}`;
  // Text only: part of it (the units) comes from the bill provider.
  el.replaceChildren(blink ? Object.assign(document.createElement('span'), { className: 'blink', textContent: main }) : main);
  $('#t-lcd-bar').style.setProperty('--fill', fill);
  $('#t-lcd').classList.toggle('lit', lit);
}
async function typeToken(token, units) {
  const final = () => lcd('Credit added', units ? `+${units}` : 'ACCEPT', '90%', { lit: true });
  if (calm) return final();
  let typed = '';
  for (const ch of token.replace(/\s/g, '')) {
    typed += ch;
    lcd('Token', typed.slice(-12).replace(/(\d{4})(?=\d)/g, '$1 '), '20%', { small: true });
    await wait(85);
  }
  await wait(300);
  for (let i = 0; i < 2; i++) { lcd('Status', 'ACCEPT', '20%'); await wait(360); lcd('Status', '\u00a0', '20%'); await wait(180); }
  final();
}

function mark(stepName, state) {
  const li = document.querySelector(`#timeline [data-step="${stepName}"]`);
  li.classList.toggle('done', state === 'done');
  li.classList.toggle('now', state === 'now');
}

function note(text) {
  $('#t-note').hidden = !text;
  $('#t-note span').textContent = text || '';
}

async function collect() {
  if (tokenShown || !secret) return;
  try {
    const res = await fetch('api/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, secret }) });
    const body = await res.json();
    if (res.status === 403) {
      // A wrong link will not become right by retrying; say so once and stop.
      badLink = true;
      return note(`${body.error}. Ask the sender to send the link again.`);
    }
    if (!res.ok) return note(body.error || 'The token could not be fetched yet. Retrying.');
    tokenShown = true;
    note('');
    $('#token').textContent = body.token;
    $('#units').textContent = body.units || '-';
    $('#token-card').hidden = false;
    $('#t-live').hidden = true;
    $('#copy-token').onclick = () => copyText(body.token.replace(/\s/g, ''), 'Token copied');
    typeToken(body.token, body.units);
  } catch {
    note('Could not reach the token service. Retrying.');
  }
}

async function refresh() {
  clearTimeout(timer);
  let req;
  try {
    req = await view('get_request', { id });
  } catch {
    note('Could not reach NEAR. Retrying.');
    timer = setTimeout(refresh, 8000);
    return;
  }
  if (!req) return show('missing');
  show('track');
  $('#t-meter').textContent = req.meter;
  $('#t-provider').textContent = providerName(req.provider).replace(/\s*\(.*\)$/, '');
  $('#t-naira').textContent = naira(req.naira);
  const st = stateOf(req);
  $('#t-lcd-co').textContent = (providerName(req.provider).match(/\(([^)]+)\)/) || [, 'Prepaid'])[1];
  if (!tokenShown) {
    ({
      open: () => lcd('Status', 'WAITING', '12%', { blink: true }),
      claimed: () => lcd('Status', 'AGENT PAYING', '45%', { blink: true }),
      paid: () => lcd('Status', 'PAID', '80%'),
      refunded: () => lcd('Status', 'REFUNDED', '0%'),
      expired: () => lcd('Status', 'EXPIRED', '0%'),
    })[st]();
  }
  mark('funded', 'done');
  mark('claimed', st === 'claimed' ? 'now' : st === 'paid' ? 'done' : '');
  mark('paid', st === 'paid' ? 'done' : '');
  const sub = {
    open: `Waiting for a local agent to take it. ${timeLeft(req.expires_ms)} before it is refunded.`,
    claimed: 'A local agent is paying the bill now.',
    paid: secret ? 'The bill is paid. Your token is ready.' : 'The bill is paid. Open the full link you were sent to see the token.',
    refunded: 'This request was cancelled and the money went back to the sender.',
    expired: 'No agent took this request in time. The sender can get the money back.',
  }[st];
  $('#t-sub').textContent = sub;
  $('#t-live').hidden = badLink || (['paid', 'refunded', 'expired'].includes(st) && (tokenShown || !secret || st !== 'paid'));
  if (st === 'paid') await collect();
  if (!['refunded', 'expired'].includes(st) && !tokenShown && !badLink) timer = setTimeout(refresh, 5000);
}

if (!Number.isSafeInteger(id) || id < 1) show('missing');
else refresh();
