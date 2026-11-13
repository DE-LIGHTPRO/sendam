// A live quote from NEAR Intents (the 1Click API): what it would cost to deliver USDC on NEAR
// starting from USDC on another chain. Quotes are requested as dry runs, so nothing is
// charged and no deposit address is created.
//
// NEAR Intents only exists on mainnet, so this is a mainnet quote shown beside a testnet demo.
// It is the first half of Sendam's next step (funding a request from any chain); the second
// half, actually depositing, needs real money and is not built.
//
// Written from the 1Click API documentation. `npm run intents:check` prints the API's real
// answers, to confirm the request and response shapes on a machine that can reach it.
import { createHash } from 'node:crypto';
import { ServiceError } from './service.js';

export const INTENTS_URL = 'https://1click.chaindefuser.com';

/** Chains a sender can pay from, with the 1Click chain id and the known USDC asset id as a fallback. */
export const ORIGINS = {
  base: { label: 'Base', chain: 'base', asset: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near' },
  arb: { label: 'Arbitrum', chain: 'arb', asset: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near' },
  eth: { label: 'Ethereum', chain: 'eth', asset: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near' },
};
const NEAR_USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const USDC_DECIMALS = 6;
const QUICK_MS = 800;   // first attempt: answer fast
const PATIENT_MS = 3000; // if that finds no offer, give solvers longer

// A dry run still wants believable addresses, and the API refuses obvious placeholders such as
// the "dead" address. These receive nothing, because no deposit is ever made: they are derived
// from a fixed phrase, so nobody holds their keys. Two forms of each are tried, in case the API
// is strict about one.
const derived = (phrase) => createHash('sha256').update(phrase).digest('hex');
const REFUNDS = [`0x${derived('sendam dry-run refund').slice(0, 40)}`, `0x${derived('sendam dry-run refund 2').slice(0, 40)}`];
const RECIPIENTS = [derived('sendam dry-run recipient'), 'intents.near']; // a NEAR implicit account, then a named one

const toUnits = (usdc) => String(Math.round(Number(usdc) * 10 ** USDC_DECIMALS));
const fromUnits = (units) => Number(units) / 10 ** USDC_DECIMALS;

export function createIntents({ baseUrl = INTENTS_URL, apiKey, fetch = globalThis.fetch } = {}) {
  const headers = { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) };
  const url = (path) => `${baseUrl.replace(/\/$/, '')}${path}`;
  let tokens; // looked up once per server start

  async function json(res) {
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { message: text.slice(0, 200) }; }
  }

  /** The asset ids of USDC on NEAR and on the origin chain, from the API's own token list. */
  async function assets(origin) {
    if (!tokens) {
      try {
        const res = await fetch(url('/v0/tokens'), { headers });
        const list = res.ok ? await json(res) : null;
        tokens = Array.isArray(list) ? list : [];
      } catch {
        tokens = [];
      }
    }
    const find = (chain) => tokens.find((t) => t.symbol === 'USDC' && t.blockchain === chain)?.assetId;
    return { from: find(origin.chain) || origin.asset, to: find('near') || NEAR_USDC };
  }

  const recent = new Map(); // quotes from the last half minute, by chain and amount
  let pick = { refund: 0, recipient: 0 }; // the address forms the API last accepted
  async function post(body) {
    const res = await fetch(url('/v0/quote'), { method: 'POST', headers, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, body: await json(res) };
  }
  /** Asks for a quote, moving to the other address form if the API calls one invalid. */
  async function ask(ids, usdc, swapType, waitMs = QUICK_MS) {
    let out;
    for (let tries = 0; tries < 4; tries++) {
      out = await post(request(ids, usdc, swapType, REFUNDS[pick.refund], RECIPIENTS[pick.recipient], waitMs));
      const why = String(out.body?.message || '');
      if (out.ok || !/not valid|invalid/i.test(why)) break;
      if (/refundTo/i.test(why) && pick.refund < REFUNDS.length - 1) pick = { ...pick, refund: pick.refund + 1 };
      else if (/recipient/i.test(why) && pick.recipient < RECIPIENTS.length - 1) pick = { ...pick, recipient: pick.recipient + 1 };
      else break;
    }
    return out;
  }

  return {
    /** Raw answers, for `npm run intents:check`. */
    async probe(originKey = 'base', usdc = 13.3) {
      const origin = ORIGINS[originKey];
      const ids = await assets(origin);
      const sample = (tokens || []).filter((t) => t.symbol === 'USDC').slice(0, 8);
      const quote = await ask(ids, usdc, 'EXACT_OUTPUT');
      return { tokenCount: (tokens || []).length, usdcTokens: sample, ids, quote, addresses: { refundTo: REFUNDS[pick.refund], recipient: RECIPIENTS[pick.recipient] } };
    },

    /** What it costs to land `usdc` USDC on NEAR from the origin chain. */
    async quote({ usdc, from }) {
      const origin = ORIGINS[from];
      if (!origin) throw new ServiceError(400, 'Choose Base, Arbitrum or Ethereum');
      const amount = Number(usdc);
      if (!(amount >= 0.5 && amount <= 5000)) throw new ServiceError(400, 'The amount must be between 0.5 and 5,000 USDC');
      // The asset ids are known (and were confirmed against the API's token list), so quoting
      // skips the token-list download. Recent answers are reused for half a minute.
      const ids = { from: origin.asset, to: NEAR_USDC };
      const key = `${from}:${toUnits(amount)}`;
      const hit = recent.get(key);
      if (hit && Date.now() - hit.at < 30_000) return hit.value;
      // Ask for the exact amount to arrive. If the API will not quote that way, quote the same
      // amount going in instead, which for USDC to USDC is nearly the same thing.
      let mode = 'EXACT_OUTPUT';
      let out = await ask(ids, amount, mode);
      if (!out.ok) out = await ask(ids, amount, mode, PATIENT_MS);
      if (!out.ok) {
        mode = 'EXACT_INPUT';
        out = await ask(ids, amount, mode, PATIENT_MS);
      }
      const q = out.body?.quote;
      if (!out.ok || !q || !q.amountIn || !q.amountOut) {
        throw new ServiceError(502, `NEAR Intents did not return a quote${out.body?.message ? `: ${String(out.body.message).slice(0, 140)}` : ''}`);
      }
      const pay = fromUnits(q.amountIn);
      const receive = fromUnits(q.amountOut);
      const value = {
        from, fromLabel: origin.label, mode,
        payUsdc: Number(pay.toFixed(2)),
        receiveUsdc: Number(receive.toFixed(2)),
        costUsdc: Number(Math.max(0, pay - receive).toFixed(2)),
        seconds: Number.isFinite(Number(q.timeEstimate)) ? Number(q.timeEstimate) : null,
      };
      if (recent.size > 200) recent.clear();
      recent.set(key, { at: Date.now(), value });
      return value;
    },
  };
}

function request(ids, usdc, swapType, refundTo, recipient, waitMs = QUICK_MS) {
  return {
    dry: true,
    swapType,
    slippageTolerance: 100, // 1%, in basis points
    originAsset: ids.from,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: ids.to,
    amount: toUnits(usdc),
    refundTo,
    refundType: 'ORIGIN_CHAIN',
    recipient,
    recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    quoteWaitingTimeMs: waitMs, // how long the API collects solver offers before answering
  };
}
