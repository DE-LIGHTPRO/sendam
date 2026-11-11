import { view, stateOf } from './chain.js';
import { $ } from './ui.js';

// Live numbers from the contract. If NEAR cannot be reached, the dashes stay.
(async () => {
  try {
    const all = await view('list_requests', { limit: 100 });
    $('#s-total').textContent = String(all.length);
    $('#s-paid').textContent = String(all.filter((r) => stateOf(r) === 'paid').length);
    $('#s-open').textContent = String(all.filter((r) => stateOf(r) === 'open').length);
  } catch { /* keep the dashes */ }
})();
