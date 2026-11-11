// Talks to the Sendam contract: read-only views, and `confirm`, signed by the verifier.
import { Account, JsonRpcProvider, teraToGas } from 'near-api-js';

export const RPC = {
  testnet: ['https://test.rpc.fastnear.com', 'https://rpc.testnet.near.org'],
  mainnet: ['https://free.rpc.fastnear.com', 'https://rpc.mainnet.near.org'],
};

export function createNear({ network = 'testnet', contractId, verifierId, verifierKey, rpcUrl }) {
  if (!contractId) throw new Error('SENDAM_CONTRACT is not set');
  const provider = new JsonRpcProvider({ url: rpcUrl || RPC[network][0] });
  return {
    view: (method, args = {}) => provider.callFunction({ contractId, method, args }),
    async confirm(id, agent, reference) {
      if (!verifierId || !verifierKey) throw new Error('VERIFIER_ACCOUNT and VERIFIER_PRIVATE_KEY are not set');
      const account = new Account(verifierId, provider, verifierKey);
      const outcome = await account.callFunction({
        contractId,
        methodName: 'confirm',
        args: { id, agent, reference },
        gas: teraToGas('80'),
        waitUntil: 'EXECUTED_OPTIMISTIC',
      });
      return outcome;
    },
  };
}
