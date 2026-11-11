# Sendam

**Send light home.** Someone abroad pays for their family's electricity in Nigeria. They lock USDC in a NEAR contract; a local agent pays the electricity company in naira; the contract pays the agent only after the payment is verified with the bill provider. If nobody pays by the deadline, the sender gets the USDC back.

It is an *intent that settles in the real world*: like NEAR Intents, the sender says what they want and competing solvers deliver it, except the solvers are Nigerian agents and the delivery is a prepaid electricity token.

Built for the NEAR Hackathon 2026, **Real-World Money** track. Runs on **NEAR testnet with test USDC**; no real money moves.

- Live demo: _add your Vercel address here_
- Demo video: _add your X post here_

## Try it (about five minutes)

You need a NEAR testnet wallet (for example MyNearWallet or Meteor). Two browser windows help: one as the sender, one as the agent.

1. **As a sender**, open `/send` and connect your wallet. Tap **Get 100 test USDC**; the balance shows 100.00 USDC.
2. Enter meter **1111111111111** (the bill provider's sandbox test meter) and tap **₦20,000**. The quote shows what you lock at your rate plus a tip. Tap **Lock USDC and send** and approve. You get a link for your family.
3. **As the family**, open that link (no wallet needed). It shows *Waiting for a local agent*.
4. **As an agent**, open `/agent` in another browser with a different wallet. Tap **Set up to receive USDC** if asked. The request appears under **Open requests** with the USDC offered and the naira-per-USDC rate it works out to. Tap **Take this job**.
5. Under **My jobs**, tap **Pay the bill**. The verifier buys the token from the VTpass sandbox, checks the meter and amount, and calls `confirm` on the contract. The USDC arrives in the agent's wallet.
6. Back on the family link: the timeline completes and the **electricity token** appears, ready to type into the meter.

To see a refund, send a second request and tap **Cancel and refund** under *Your requests* before an agent takes it.

## How it works

```
 Sender (abroad)            NEAR testnet                         Agent (Nigeria)
 ──────────────             ────────────                         ───────────────
 ft_transfer_call ──USDC──▶ sendam contract ◀── claim ─────────── takes the job
   msg: meter, ₦, expiry,     request: Open → Claimed
   sha256(family secret)                                          "Pay the bill"
                                                                       │
                            verifier (/api/fulfil) ◀───────────────────┘
                              1. VTpass: requery, else pay (fixed request id)
                              2. check: delivered, same meter, same naira
                              3. confirm(id, agent, ref) ──▶ contract pays agent

 Family opens link ──▶ /api/token: proves the secret matches the on-chain hash
                       ──▶ VTpass requery ──▶ electricity token shown
```

**What the contract guarantees** (`contracts/sendam`):

- Money only goes to the agent named in a confirmed claim, or back to the sender.
- A claim reserves a request for 30 minutes, so two agents never pay the same bill.
- Only the configured verifier can confirm, and only for the agent holding the claim.
- If the payout transfer fails, the request returns to its previous state, so funds are never stranded.
- After the deadline, anyone can trigger the refund, and it can only go to the sender.
- The electricity token is never on chain. Only the SHA-256 of a secret in the family's link is stored; the token is fetched by proving that secret.

**Contract interface:** `ft_on_transfer` (create a request from USDC sent with `ft_transfer_call`), `claim`, `release`, `confirm` (verifier only), `refund`, `set_verifier` (owner only); views `get_request`, `list_requests`, `list_open`, `list_by_account`, `get_config`. Every change logs a NEP-297 event under the `sendam` standard.

**NEAR features used:** a Rust contract (near-sdk 5), NEP-141 fungible tokens with `ft_transfer_call`, cross-contract calls with callbacks, NEP-297 events, NEAR Wallet Selector, and testnet RPC from the browser.

## What is real, and what is not yet

- **Real:** the contract and its rules; wallet signing; the verifier's checks; buying and looking up tokens through the VTpass **sandbox** (test meters, test tokens).
- **Test money:** testnet and a test USDC token anyone can mint with `faucet`. The next step is real USDC on NEAR mainnet, funded from any chain through NEAR Intents (Intents has no testnet).
- **One verifier, one demo agent account:** in this demo a single service both holds the demo agent's VTpass sandbox key and verifies payments, so any agent who claims is effectively using that account. In production each agent's own bill-provider key would be sealed in a secure enclave (TEE), and the verifier would be attested code.
- **Electricity only:** airtime, data and school fees fit the same pattern.
- **Not a licensed service:** a real launch needs licensed partners to move money into and out of Nigeria.

The VTpass client was written from VTpass's published API documentation; its first live run is against your own sandbox account (see below).

## Run the tests

```bash
npm install
```

```bash
npm run test:contracts
```

25 Rust unit tests: request creation and validation, claims and lapsed claims, confirmation, double-payment refusal, refunds, failed-payout recovery, listings and the test token's faucet.

```bash
npm test
```

10 tests of the verifier: Lagos-time request ids, reading VTpass answers, paying once and never twice, pending and failed payments, meter and amount mismatches, and the token only for the right secret.

```bash
npm run test:e2e
```

13 checks in a real browser (needs Playwright): the whole flow from sender to agent to family, bad input, a wrong or missing link, a refund, accessibility (axe) on every page, and no console errors. NEAR and VTpass are simulated here, but the `/api` endpoints run the real verifier code.

## Run it locally

```bash
npm install
```

```bash
npm run serve
```

Open http://localhost:4300. The site reads the contract names from `js/config.js`; the verifier reads its settings from `.env` (copy `.env.example`).

## Deploy it yourself

1. Install Rust, then NEAR's tools:

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh | sh
```

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.sh | sh
```

2. Create a funded testnet account (the faucet pays for it):

```bash
near account create-account sponsor-by-faucet-service your-name.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
```

3. Deploy the contracts and write the settings:

```bash
npm run deploy -- your-name.testnet
```

It creates `usdc.`, `sendam.` and `verifier.` sub-accounts, deploys both contracts, updates `js/config.js` and writes `.env`. It needs about 8 NEAR; if you run short, top up from the testnet faucet.

4. Create a free account at sandbox.vtpass.com and put its API key and secret key in `.env`.
5. On Vercel, import the repository (framework preset "Other"), add every variable from `.env` under Settings > Environment Variables, and deploy. Never commit `.env` or paste the verifier key anywhere public.

## Layout

- `contracts/sendam`: the Sendam contract and its tests
- `contracts/mock-usdc`: the test USDC token
- `lib/`: the verifier (VTpass client, NEAR client, the fulfil and token logic)
- `api/`: the two HTTP endpoints, as Vercel functions
- `index.html`, `send.html`, `agent.html`, `track.html`, `js/`, `css/`: the site
- `src/wallet-entry.js`: the wallet connector, bundled into `vendor/wallet.js` by `npm run vendor`
- `scripts/`: local server and deployment
- `test/`, `test-e2e/`: tests

## Disclosure

All code here was written during the hackathon window, from 11 November 2026. The design system (`css/app.css`) and icons were adapted from FastLane, an earlier project by the same author written on 10–11 November 2026, after the hackathon was announced.

Built with AI assistance (Claude Code). Libraries: near-sdk and near-contract-standards (Rust), near-api-js, @near-wallet-selector (core, modal-ui, my-near-wallet, meteor-wallet, intear-wallet), @near-js/transactions, buffer, util and events (browser polyfills), esbuild, Playwright and axe-core (tests), and the Inter and Bricolage Grotesque fonts (OFL 1.1).

## Licence

MIT. See `LICENSE`.
