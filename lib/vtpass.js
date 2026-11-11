// Client for VTpass, a Nigerian bill-payment API, used to buy and look up prepaid
// electricity tokens. The sandbox needs its own free credentials (sandbox.vtpass.com).
//
// Written from VTpass's published documentation. It has not yet been run against the
// live sandbox: the first run happens on the deployer's machine.

const LAGOS_OFFSET_MS = 60 * 60 * 1000; // Africa/Lagos is UTC+1 all year

const pad = (n) => String(n).padStart(2, '0');

/** YYYYMMDDHHmm in Lagos time. VTpass requires request ids to start with this. */
export function lagosStamp(ms) {
  const d = new Date(ms + LAGOS_OFFSET_MS);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

/**
 * The VTpass request id for one claim of one Sendam request. It is derived, not random,
 * so a retry after a crash looks up the same purchase instead of paying twice.
 */
export function requestIdFor(id, claimedMs) {
  return `${lagosStamp(claimedMs)}SENDAM${String(id).padStart(6, '0')}`;
}

export function createVtpass({ baseUrl, apiKey, secretKey, phone, fetch = globalThis.fetch }) {
  if (!baseUrl || !apiKey || !secretKey) throw new Error('VTpass is not configured (VTPASS_BASE_URL, VTPASS_API_KEY, VTPASS_SECRET_KEY)');
  async function post(path, body) {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-key': apiKey, 'secret-key': secretKey },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`VTpass answered ${res.status} with something that is not JSON`);
    }
  }
  return {
    /** Looks up the name on a meter. */
    verifyMeter: ({ provider, meter }) => post('/api/merchant-verify', { billersCode: meter, serviceID: provider, type: 'prepaid' }),
    /** Buys a prepaid electricity token. */
    pay: ({ requestId, provider, meter, naira }) =>
      post('/api/pay', { request_id: requestId, serviceID: provider, billersCode: meter, variation_code: 'prepaid', amount: naira, phone }),
    /** Looks up a purchase by its request id. */
    requery: (requestId) => post('/api/requery', { request_id: requestId }),
  };
}

/** Pulls the electricity token out of the forms VTpass uses ("Token : 1234 5678 ..."). */
function tokenFrom(res) {
  const raw = res?.purchased_code || res?.token || res?.mainToken || res?.content?.transactions?.purchased_code || '';
  const match = String(raw).match(/(\d[\d\s-]{14,}\d)/);
  return match ? match[1].replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ') : '';
}

/**
 * Turns any VTpass answer into one shape:
 * { state: 'delivered' | 'pending' | 'failed' | 'not_found', amount, meter, token, units, transactionId, message }
 */
export function readOutcome(res) {
  const tx = res?.content?.transactions || {};
  const status = String(tx.status || '').toLowerCase();
  const code = String(res?.code ?? '');
  let state = 'failed';
  if (code === '000' && status === 'delivered') state = 'delivered';
  else if (code === '099' || ['pending', 'initiated', 'processing'].includes(status)) state = 'pending';
  else if (code === '015' || /not\s*found|invalid request id/i.test(res?.response_description || '')) state = 'not_found';
  return {
    state,
    amount: Number(res?.amount ?? tx.amount ?? 0),
    meter: String(tx.unique_element ?? ''),
    token: tokenFrom(res),
    units: String(res?.units ?? res?.mainTokenUnits ?? ''),
    transactionId: String(tx.transactionId ?? ''),
    message: String(res?.response_description ?? ''),
  };
}
