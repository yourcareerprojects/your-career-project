const path = require('path');
const dotenv = require('dotenv');

const LOCAL_ENV_PATH = path.resolve(__dirname, '..', '.env');

/**
 * Load `.env` when present (local development). Does not override variables
 * already set on the process (e.g. production host env).
 */
function loadEnv() {
  dotenv.config({ path: LOCAL_ENV_PATH });
}

module.exports = { loadEnv, LOCAL_ENV_PATH };
