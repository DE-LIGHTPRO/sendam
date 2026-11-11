// Which NEAR network and contracts this site talks to. `npm run deploy` fills these in.
export const NETWORK = 'testnet';
export const CONTRACT = "sendam.sendam-delight.testnet";
export const USDC = "usdc.sendam-delight.testnet";
export const USDC_DECIMALS = 6;

export const RPC_URLS = {
  testnet: ['https://test.rpc.fastnear.com', 'https://rpc.testnet.near.org'],
  mainnet: ['https://free.rpc.fastnear.com', 'https://rpc.mainnet.near.org'],
}[NETWORK];
export const EXPLORER = NETWORK === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io';

/** The demo's market rate, in naira per USDC: the sender's starting offer, and what agents'
    earnings are estimated against. A real launch would read a live rate. */
export const SUGGESTED_RATE = 1550;
/** Starting point for the tip a sender adds on top, as a percentage. */
export const SUGGESTED_TIP = 3;

/** VTpass electricity service ids and their names. */
export const PROVIDERS = [
  ['ikeja-electric', 'Ikeja Electric (IKEDC)'],
  ['eko-electric', 'Eko Electric (EKEDC)'],
  ['ibadan-electric', 'Ibadan Electric (IBEDC)'],
  ['abuja-electric', 'Abuja Electric (AEDC)'],
  ['kano-electric', 'Kano Electric (KEDCO)'],
  ['portharcourt-electric', 'Port Harcourt Electric (PHED)'],
  ['jos-electric', 'Jos Electric (JED)'],
  ['kaduna-electric', 'Kaduna Electric (KAEDCO)'],
  ['enugu-electric', 'Enugu Electric (EEDC)'],
  ['benin-electric', 'Benin Electric (BEDC)'],
  ['aba-electric', 'Aba Power (APLE)'],
  ['yola-electric', 'Yola Electric (YEDC)'],
];
