// A stand-in for the VTpass sandbox, used when VTPASS_MODE=simulate. It answers in VTpass's
// own response shapes, so everything downstream (the verifier's checks, the contract call,
// the family's token) runs exactly as it does against the real sandbox.
//
// It keeps no state, so it works on serverless hosting: a purchase is "found" by its request
// id, and its token is derived from that id. It cannot check amounts, so it reports none and
// the verifier's amount and meter checks are skipped. Never use it for real money.
import { createHash } from 'node:crypto';

const TEST_METER = '1111111111111';
const tokenFor = (requestId) => {
  const digits = BigInt('0x' + createHash('sha256').update(`sendam-sim:${requestId}`).digest('hex')).toString().slice(0, 20);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
};
const delivered = (requestId, extra = {}) => ({
  code: '000',
  response_description: 'TRANSACTION SUCCESSFUL (simulated)',
  purchased_code: `Token : ${tokenFor(requestId)}`,
  units: '64.5 kWh',
  content: { transactions: { status: 'delivered', transactionId: `SIM${requestId.slice(-6)}`, ...extra } },
});

export function createSimulatedVtpass() {
  return {
    simulated: true,
    async verifyMeter({ meter }) {
      return meter === TEST_METER
        ? { code: '000', content: { Customer_Name: 'TESTMETER1', Address: 'Simulated sandbox meter', WrongBillersCode: false } }
        : { code: '000', content: { error: 'Meter not found', WrongBillersCode: true } };
    },
    async pay({ requestId, meter, naira }) {
      if (meter !== TEST_METER) return { code: '016', response_description: 'TRANSACTION FAILED (simulated: use meter 1111111111111)', content: { transactions: { status: 'failed' } } };
      return delivered(requestId, { unique_element: meter, amount: naira });
    },
    // Every well-formed Sendam request id counts as a completed purchase.
    async requery(requestId) {
      return /^\d{12}SENDAM\d{6}$/.test(requestId) ? delivered(requestId) : { code: '015', response_description: 'INVALID REQUEST ID', content: {} };
    },
  };
}
