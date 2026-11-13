import { view, naira, providerName, stateOf } from './chain.js';
import { LANGS, TEXT } from './track-i18n.js';
import { CONTRACT, EXPLORER } from './config.js';
import { $, show, copyText } from './ui.js';

const id = Number(new URLSearchParams(location.search).get('id'));
$('#t-proof').href = `${EXPLORER}/address/${CONTRACT}`;
const secret = location.hash.replace(/^#/, '').replace(/^s=/, '');
let timer = 0;
let tokenShown = false;
let badLink = false;
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- Language: English, Yorùbá or Pidgin, remembered on this device --------------------
const stored = (() => { try { return localStorage.getItem('sendam.lang'); } catch { return null; } })();
let lang = TEXT[stored] ? stored : (navigator.language || '').toLowerCase().startsWith('yo') ? 'yo' : 'en';
let T = TEXT[lang];
let lastReq = null;   // the request as last read, so a language change can redraw it
let lastNote = null;  // [key, extra] of the note on screen, for the same reason

function applyLanguage() {
  T = TEXT[lang];
  document.documentElement.lang = lang === 'pcm' ? 'pcm' : lang;
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = T[el.dataset.t];
  $('#t-title').innerHTML = T.title; // fixed text from track-i18n.js, with its own <em>
  for (const b of document.querySelectorAll('#lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  if (lastReq) describe(lastReq); else $('#t-sub').textContent = T.loading;
  if (lastNote) note(...lastNote);
}
$('#lang').replaceChildren(...LANGS.map(([code, name]) => Object.assign(document.createElement('button'), { type: 'button', textContent: name, lang: code === 'pcm' ? 'pcm' : code, onclick() {
  lang = code;
  try { localStorage.setItem('sendam.lang', code); } catch { /* the choice just will not be remembered */ }
  applyLanguage();
} })).map((b, i) => { b.dataset.lang = LANGS[i][0]; return b; }));
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

/** Shows a note by its key in the language file (or hides it with no key). */
function note(key, extra) {
  lastNote = key ? [key, extra] : null;
  const text = !key ? '' : typeof T[key] === 'function' ? T[key](extra) : T[key];
  $('#t-note').hidden = !text;
  $('#t-note span').textContent = text;
}

/** The sentence under the heading, for a request's current state. */
function describe(req) {
  const st = stateOf(req);
  $('#t-sub').textContent = {
    open: () => T.open(T.left(req.expires_ms - Date.now())),
    claimed: () => T.claimed,
    paid: () => (secret ? T.paid : T.paidNoLink),
    refunded: () => T.refunded,
    expired: () => T.expired,
  }[st]();
}

async function collect() {
  if (tokenShown || !secret) return;
  try {
    const res = await fetch('api/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, secret }) });
    const body = await res.json();
    if (res.status === 403) {
      // A wrong link will not become right by retrying; say so once and stop.
      badLink = true;
      return note('badLink', body.error);
    }
    if (!res.ok) return note('tokenLater');
    tokenShown = true;
    note();
    $('#token').textContent = body.token;
    $('#units').textContent = body.units || '-';
    $('#token-card').hidden = false;
    $('#t-live').hidden = true;
    $('#copy-token').onclick = () => copyText(body.token.replace(/\s/g, ''), T.copied);
    typeToken(body.token, body.units);
  } catch {
    note('noToken');
  }
}

async function refresh() {
  clearTimeout(timer);
  let req;
  try {
    req = await view('get_request', { id });
  } catch {
    note('noNear');
    timer = setTimeout(refresh, 8000);
    return;
  }
  if (!req) return show('missing');
  if (lastNote?.[0] === 'noNear') note();
  lastReq = req;
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
  describe(req);
  $('#t-live').hidden = badLink || (['paid', 'refunded', 'expired'].includes(st) && (tokenShown || !secret || st !== 'paid'));
  if (st === 'paid') await collect();
  if (!['refunded', 'expired'].includes(st) && !tokenShown && !badLink) timer = setTimeout(refresh, 5000);
}

applyLanguage();
if (!Number.isSafeInteger(id) || id < 1) show('missing');
else refresh();
