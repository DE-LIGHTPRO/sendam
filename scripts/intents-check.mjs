// Prints what the NEAR Intents 1Click API really answers, so the client in lib/intents.js can
// be checked against it. Nothing is charged: quotes are dry runs.
//   npm run intents:check
import { createIntents } from '../lib/intents.js';

const intents = createIntents({ baseUrl: process.env.INTENTS_API_URL || undefined, apiKey: process.env.INTENTS_API_KEY || undefined });
try {
  const raw = await intents.probe('base', 13.3);
  console.log('Tokens listed:', raw.tokenCount);
  console.log('USDC entries found:', raw.usdcTokens.map((t) => t.blockchain).join(', '));
  console.log('Asset ids used:', raw.ids);
  console.log('Placeholder addresses the API accepted (or last tried):', raw.addresses);
  console.log('Raw quote answer (HTTP ' + raw.quote.status + '):', JSON.stringify(raw.quote.body, null, 1).slice(0, 1800));
  console.log('\nParsed quote, as the site will show it:');
  console.log(await intents.quote({ usdc: 13.3, from: 'base' }));
} catch (err) {
  console.error('\nCould not get a quote:', err.message);
  process.exitCode = 1;
}
