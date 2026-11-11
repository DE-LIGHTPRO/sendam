import test from 'node:test';
import assert from 'node:assert/strict';
import { lagosStamp, requestIdFor, readOutcome, createVtpass } from '../lib/vtpass.js';
import { fulfil, collectToken, sha256hex, ServiceError } from '../lib/service.js';
import { endpoint } from '../lib/http.js';

const MIN = 60_000;
const CLAIMED = Date.UTC(2026, 10, 14, 18, 5); // 19:05 in Lagos
const SECRET = 'k3Jx9QvM2pLr8sTw4yZa';

function request(status, extra = {}) {
  return {
    id: 7, sender: 'ada.testnet', amount: '12500000', naira: 20000, provider: 'ibadan-electric', meter: '1111111111111',
    created_ms: CLAIMED - 10 * MIN, expires_ms: CLAIMED + 60 * MIN, secret_hash: sha256hex(SECRET), status, ...extra,
  };
}
const claimed = { state: 'claimed', agent: 'tunde.testnet', until_ms: CLAIMED + 30 * MIN };
const REQUEST_ID = '202611141905SENDAM000007';

const delivered = (over = {}) => ({
  code: '000', response_description: 'TRANSACTION SUCCESSFUL', amount: 20000, purchased_code: 'Token : 1234 5678 9012 3456 7890',
  units: '79.9 kWh', content: { transactions: { status: 'delivered', unique_element: '1111111111111', transactionId: '17941234', amount: 20000 } }, ...over,
});
const notFound = { code: '015', response_description: 'INVALID REQUEST ID', content: {} };

function fakes({ req = request(claimed), requery = [notFound], pay = delivered() } = {}) {
  const calls = { pay: [], requery: [], confirm: [] };
  const near = {
    async view(method, args) {
      if (method === 'get_config') return { claim_minutes: 30 };
      if (method === 'get_request') return args.id === 7 ? req : null;
      throw new Error('unexpected view ' + method);
    },
    async confirm(id, agent, reference) {
      calls.confirm.push({ id, agent, reference });
      return { transaction: { hash: 'TxHash123' } };
    },
  };
  const answers = [...requery];
  const vtpass = {
    async requery(id) { calls.requery.push(id); return answers.length > 1 ? answers.shift() : answers[0]; },
    async pay(args) { calls.pay.push(args); return pay; },
  };
  return { near, vtpass, calls };
}

test('Lagos time stamps and request ids are deterministic', () => {
  assert.equal(lagosStamp(Date.UTC(2026, 10, 14, 23, 30)), '202611150030'); // past midnight in Lagos
  assert.equal(requestIdFor(7, CLAIMED), REQUEST_ID);
  assert.match(REQUEST_ID, /^\d{12}/);
});

test('VTpass answers are read into one shape', () => {
  const ok = readOutcome(delivered());
  assert.deepEqual([ok.state, ok.amount, ok.meter, ok.token, ok.units], ['delivered', 20000, '1111111111111', '1234 5678 9012 3456 7890', '79.9 kWh']);
  assert.equal(readOutcome({ code: '099', content: { transactions: { status: 'pending' } } }).state, 'pending');
  assert.equal(readOutcome(notFound).state, 'not_found');
  assert.equal(readOutcome({ code: '016', content: { transactions: { status: 'failed' } } }).state, 'failed');
  assert.equal(readOutcome({ code: '000', token: '12345678901234567890', content: { transactions: { status: 'delivered' } } }).token, '1234 5678 9012 3456 7890');
});

test('the VTpass client sends the documented requests with both keys', async () => {
  const sent = [];
  const fetch = async (url, init) => { sent.push({ url, init }); return { status: 200, text: async () => '{"code":"000"}' }; };
  const v = createVtpass({ baseUrl: 'https://sandbox.vtpass.com/', apiKey: 'A', secretKey: 'S', phone: '08011111111', fetch });
  await v.pay({ requestId: REQUEST_ID, provider: 'ibadan-electric', meter: '1111111111111', naira: 20000 });
  await v.requery(REQUEST_ID);
  assert.equal(sent[0].url, 'https://sandbox.vtpass.com/api/pay');
  assert.deepEqual(JSON.parse(sent[0].init.body), { request_id: REQUEST_ID, serviceID: 'ibadan-electric', billersCode: '1111111111111', variation_code: 'prepaid', amount: 20000, phone: '08011111111' });
  assert.equal(sent[0].init.headers['api-key'], 'A');
  assert.equal(sent[0].init.headers['secret-key'], 'S');
  assert.equal(sent[1].url, 'https://sandbox.vtpass.com/api/requery');
  assert.throws(() => createVtpass({ baseUrl: 'x' }), /not configured/);
});

test('fulfilling pays the bill once, then confirms on chain for the agent', async () => {
  const f = fakes();
  const out = await fulfil({ id: 7, agent: 'tunde.testnet' }, f);
  assert.deepEqual(out, { state: 'fulfilled', reference: REQUEST_ID, txHash: 'TxHash123' });
  assert.equal(f.calls.pay.length, 1);
  assert.deepEqual(f.calls.pay[0], { requestId: REQUEST_ID, provider: 'ibadan-electric', meter: '1111111111111', naira: 20000 });
  assert.deepEqual(f.calls.confirm, [{ id: 7, agent: 'tunde.testnet', reference: REQUEST_ID }]);
});

test('a retry after the bill was already paid does not pay again', async () => {
  const f = fakes({ requery: [delivered()] });
  await fulfil({ id: '7', agent: 'tunde.testnet' }, f);
  assert.equal(f.calls.pay.length, 0);
  assert.equal(f.calls.confirm.length, 1);
});

test('a pending payment is reported, not confirmed', async () => {
  const f = fakes({ pay: { code: '099', content: { transactions: { status: 'pending' } } } });
  const out = await fulfil({ id: 7, agent: 'tunde.testnet' }, f);
  assert.equal(out.state, 'pending');
  assert.equal(f.calls.confirm.length, 0);
});

test('fulfilling refuses the wrong agent, an unclaimed request, a failed payment and a mismatch', async () => {
  await assert.rejects(fulfil({ id: 7, agent: 'bisi.testnet' }, fakes()), (e) => e.status === 409);
  await assert.rejects(fulfil({ id: 7, agent: 'tunde.testnet' }, fakes({ req: request({ state: 'open' }) })), (e) => e.status === 409);
  await assert.rejects(fulfil({ id: 8, agent: 'tunde.testnet' }, fakes()), (e) => e.status === 404);
  await assert.rejects(fulfil({ id: 'x', agent: 'tunde.testnet' }, fakes()), (e) => e.status === 400);
  await assert.rejects(fulfil({ id: 7, agent: 'tunde.testnet' }, fakes({ pay: { code: '016', response_description: 'TRANSACTION FAILED', content: { transactions: { status: 'failed' } } } })), (e) => e.status === 502 && /TRANSACTION FAILED/.test(e.message));
  const wrongAmount = fakes({ pay: delivered({ amount: 5000 }) });
  await assert.rejects(fulfil({ id: 7, agent: 'tunde.testnet' }, wrongAmount), /₦5000/);
  assert.equal(wrongAmount.calls.confirm.length, 0, 'nothing is confirmed after a mismatch');
});

test('an already fulfilled request is reported as done', async () => {
  const f = fakes({ req: request({ state: 'fulfilled', agent: 'tunde.testnet', reference: REQUEST_ID, at_ms: 1 }) });
  assert.deepEqual(await fulfil({ id: 7, agent: 'tunde.testnet' }, f), { state: 'fulfilled', reference: REQUEST_ID, already: true });
});

test('the token goes only to whoever holds the secret, once the bill is paid', async () => {
  const done = request({ state: 'fulfilled', agent: 'tunde.testnet', reference: REQUEST_ID, at_ms: 1 });
  const f = fakes({ req: done, requery: [delivered()] });
  const out = await collectToken({ id: 7, secret: SECRET }, f);
  assert.deepEqual(out, { token: '1234 5678 9012 3456 7890', units: '79.9 kWh', meter: '1111111111111', naira: 20000, provider: 'ibadan-electric' });
  assert.deepEqual(f.calls.requery, [REQUEST_ID]);
  await assert.rejects(collectToken({ id: 7, secret: 'wrong-secret-wrong-secret' }, f), (e) => e.status === 403);
  await assert.rejects(collectToken({ id: 7, secret: 'short' }, f), (e) => e.status === 400);
  await assert.rejects(collectToken({ id: 7, secret: SECRET }, fakes()), (e) => e.status === 409);
});

test('the HTTP wrapper answers JSON, uses 202 for pending and hides unexpected errors', async () => {
  const res = () => { const r = { headers: {}, setHeader: (k, v) => { r.headers[k] = v; }, end: (b) => { r.body = JSON.parse(b); } }; return r; };
  const ok = res();
  await endpoint(async (b) => ({ state: 'pending', got: b.id }), {})({ method: 'POST', body: { id: 7 } }, ok);
  assert.deepEqual([ok.statusCode, ok.body], [202, { state: 'pending', got: 7 }]);
  const known = res();
  await endpoint(async () => { throw new ServiceError(409, 'Claim this request first'); }, {})({ method: 'POST', body: '{}' }, known);
  assert.deepEqual([known.statusCode, known.body.error], [409, 'Claim this request first']);
  const unknown = res();
  const quiet = console.error;
  console.error = () => {};
  await endpoint(async () => { throw new Error('secret internal detail'); }, {})({ method: 'POST', body: {} }, unknown);
  console.error = quiet;
  assert.equal(unknown.statusCode, 500);
  assert.doesNotMatch(unknown.body.error, /secret internal detail/);
  const unset = res();
  await endpoint(async () => ({}), () => { throw new Error('SENDAM_CONTRACT is not set'); })({ method: 'POST', body: {} }, unset);
  assert.deepEqual([unset.statusCode, unset.body.error], [503, 'The verifier is not set up yet: SENDAM_CONTRACT is not set']);
  const get = res();
  await endpoint(async () => ({}), {})({ method: 'GET' }, get);
  assert.equal(get.statusCode, 405);
});

test('a meter lookup returns the customer name, or says the meter is unknown', async () => {
  const { checkMeter } = await import('../lib/service.js');
  const asked = [];
  const vtpass = (res) => ({ async verifyMeter(a) { asked.push(a); return res; } });
  const found = await checkMeter({ provider: 'ibadan-electric', meter: '1111 1111 11111' }, { vtpass: vtpass({ code: '000', content: { Customer_Name: 'TESTMETER1', Address: 'ABULE - EGBA BU ALA ABULE' } }) });
  assert.deepEqual(found, { found: true, name: 'TESTMETER1', address: 'ABULE - EGBA BU ALA ABULE' });
  assert.deepEqual(asked[0], { provider: 'ibadan-electric', meter: '11111111111111'.slice(0, 13) });
  const wrong = await checkMeter({ provider: 'ibadan-electric', meter: '1234567890' }, { vtpass: vtpass({ code: '000', content: { error: 'Meter not found', WrongBillersCode: true } }) });
  assert.equal(wrong.found, false);
  const quiet = console.warn;
  console.warn = () => {};
  await assert.rejects(checkMeter({ provider: 'ibadan-electric', meter: '1234567890' }, { vtpass: vtpass('Invalid Credentials.') }), (e) => e.status === 502 && /Invalid Credentials/.test(e.message));
  console.warn = quiet;
  await assert.rejects(checkMeter({ provider: 'ibadan-electric', meter: '12AB' }, { vtpass: vtpass({}) }), (e) => e.status === 400);
  await assert.rejects(checkMeter({ provider: 'evil', meter: '1234567' }, { vtpass: vtpass({}) }), (e) => e.status === 400);
});

test('the simulated bill provider runs the whole verifier flow without VTpass', async () => {
  const { createSimulatedVtpass } = await import('../lib/vtpass-sim.js');
  const { checkMeter } = await import('../lib/service.js');
  const vtpass = createSimulatedVtpass();
  assert.equal((await checkMeter({ provider: 'ibadan-electric', meter: '1111111111111' }, { vtpass })).name, 'TESTMETER1');
  assert.equal((await checkMeter({ provider: 'ibadan-electric', meter: '2222222222' }, { vtpass })).found, false);
  const f = fakes();
  const out = await fulfil({ id: 7, agent: 'tunde.testnet' }, { near: f.near, vtpass });
  assert.equal(out.state, 'fulfilled');
  const done = fakes({ req: request({ state: 'fulfilled', agent: 'tunde.testnet', reference: REQUEST_ID, at_ms: 1 }) });
  const token = await collectToken({ id: 7, secret: SECRET }, { near: done.near, vtpass });
  assert.match(token.token, /^\d{4}( \d{4}){4}$/);
  assert.deepEqual(token, await collectToken({ id: 7, secret: SECRET }, { near: done.near, vtpass }), 'the same purchase always gives the same token');
});
