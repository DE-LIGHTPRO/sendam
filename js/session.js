// The connected NEAR wallet. The wallet code is large, so it loads only on pages that need it.
import { NETWORK, CONTRACT } from './config.js';
import { $, escapeHtml, icon, toast, confirmDialog } from './ui.js';

let walletPromise;

export function wallet() {
  // Browser tests put a stand-in wallet here, so flows can be checked without a real wallet.
  if (window.__SENDAM_TEST_WALLET) return Promise.resolve(window.__SENDAM_TEST_WALLET);
  walletPromise ||= import('../vendor/wallet.js').then(({ createWallet }) => createWallet({ network: NETWORK, contractId: CONTRACT }));
  return walletPromise;
}

/** Shows the account (or a Connect button) in the app bar, and reports changes. */
export async function mountAccount(onChange) {
  const slot = $('#account');
  const w = await wallet();
  const draw = (id) => {
    slot.innerHTML = id
      ? `<button class="wallet-chip chip" type="button" id="sign-out" title="Disconnect ${escapeHtml(id)}">${icon('wallet')}<b>${escapeHtml(id)}</b></button>`
      : `<button class="btn sm" type="button" id="sign-in">${icon('wallet')}Connect wallet</button>`;
    $('#sign-in', slot)?.addEventListener('click', () => w.signIn());
    $('#sign-out', slot)?.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Disconnect your wallet?', body: `You are connected as ${id}.`, confirm: 'Disconnect' }))) return;
      await w.signOut();
      toast('Disconnected');
    });
    onChange?.(id);
  };
  w.onChange(draw);
  draw(w.accountId());
  return w;
}

/** Turns a wallet or contract error into one sentence a person can act on. */
export function explain(err) {
  const text = String(err?.message || err || '');
  const known = text.match(/(Smart contract panicked|ExecutionError)[^:]*:\s*(.+?)(["\\]|$)/);
  if (known) return known[2];
  if (/User (rejected|cancelled|closed)|rejected the request|cancelled/i.test(text)) return 'You cancelled in your wallet. Nothing was sent.';
  if (/not enough balance|NotEnoughBalance/i.test(text)) return 'This account does not have enough NEAR to pay the network fee.';
  return text.slice(0, 200) || 'Something went wrong. Try again.';
}
