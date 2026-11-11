import { endpoint } from '../lib/http.js';
import { checkMeter } from '../lib/service.js';
import { vtpassFromEnv } from '../lib/env.js';

export default endpoint(checkMeter, () => ({ vtpass: vtpassFromEnv() }));
