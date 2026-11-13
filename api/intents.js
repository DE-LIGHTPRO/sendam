import { endpoint } from '../lib/http.js';
import { createIntents } from '../lib/intents.js';

// One client per server start, so the token list is fetched once.
let client;
const intents = () => (client ||= createIntents({ baseUrl: process.env.INTENTS_API_URL || undefined, apiKey: process.env.INTENTS_API_KEY || undefined }));

// The page warms three chains per amount, so this endpoint gets a higher allowance.
export default endpoint((body) => intents().quote(body), {}, { perMinute: 90 });
