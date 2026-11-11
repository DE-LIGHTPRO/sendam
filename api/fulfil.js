import { endpoint } from '../lib/http.js';
import { fulfil } from '../lib/service.js';
import { fromEnv } from '../lib/env.js';

export default endpoint(fulfil, () => fromEnv());
