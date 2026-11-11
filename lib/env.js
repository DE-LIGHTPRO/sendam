// Builds the verifier's connections from environment variables. Secrets live only in
// the hosting provider's environment settings (or a local .env file), never in git.
import { createNear } from './near.js';
import { createVtpass } from './vtpass.js';
import { createSimulatedVtpass } from './vtpass-sim.js';

export function fromEnv(env = process.env) {
  return {
    near: createNear({
      network: env.NEAR_NETWORK || 'testnet',
      contractId: env.SENDAM_CONTRACT,
      verifierId: env.VERIFIER_ACCOUNT,
      verifierKey: env.VERIFIER_PRIVATE_KEY,
      rpcUrl: env.NEAR_RPC_URL,
    }),
    vtpass: vtpassFromEnv(env),
  };
}

/** Just the bill provider, for endpoints that never touch NEAR (the meter lookup). */
export function vtpassFromEnv(env = process.env) {
  // VTPASS_MODE=simulate swaps in a stand-in with VTpass's response shapes (lib/vtpass-sim.js).
  if (env.VTPASS_MODE === 'simulate') return createSimulatedVtpass();
  return createVtpass({
    baseUrl: env.VTPASS_BASE_URL || 'https://sandbox.vtpass.com',
    apiKey: env.VTPASS_API_KEY,
    secretKey: env.VTPASS_SECRET_KEY,
    phone: env.VTPASS_PHONE || '08011111111',
  });
}
