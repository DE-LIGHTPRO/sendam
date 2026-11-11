import { endpoint } from '../lib/http.js';
import { collectToken } from '../lib/service.js';
import { fromEnv } from '../lib/env.js';

export default endpoint(collectToken, () => fromEnv());
