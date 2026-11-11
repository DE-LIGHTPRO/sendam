// Bundled into vendor/wallet.js by `npm run vendor`. Connects NEAR wallets.
import './polyfills.js';
import { setupWalletSelector } from '@near-wallet-selector/core';
import { setupModal } from '@near-wallet-selector/modal-ui';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import { setupMeteorWallet } from '@near-wallet-selector/meteor-wallet';
import { setupIntearWallet } from '@near-wallet-selector/intear-wallet';
import { actionCreators } from '@near-js/transactions';

export async function createWallet({ network, contractId }) {
  const selector = await setupWalletSelector({
    network,
    modules: [setupMyNearWallet(), setupMeteorWallet(), setupIntearWallet()],
  });
  const modal = setupModal(selector, { contractId, description: 'Connect a NEAR wallet to use Sendam.' });
  const listeners = new Set();
  selector.store.observable.subscribe(() => listeners.forEach((fn) => fn(accountId())));
  function accountId() {
    const accounts = selector.store.getState().accounts;
    return accounts.find((a) => a.active)?.accountId || accounts[0]?.accountId || null;
  }
  return {
    accountId,
    onChange(fn) { listeners.add(fn); },
    signIn() { modal.show(); },
    async signOut() {
      const wallet = await selector.wallet();
      await wallet.signOut();
    },
    /** Calls a contract method. Returns the outcome, or undefined when the wallet redirects away. */
    async call({ receiverId, methodName, args, tgas = 30, depositYocto = '0' }) {
      const wallet = await selector.wallet();
      return wallet.signAndSendTransaction({
        receiverId,
        actions: [actionCreators.functionCall(methodName, args, BigInt(tgas) * 10n ** 12n, BigInt(depositYocto))],
      });
    },
  };
}
