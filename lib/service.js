// What the verifier does, with its connections passed in so it can be tested.
import { createHash } from 'node:crypto';
import { readOutcome, requestIdFor } from './vtpass.js';

export class ServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const sha256hex = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');

const asId = (v) => {
  const id = Number(v);
  if (!Number.isSafeInteger(id) || id < 1) throw new ServiceError(400, 'id must be a positive whole number');
  return id;
};

/**
 * Pays the bill for a claimed request and, once VTpass reports it delivered with the
 * right meter and amount, tells the contract to pay the agent.
 */
export async function fulfil({ id, agent }, { near, vtpass }) {
  id = asId(id);
  if (typeof agent !== 'string' || !agent) throw new ServiceError(400, 'agent is required');
  const req = await near.view('get_request', { id });
  if (!req) throw new ServiceError(404, 'No request with that id');
  if (req.status.state === 'fulfilled') return { state: 'fulfilled', reference: req.status.reference, already: true };
  if (req.status.state !== 'claimed' || req.status.agent !== agent) {
    throw new ServiceError(409, 'Claim this request first, from the same account');
  }
  const { claim_minutes: claimMinutes } = await near.view('get_config');
  const claimedMs = req.status.until_ms - claimMinutes * 60_000;
  const requestId = requestIdFor(id, claimedMs);

  // Look first, so a retry never buys the same token twice.
  let out = readOutcome(await vtpass.requery(requestId));
  if (out.state === 'not_found') {
    out = readOutcome(await vtpass.pay({ requestId, provider: req.provider, meter: req.meter, naira: req.naira }));
  }
  if (out.state === 'pending') return { state: 'pending', reference: requestId };
  if (out.state !== 'delivered') {
    throw new ServiceError(502, `The bill payment did not go through${out.message ? `: ${out.message}` : ''}. Release the request and claim it again.`);
  }
  if (out.amount && out.amount !== req.naira) throw new ServiceError(502, `VTpass reports ₦${out.amount}, but the request is for ₦${req.naira}`);
  if (out.meter && out.meter !== req.meter) throw new ServiceError(502, 'VTpass reports a different meter number');

  const outcome = await near.confirm(id, agent, requestId);
  return { state: 'fulfilled', reference: requestId, txHash: outcome?.transaction?.hash || outcome?.transaction_outcome?.id || '' };
}

/** Gives the electricity token to whoever holds the request's secret. */
export async function collectToken({ id, secret }, { near, vtpass }) {
  id = asId(id);
  if (typeof secret !== 'string' || secret.length < 16 || secret.length > 128) throw new ServiceError(400, 'secret is missing or malformed');
  const req = await near.view('get_request', { id });
  if (!req) throw new ServiceError(404, 'No request with that id');
  if (sha256hex(secret) !== req.secret_hash) throw new ServiceError(403, 'This link is not valid for that request');
  if (req.status.state !== 'fulfilled') throw new ServiceError(409, 'The bill has not been paid yet');
  const out = readOutcome(await vtpass.requery(req.status.reference));
  if (out.state !== 'delivered' || !out.token) throw new ServiceError(502, 'The token could not be fetched from the bill provider. Try again shortly.');
  return { token: out.token, units: out.units, meter: req.meter, naira: req.naira, provider: req.provider };
}

/**
 * Looks up the customer on a prepaid meter, so the sender sees whose meter it is before
 * locking any money. Only the name and a short address come back; nothing is stored.
 */
export async function checkMeter({ provider, meter }, { vtpass }) {
  if (typeof provider !== 'string' || !/^[a-z]+-electric$/.test(provider)) throw new ServiceError(400, 'Choose an electricity company');
  meter = String(meter ?? '').replace(/\s/g, '');
  if (!/^\d{6,20}$/.test(meter)) throw new ServiceError(400, 'The meter number must be 6 to 20 digits');
  const res = await vtpass.verifyMeter({ provider, meter });
  const c = res?.content || {};
  const name = String(c.Customer_Name || c.customer_name || c.Name || '').trim();
  if (String(res?.code) !== '000' || c.error || c.WrongBillersCode === true || !name) {
    return { found: false, message: 'No prepaid meter with that number at this electricity company' };
  }
  const address = String(c.Address || c.address || '').trim().replace(/\s+/g, ' ');
  return { found: true, name, address: address.length > 60 ? `${address.slice(0, 57)}…` : address };
}
