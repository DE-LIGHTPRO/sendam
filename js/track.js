import { view, naira, providerName, stateOf, timeLeft } from './chain.js';
import { $, show, copyText } from './ui.js';

const id = Number(new URLSearchParams(location.search).get('id'));
const secret = location.hash.replace(/^#/, '').replace(/^s=/, '');
let timer = 0;
let tokenShown = false;
let badLink = false;

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
  $('#t-provider').textContent = providerName(req.provider);
  $('#t-naira').textContent = naira(req.naira);
  const st = stateOf(req);
  mark('funded', 'done');
  mark('claimed', st === 'claimed' ? 'now' : st === 'paid' ? 'done' : '');
  mark('paid', st === 'paid' ? 'done' : '');
  const sub = {
    open: `Waiting for a local agent to take it. ${timeLeft(req.expires_ms)} before it is refunded.`,
    claimed: 'A local agent is paying the bill now.',
    paid: secret ? 'The bill is paid. Your token is below.' : 'The bill is paid. Open the full link you were sent to see the token.',
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
