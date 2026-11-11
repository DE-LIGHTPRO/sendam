// Read-only access to NEAR over JSON-RPC, plus the money and time formatting used everywhere.
import { CONTRACT, RPC_URLS, USDC_DECIMALS, PROVIDERS } from './config.js';

async function rpc(method, params) {
  let last;
  for (const url of RPC_URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'sendam', method, params }),
      });
      const body = await res.json();
      if (body.error) throw new Error(body.error.data || body.error.message || 'RPC error');
      return body.result;
    } catch (err) {
      last = err;
    }
  }
  throw last || new Error('No RPC endpoint answered');
}

const toBase64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

/** Calls a read-only contract method and returns its JSON result. */
export async function view(method, args = {}, contractId = CONTRACT) {
  const result = await rpc('query', {
    request_type: 'call_function',
    finality: 'optimistic',
    account_id: contractId,
    method_name: method,
    args_base64: toBase64(JSON.stringify(args)),
  });
  const text = new TextDecoder().decode(new Uint8Array(result.result));
  return text ? JSON.parse(text) : null;
}

/** Finds Sendam events in a finished transaction (used after a wallet redirects back). */
export async function eventsOf(txHash, signerId) {
  const result = await rpc('tx', { tx_hash: txHash, sender_account_id: signerId, wait_until: 'EXECUTED_OPTIMISTIC' });
  return eventsFromOutcome(result);
}

export function eventsFromOutcome(outcome) {
  const logs = (outcome?.receipts_outcome || []).flatMap((r) => r.outcome?.logs || []);
  return logs
    .filter((l) => l.startsWith('EVENT_JSON:'))
    .map((l) => { try { return JSON.parse(l.slice(11)); } catch { return null; } })
    .filter((e) => e && e.standard === 'sendam');
}

export const providerName = (id) => (PROVIDERS.find(([v]) => v === id) || [id, id])[1];

/** USDC amounts travel as strings of the smallest unit. */
export function toUnits(usdc) {
  const [whole, frac = ''] = String(usdc).split('.');
  return (BigInt(whole || '0') * 10n ** BigInt(USDC_DECIMALS) + BigInt((frac + '000000').slice(0, USDC_DECIMALS))).toString();
}
export function fromUnits(units) {
  const n = BigInt(units || '0');
  const d = 10n ** BigInt(USDC_DECIMALS);
  const cents = (n % d) / 10n ** BigInt(USDC_DECIMALS - 2);
  return `${n / d}.${String(cents).padStart(2, '0')}`;
}
export const usd = (units) => `${fromUnits(units)} USDC`;
export const naira = (n) => '₦' + Number(n).toLocaleString('en-NG');
/** The exchange rate an offer implies, in naira per USDC. */
export const impliedRate = (nairaAmount, units) => Math.round(nairaAmount / (Number(units) / 10 ** USDC_DECIMALS));

export function timeLeft(ms, now = Date.now()) {
  const left = ms - now;
  if (left <= 0) return 'expired';
  const m = Math.round(left / 60000);
  if (m < 60) return `${m} min left`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min left` : `${Math.floor(h / 24)} days left`;
}

export const maskMeter = (m) => (m.length > 6 ? `${m.slice(0, 3)}${'•'.repeat(m.length - 6)}${m.slice(-3)}` : m);

/** Plain words for a request's state, as seen at a given moment. */
export function stateOf(req, now = Date.now()) {
  const s = req.status;
  if (s.state === 'fulfilled') return 'paid';
  if (s.state === 'refunded') return 'refunded';
  if (s.state === 'claimed' && s.until_ms > now) return 'claimed';
  if (now >= req.expires_ms) return 'expired';
  return 'open';
}
