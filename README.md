# Sendam

**Send light home.** Someone abroad pays for their family's electricity in Nigeria. They lock USDC in a NEAR contract; a local agent pays the electricity company in naira; the contract pays the agent only after the payment is verified with the bill provider. If nobody pays by the deadline, the sender gets the USDC back.

It is an *intent that settles in the real world*: like NEAR Intents, the sender says what they want and competing solvers deliver it, except the solvers are Nigerian agents and the delivery is a prepaid electricity token.

Built for the NEAR Hackathon 2026, **Real-World Money** track. Runs on **NEAR testnet with test USDC**; no real money moves.

- Live demo: _add your Vercel address here_
- Demo video: _add your X post here_
- Contracts on NEAR testnet: [`sendam.sendam-delight.testnet`](https://testnet.nearblocks.io/address/sendam.sendam-delight.testnet) (Sendam) and [`usdc.sendam-delight.testnet`](https://testnet.nearblocks.io/address/usdc.sendam-delight.testnet) (test USDC)

## Try it (about five minutes)

You need a NEAR testnet wallet: Meteor Wallet works well (MyNearWallet no longer creates new accounts). Use two testnet accounts, one as the sender and one as the agent; Meteor can hold both.

1. **As a sender**, open `/send` and connect your wallet. Tap **Get 100 test USDC**; the balance shows 100.00 USDC.
2. Enter meter **1111111111111** (the bill provider's sandbox test meter). The meter is looked up as you type and the customer's name appears (*TESTMETER1*); an unknown meter is refused before anything is signed. Tap **₦20,000**: the summary shows what your family gets and what you pay in USDC (the rate, tip and refund time are under *Adjust*). Tap **Lock USDC and send** and approve. You get a link for your family.
3. **As the family**, open that link (no wallet needed). It shows *Waiting for a local agent*.
4. **As an agent**, open `/agent` in another browser with a different wallet. Tap **Set up to receive USDC** if asked. The request appears under **Open requests** with the naira you pay, the USDC you get and what you earn in naira at the demo's market rate (₦1,550 per USDC). Tap **Take this job**.
5. Under **My jobs**, tap **Pay the bill**. The verifier buys the token from the bill provider (the VTpass sandbox, or the simulated provider described below), checks the meter and amount, and calls `confirm` on the contract. The USDC arrives in the agent's wallet.
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

**NEAR features used:** a Rust contract (near-sdk 5), NEP-141 fungible tokens with `ft_transfer_call`, cross-contract calls with callbacks, NEP-297 events, NEAR Wallet Selector, and testnet RPC from the browser, plus a live dry-run quote from the NEAR Intents 1Click API.

## What is real, and what is not yet

- **Real:** the contract and its rules; wallet signing; the verifier's checks; buying and looking up tokens through the VTpass **sandbox** (test meters, test tokens).
- **Test money:** testnet and a test USDC token anyone can mint with `faucet`. The next step is real USDC on NEAR mainnet, funded from any chain through NEAR Intents.
- **NEAR Intents, a live quote only:** the send page's *From another chain* panel calls the real NEAR Intents 1Click API (`lib/intents.js`, `/api/intents`) for what it costs to deliver the request's USDC on NEAR from USDC on Base, Arbitrum or Ethereum. Intents has no testnet, so this is a **mainnet quote requested as a dry run**: nothing is charged and no deposit address is created. Sendam does not yet execute an Intents swap; the escrow in this demo is funded with test USDC. `npm run intents:check` prints the API's raw answers.
- **One verifier, one demo agent account:** in this demo a single service both holds the demo agent's VTpass sandbox key and verifies payments, so any agent who claims is effectively using that account. In production each agent's own bill-provider key would be sealed in a secure enclave (TEE), and the verifier would be attested code.
- **Electricity only:** airtime, data and school fees fit the same pattern.
- **Not a licensed service:** a real launch needs licensed partners to move money into and out of Nigeria.

The VTpass client was written from VTpass's published API documentation. **Simulated bill provider:** with `VTPASS_MODE=simulate` the verifier uses `lib/vtpass-sim.js` instead of VTpass. It answers in VTpass's response shapes (test meter `1111111111111`, a test token derived from the purchase id), so the contract, the verifier's checks and the family link all run unchanged; it cannot check amounts. The hosted demo uses it while the author's VTpass sandbox keys await activation, and switches back to the real sandbox by removing that one setting.

## The interface

- **Every screen tells the same story:** a prepaid meter's green screen shows the state (the meter being checked, an agent paying, the token typing itself in), and the sender gets a ticket with a QR code of the family's link and a tracker that follows the chain live.
- **The background** (`js/backdrop.js`) is a custom WebGL shader of liquid light with rays from a light source, over a real fluid simulation (advection, vorticity, pressure) that the cursor stirs. The light flickers on when a page opens. It renders below screen resolution, lowers its quality if frames run slow, pauses in hidden tabs, draws a still frame for reduced motion, and falls back to plain CSS without WebGL.
- **Public record:** the landing page's *Live* section reads totals and the latest requests straight from the contract, and the ticket and the family page link to the NEAR explorer, so every claim on the site can be checked.
- **Saved recipients:** a meter the sender has paid is remembered in their own browser and filled in with one tap next time (and still checked live). Nothing about it is sent to a server.
- **The family's page in three languages:** English, Yorùbá and Nigerian Pidgin, chosen with a switch and remembered on the device. Every sentence is in `js/track-i18n.js`. The Yorùbá and Pidgin were drafted with AI assistance and are to be proofread by a native speaker before a real launch.
- Accessibility is checked with axe on every page; motion respects `prefers-reduced-motion`.
- The pages load no third-party scripts, styles or fonts; a Content-Security-Policy enforces it. The `/api` endpoints are rate-limited per visitor.

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

14 tests of the verifier and services: Lagos-time request ids, reading VTpass answers, paying once and never twice, pending and failed payments, meter and amount mismatches, the meter lookup, the token only for the right secret, the simulated bill provider, the NEAR Intents quote (dry run, fallbacks, failures), and the per-visitor rate limit.

```bash
npm run test:e2e
```

14 checks in a real browser (needs Playwright): the whole flow from sender to agent to family, the meter lookup, the desktop layout, bad input and an unknown meter, a wrong or missing link, a refund, accessibility (axe) on every page, and no console errors. NEAR and VTpass are simulated here, but the `/api` endpoints run the real verifier code.

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
near account create-account sponsor-by-faucet-service your-name.testnet autogenerate-new-keypair --signature-scheme ed25519 save-to-legacy-keychain network-config testnet create
```

3. Deploy the contracts and write the settings:

```bash
npm run deploy -- your-name.testnet
```

It creates `usdc.`, `sendam.` and `verifier.` sub-accounts, deploys both contracts, updates `js/config.js` and writes `.env`. It needs about 8 NEAR; if you run short, top up from the testnet faucet.

4. Create a free account at sandbox.vtpass.com and put its API key and secret key in `.env`. Until the keys are active (new keys can return "Invalid Credentials"), set `VTPASS_MODE=simulate` to use the simulated bill provider.
5. On Vercel, import the repository (framework preset "Other"), add every variable from `.env` under Settings > Environment Variables, and deploy. Never commit `.env` or paste the verifier key anywhere public.

## Layout

- `contracts/sendam`: the Sendam contract and its tests
- `contracts/mock-usdc`: the test USDC token
- `lib/`: the verifier (VTpass client, NEAR client, the fulfil and token logic)
- `api/`: the HTTP endpoints (`fulfil`, `token`, `meter`, `intents`), as Vercel functions
- `index.html`, `send.html`, `agent.html`, `track.html`, `js/`, `css/`: the site
- `src/wallet-entry.js`: the wallet connector, bundled into `vendor/wallet.js` by `npm run vendor`
- `scripts/`: local server and deployment
- `test/`, `test-e2e/`: tests

## Disclosure

All code here was written during the hackathon window, from 11 November 2026. The icons and parts of the front-end helpers (`js/ui.js`) were adapted from FastLane, an earlier project by the same author written on 10–11 November 2026, after the hackathon was announced.

Built with AI assistance (Claude Code). Libraries: near-sdk and near-contract-standards (Rust), near-api-js, @near-wallet-selector (core, modal-ui, my-near-wallet, meteor-wallet, intear-wallet), @near-js/transactions, qrcode-generator (the QR code on the ticket), buffer, util and events (browser polyfills), esbuild, Playwright and axe-core (tests), and the Geist and Geist Mono fonts (OFL 1.1).

## Licence

MIT. See `LICENSE`.
