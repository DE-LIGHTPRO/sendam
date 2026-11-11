// End-to-end check of the real pages in a real browser.
//
// NEAR testnet and VTpass cannot be reached from every machine, so this test stands in
// for them: a small in-memory model of the two contracts answers the browser's JSON-RPC
// calls, a stand-in wallet signs, and the /api endpoints run the REAL verifier code
// (lib/service.js) against a fake VTpass. The contract itself is tested separately in Rust.
//   npm run test:e2e
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');

const PORT = 4399;
const BASE = `http://localhost:${PORT}`;
// The simulated chain answers to whatever contract names the site is configured with.
const SITE_CONFIG = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'config.js'), 'utf8');
const CONTRACT = SITE_CONFIG.match(/export const CONTRACT = ['"]([^'"]+)['"]/)[1];
const USDC = SITE_CONFIG.match(/export const USDC = ['"]([^'"]+)['"]/)[1];
const MIN = 60_000;
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// ---- A small model of the two contracts ------------------------------------------
class Chain {
  constructor() {
    this.balances = new Map();
    this.registered = new Set([CONTRACT]);
    this.requests = new Map();
    this.nextId = 1;
    this.claimMs = 30 * MIN;
  }
  bal(a) { return this.balances.get(a) || 0n; }
  move(from, to, amount) {
    if (!this.registered.has(to)) throw new Error(`Smart contract panicked: The account ${to} is not registered`);
    if (this.bal(from) < amount) throw new Error('Smart contract panicked: The account doesn\'t have enough balance');
    this.balances.set(from, this.bal(from) - amount);
    this.balances.set(to, this.bal(to) + amount);
  }
  view(contract, method, args) {
    if (contract === USDC) {
      if (method === 'ft_balance_of') return String(this.bal(args.account_id));
      if (method === 'storage_balance_of') return this.registered.has(args.account_id) ? { total: '1', available: '0' } : null;
    }
    const now = Date.now();
    const all = [...this.requests.values()].sort((a, b) => b.id - a.id);
    switch (method) {
      case 'get_request': return this.requests.get(args.id) || null;
      case 'get_config': return { claim_minutes: this.claimMs / MIN, next_id: this.nextId };
      case 'list_requests': return all.slice(0, args.limit || 20);
      case 'list_open': return all.filter((r) => r.expires_ms > now && (r.status.state === 'open' || (r.status.state === 'claimed' && r.status.until_ms <= now)));
      case 'list_by_account': return all.filter((r) => r.sender === args.account || r.status.agent === args.account);
    }
    throw new Error(`unknown view ${method}`);
  }
  call(signer, { receiverId, methodName, args }) {
    const logs = [];
    const event = (name, data) => logs.push(`EVENT_JSON:${JSON.stringify({ standard: 'sendam', version: '1.0.0', event: name, data: [data] })}`);
    const now = Date.now();
    if (receiverId === USDC && methodName === 'faucet') {
      this.registered.add(signer);
      this.balances.set(signer, this.bal(signer) + 100_000_000n);
    } else if (receiverId === USDC && methodName === 'register') {
      this.registered.add(args.account_id);
    } else if (receiverId === USDC && methodName === 'ft_transfer_call') {
      const m = JSON.parse(args.msg);
      assert.match(m.secret_hash, /^[0-9a-f]{64}$/);
      this.move(signer, CONTRACT, BigInt(args.amount));
      const id = this.nextId++;
      this.requests.set(id, { id, sender: signer, amount: args.amount, naira: m.naira, provider: m.provider, meter: m.meter, created_ms: now, expires_ms: now + m.expires_in_minutes * MIN, secret_hash: m.secret_hash, status: { state: 'open' } });
      event('create', { id, sender: signer, amount: args.amount });
    } else if (receiverId === CONTRACT && methodName === 'claim') {
      const r = this.requests.get(args.id);
      if (r.sender === signer) throw new Error('Smart contract panicked: A sender cannot fulfil their own request');
      r.status = { state: 'claimed', agent: signer, until_ms: now + this.claimMs };
    } else if (receiverId === CONTRACT && methodName === 'release') {
      this.requests.get(args.id).status = { state: 'open' };
    } else if (receiverId === CONTRACT && methodName === 'refund') {
      const r = this.requests.get(args.id);
      if (r.status.state !== 'open') throw new Error('Smart contract panicked: This request is closed');
      r.status = { state: 'refunded', at_ms: now };
      this.move(CONTRACT, r.sender, BigInt(r.amount));
    } else {
      throw new Error(`unknown call ${receiverId}.${methodName}`);
    }
    return { receipts_outcome: [{ outcome: { logs } }], transaction: { hash: 'FakeTx' + this.nextId } };
  }
  confirm(id, agent, reference) {
    const r = this.requests.get(id);
    assert.equal(r.status.state, 'claimed');
    assert.equal(r.status.agent, agent);
    r.status = { state: 'fulfilled', agent, reference, at_ms: Date.now() };
    this.move(CONTRACT, agent, BigInt(r.amount));
    return { transaction: { hash: 'FakeConfirmTx' } };
  }
}

// A fake VTpass that remembers purchases by request id, like the real one.
class FakeVtpass {
  constructor() { this.purchases = new Map(); this.payCalls = 0; }
  async pay({ requestId, meter, naira }) {
    this.payCalls++;
    const res = { code: '000', response_description: 'TRANSACTION SUCCESSFUL', amount: naira, purchased_code: 'Token : 4321 8765 2109 6543 0987', units: '64.5 kWh', content: { transactions: { status: 'delivered', unique_element: meter, transactionId: '1794' + this.payCalls, amount: naira } } };
    this.purchases.set(requestId, res);
    return res;
  }
  async verifyMeter({ meter }) {
    return meter === '1111111111111'
      ? { code: '000', content: { Customer_Name: 'TESTMETER1', Address: 'ABULE - EGBA BU ALA ABULE', WrongBillersCode: false } }
      : { code: '000', content: { error: 'Meter not found', WrongBillersCode: true } };
  }
  async requery(requestId) {
    return this.purchases.get(requestId) || { code: '015', response_description: 'INVALID REQUEST ID', content: {} };
  }
}

let passed = 0;
// SHOTS=some/folder saves a screenshot of each key screen, for design review.
const SHOTS = process.env.SHOTS;
const shot = (page, name) => (SHOTS ? page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }) : null);
async function step(name, fn) {
  await fn();
  passed++;
  console.log('ok', passed, '-', name);
}

(async () => {
  const service = await import(join(__dirname, '..', 'lib', 'service.js'));
  const chain = new Chain();
  const vtpass = new FakeVtpass();
  const deps = { near: { view: async (m, a) => chain.view(CONTRACT, m, a), confirm: async (...a) => chain.confirm(...a) }, vtpass };

  const server = spawn(process.execPath, [join(__dirname, '..', 'scripts', 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => server.stdout.once('data', r));
  const browser = await chromium.launch();
  const errors = [];

  async function open(account, path, viewport = process.env.WIDE ? { width: 1440, height: 900 } : { width: 390, height: 844 }) {
    // Reduced motion keeps every block visible, so the accessibility check sees the whole page.
    const ctx = await browser.newContext({ viewport, bypassCSP: true, reducedMotion: 'reduce' });
    await ctx.exposeBinding('__fakeCall', (_src, signer, tx) => chain.call(signer, tx));
    await ctx.addInitScript((acc) => {
      if (!acc) return;
      window.__SENDAM_TEST_WALLET = {
        accountId: () => acc,
        onChange() {},
        signIn() {},
        signOut: async () => {},
        call: (tx) => window.__fakeCall(acc, tx),
      };
    }, account);
    // The browser's NEAR JSON-RPC calls are answered by the model.
    await ctx.route(/rpc/, async (route) => {
      const body = JSON.parse(route.request().postData());
      const p = body.params;
      const args = JSON.parse(Buffer.from(p.args_base64, 'base64').toString() || '{}');
      let result;
      try {
        result = chain.view(p.account_id, p.method_name, args);
      } catch (err) {
        return route.fulfill({ json: { jsonrpc: '2.0', id: body.id, error: { message: err.message } } });
      }
      const bytes = [...Buffer.from(JSON.stringify(result))];
      return route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result: { result: bytes, logs: [] } } });
    });
    // The verifier endpoints run the real service code against the fakes.
    for (const [name, fn] of [['fulfil', service.fulfil], ['token', service.collectToken], ['meter', service.checkMeter]]) {
      await ctx.route(`${BASE}/api/${name}`, async (route) => {
        try {
          const out = await fn(JSON.parse(route.request().postData()), deps);
          return route.fulfill({ status: out.state === 'pending' ? 202 : 200, json: out });
        } catch (err) {
          return route.fulfill({ status: err.status || 500, json: { error: err.message } });
        }
      });
    }
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${path}: ${e.message}`));
    // A deliberately wrong link is refused with 403; the browser logs that, and it is expected.
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text()) && !(path.includes('not-the-right-secret') && /403/.test(m.text()))) errors.push(`${path}: ${m.text()}`); });
    await page.goto(BASE + path);
    return page;
  }
  const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  try {
    let link = '';
    let firstTotal = '';

    await step('the landing page shows the meter and leads to both sides of the app', async () => {
      const page = await open(null, '/', { width: 1440, height: 900 });
      await page.getByRole('heading', { level: 1, name: 'Send light home.' }).waitFor();
      assert.equal(await page.locator('#lcd').textContent(), '76.8', 'with reduced motion the meter shows the credited state');
      assert.ok(await page.locator('#stage').evaluate((el) => el.classList.contains('lit')));
      const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
      assert.ok(hrefs.includes('send') && hrefs.includes('agent'));
      await shot(page, '0-landing-desktop');
      assert.ok(await noSideScroll(page));
      await page.context().close();
    });

    await step('a sender gets test USDC, sends a bill and gets a link for home', async () => {
      const page = await open('ada.testnet', '/send');
      await page.getByRole('heading', { name: 'Pay a bill back home' }).waitFor();
      await page.waitForFunction(() => document.querySelector('#balance').textContent === '0.00 USDC');
      await page.getByRole('button', { name: 'Get 100 test USDC' }).click();
      await page.waitForFunction(() => document.querySelector('#balance').textContent === '100.00 USDC');
      await page.locator('#meter').fill('1111111111111');
      await page.locator('#meter-check[data-state="found"]').waitFor();
      assert.match(await page.locator('#meter-check').textContent(), /TESTMETER1/);
      assert.equal(await page.locator('#r-name').textContent(), 'TESTMETER1', 'the summary names whose meter it is');
      await page.getByRole('button', { name: '₦20,000' }).click();
      assert.equal(await page.locator('#q-naira').textContent(), '₦20,000');
      assert.ok(await page.locator('#rate').isHidden(), 'rate and tip are tucked away until asked for');
      await shot(page, '1-send-form');
      firstTotal = await page.locator('#q-total').textContent();
      assert.equal(firstTotal, '13.30 USDC'); // 20,000 / 1,550 = 12.91, plus a 3% tip
      await page.getByRole('button', { name: 'Lock USDC and send' }).click();
      await page.getByRole('heading', { name: 'Light is on its way.' }).waitFor();
      await page.locator('#t-qr svg').waitFor();
      await page.waitForFunction(() => document.querySelector('#t-usdc').textContent === '13.30 USDC');
      assert.match(await page.locator('#t-for').textContent(), /TESTMETER1/);
      await page.waitForTimeout(1600);
      await shot(page, '2-sent');
      link = await page.locator('#share-link').textContent();
      assert.match(link, /\/track\?id=1#[A-Za-z0-9_-]{24}$/);
      assert.equal(sha(link.split('#')[1]), chain.requests.get(1).secret_hash, 'only the hash of the secret is on chain');
      assert.equal(chain.requests.get(1).amount, '13300000');
      assert.equal(chain.bal('ada.testnet'), 86_700_000n);
      assert.match(await page.locator('#whatsapp').getAttribute('href'), /^https:\/\/wa\.me\/\?text=/);
      assert.ok(await noSideScroll(page));
      await page.getByRole('button', { name: 'Pay another bill' }).click();
      await page.locator('#mine .job').first().waitFor();
      assert.match(await page.locator('#mine').textContent(), /Waiting for an agent/);
      await page.context().close();
    });

    await step('bad input is caught before anything is signed', async () => {
      const page = await open('ada.testnet', '/send');
      await page.locator('#meter').fill('12AB');
      await page.getByRole('button', { name: 'Lock USDC and send' }).click();
      await page.getByText('Enter the meter number: digits only.').waitFor();
      await page.locator('#meter').fill('9999999999');
      await page.locator('#meter-check[data-state="missing"]').waitFor();
      await page.getByRole('button', { name: 'Lock USDC and send' }).click();
      await page.getByText('That meter was not found. Check the number and the company.').waitFor();
      assert.equal(chain.nextId, 2, 'no request was created');
      await page.context().close();
    });

    let family;
    await step('the family link shows the bill waiting for an agent, with no wallet', async () => {
      family = await open(null, link.replace(/^https?:\/\/[^/]+/, ''));
      await family.getByRole('heading', { name: 'Electricity for your home' }).waitFor();
      assert.equal(await family.locator('#t-naira').textContent(), '₦20,000');
      assert.match(await family.locator('#t-sub').textContent(), /Waiting for a local agent/);
      assert.ok(await family.locator('#timeline [data-step="funded"]').evaluate((el) => el.classList.contains('done')));
      assert.ok(await noSideScroll(family));
      await shot(family, '3-family-waiting');
    });

    let agent;
    await step('an agent sets up, sees the request with its rate, and takes it', async () => {
      agent = await open('tunde.testnet', '/agent');
      await agent.getByRole('button', { name: 'Set up to receive USDC' }).click();
      await agent.waitForFunction(() => document.querySelector('#register').hidden);
      const job = agent.locator('#panel .job').first();
      await job.waitFor();
      assert.match(await job.textContent(), /₦20,000/);
      assert.match(await job.textContent(), /13\.30 USDC/);
      assert.match(await job.textContent(), /You earn\s*≈ ₦615/); // 13.30 USDC at ₦1,550 is ₦20,615
      assert.match(await job.textContent(), /Meter 111•+111/, 'the meter is masked until the job is taken');
      await shot(agent, '4-agent-desk');
      await job.getByRole('button', { name: 'Take this job' }).click();
      await agent.locator('dialog').getByRole('button', { name: 'Take this job' }).click();
      await agent.getByRole('tab', { name: /My jobs/ }).waitFor();
      await agent.waitForFunction(() => document.querySelector('#tab-mine').getAttribute('aria-selected') === 'true');
      assert.equal(chain.requests.get(1).status.state, 'claimed');
    });

    await step('the family sees that an agent is paying', async () => {
      await family.waitForFunction(() => /agent is paying/.test(document.querySelector('#t-sub').textContent), null, { timeout: 15000 });
    });

    await step('the agent pays the bill: verified, confirmed, and the USDC arrives', async () => {
      await agent.getByRole('button', { name: 'Pay the bill' }).click();
      await agent.getByRole('heading', { name: 'Paying the bill' }).waitFor();
      await agent.locator('#pay-done').waitFor();
      await shot(agent, '5-agent-paid');
      assert.equal(await agent.locator('#pay-earned').textContent(), '13.30 USDC');
      assert.equal(await agent.locator('#pay-profit').textContent(), '≈ ₦615');
      assert.match(await agent.locator('#pay-ref').textContent(), /^\d{12}SENDAM000001$/);
      assert.equal(chain.requests.get(1).status.state, 'fulfilled');
      assert.equal(chain.bal('tunde.testnet'), 13_300_000n);
      assert.equal(vtpass.payCalls, 1);
      await agent.getByRole('button', { name: 'Back to the desk' }).click();
      await agent.waitForFunction(() => document.querySelector('#done-count').textContent === '1');
      assert.ok(await noSideScroll(agent));
    });

    await step('paying again does not buy a second token', async () => {
      const out = await service.fulfil({ id: 1, agent: 'tunde.testnet' }, deps);
      assert.equal(out.already, true);
      assert.equal(vtpass.payCalls, 1);
    });

    await step('the family collects the electricity token', async () => {
      await family.locator('#token-card').waitFor({ timeout: 15000 });
      assert.equal(await family.locator('#token').textContent(), '4321 8765 2109 6543 0987');
      assert.equal(await family.locator('#units').textContent(), '64.5 kWh');
      await shot(family, '6-family-token');
      assert.ok(await family.locator('#timeline [data-step="paid"]').evaluate((el) => el.classList.contains('done')));
    });

    await step('a link without the secret shows progress but never the token', async () => {
      const stranger = await open(null, '/track?id=1');
      await stranger.waitForFunction(() => /Open the full link/.test(document.querySelector('#t-sub').textContent));
      assert.ok(await stranger.locator('#token-card').isHidden());
      const tampered = await open(null, '/track?id=1#not-the-right-secret-at-all');
      await tampered.locator('#t-note').waitFor({ state: 'visible' });
      assert.match(await tampered.locator('#t-note').textContent(), /not valid/);
      await tampered.waitForTimeout(6000);
      assert.equal(await tampered.locator('#t-note').textContent(), 'This link is not valid for that request. Ask the sender to send the link again.', 'a bad link is not retried');
      assert.ok(await tampered.locator('#token-card').isHidden());
      const missing = await open(null, '/track?id=99');
      await missing.getByRole('heading', { name: 'We could not find that request' }).waitFor();
    });

    await step('a sender can cancel an untaken request and get the USDC back', async () => {
      const page = await open('ada.testnet', '/send', { width: 1440, height: 900 });
      await page.locator('#meter').fill('1111111111111');
      await page.getByRole('button', { name: '₦5,000' }).click();
      await page.locator('#meter-check[data-state="found"]').waitFor();
      const [form, receipt] = await Promise.all([page.locator('.send-fields').boundingBox(), page.locator('.receipt').boundingBox()]);
      assert.ok(receipt.x > form.x + form.width, 'on desktop the summary sits beside the form');
      await shot(page, '7-send-desktop');
      assert.ok(await noSideScroll(page));
      await page.getByRole('button', { name: 'Lock USDC and send' }).click();
      await page.getByRole('heading', { name: 'Light is on its way.' }).waitFor();
      await page.locator('#t-qr svg').waitFor();
      await shot(page, '8-sent-desktop');
      const before = chain.bal('ada.testnet');
      await page.getByRole('button', { name: 'Pay another bill' }).click();
      const card = page.locator('#mine .job[data-id="2"]');
      await card.getByRole('button', { name: 'Cancel and refund' }).click();
      await page.locator('dialog').getByRole('button', { name: 'Cancel and refund' }).click();
      await page.getByText('Refunded', { exact: true }).first().waitFor();
      assert.equal(chain.requests.get(2).status.state, 'refunded');
      assert.equal(chain.bal('ada.testnet'), before + BigInt(chain.requests.get(2).amount));
      await page.context().close();
    });

    await step('every page passes an accessibility check', async () => {
      const axe = require.resolve('axe-core/axe.min.js');
      for (const [acc, path] of [[null, '/'], ['ada.testnet', '/send'], ['tunde.testnet', '/agent'], [null, link.replace(/^https?:\/\/[^/]+/, '')], [null, '/track?id=99']]) {
        const page = await open(acc, path);
        await page.waitForTimeout(600);
        await page.addScriptTag({ path: axe });
        const v = await page.evaluate(async () => (await window.axe.run()).violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).join(' | ')}`));
        assert.deepEqual(v, [], path);
        await page.context().close();
      }
    });

    await step('no page logged an error', async () => {
      assert.deepEqual(errors, []);
    });
    console.log(`\n${passed} browser checks passed`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
