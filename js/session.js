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

/** Opens the wallet chooser. Safe to call before the wallet code has finished loading. */
export async function connect() {
  try {
    (await wallet()).signIn();
  } catch (err) {
    console.error(err);
    toast('The wallet could not load. Refresh the page and try again.', 'warn');
  }
}

/** Shows the account (or a Connect button) in the app bar, and reports changes. */
export async function mountAccount(onChange) {
  const slot = $('#account');
  let w;
  try {
    w = await wallet();
  } catch (err) {
    console.error(err);
    slot.innerHTML = '';
    toast('The wallet could not load. Refresh the page and try again.', 'warn');
    return { signIn: connect, accountId: () => null, onChange() {} };
  }
  const draw = (id) => {
    slot.innerHTML = id
      ? `<button class="wallet-chip chip" type="button" id="sign-out" title="Disconnect ${escapeHtml(id)}">${icon('wallet')}<b>${escapeHtml(id)}</b></button>`
      : `<button class="btn sm" type="button" id="sign-in">${icon('wallet')}Connect wallet</button>`;
    $('#sign-in', slot)?.addEventListener('click', connect);
    $('#sign-out', slot)?.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Disconnect your wallet?', body: `You are connected as ${id}.`, confirm: 'Disconnect' }))) return;
      await w.signOut();
      toast('Disconnected');
    });
    onChange?.(id);
  };
  w.onChange(draw);
  draw(w.accountId());
  // Wallets approve in their own window, which can open behind this one. Say where to look.
  const rawCall = w.call.bind(w);
  w.call = (tx) => {
    toast('Approve it in your wallet window. If you do not see one, check for a blocked pop-up.');
    return rawCall(tx);
  };
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
