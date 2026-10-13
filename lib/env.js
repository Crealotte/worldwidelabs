// lib/env.js — the test site. A Vercel "preview" deployment (the dev branch) runs this same code, but it must NEVER touch the real WWL data. So a preview stays closed until it has been given its own
// test database: it only opens when the TEST_KV_ variables (the test database) exist. The site itself asks 'env-info' (no key, no database) to know whether to show the orange TEST banner.

const isPreview = () => process.env.VERCEL_ENV === 'preview';
// The database this deployment may use. The real site: the normal variables. A preview (the dev site) NEVER reads those: only the test database variables TEST_KV_REST_API_URL / TEST_KV_REST_API_TOKEN
// (the Vercel database connection with the prefix TEST, connected to Preview only). Without them a preview has no database at all and stays closed.
const redisUrl = () => isPreview() ? (process.env.TEST_KV_REST_API_URL || process.env.TEST_REST_API_URL) : (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL);
const redisToken = () => isPreview() ? (process.env.TEST_KV_REST_API_TOKEN || process.env.TEST_REST_API_TOKEN) : (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN);
const dbReady = () => !!(redisUrl() && redisToken());

function envInfo() { return { env: process.env.VERCEL_ENV || 'local', test: isPreview(), dbReady: !isPreview() || dbReady(), branch: process.env.VERCEL_GIT_COMMIT_REF || '' }; }

// true (and the answer is sent) when this request must not go on: a preview without a test database. What stays possible: env-info, script-version and downloading the userscript.
function blockUntilTestDb(req, res) {
    if (!isPreview() || dbReady()) return false;
    const action = (req.body && req.body.action) || (req.query && req.query.action) || '';
    if (action === 'env-info' || action === 'script-version' || (req.method === 'GET' && req.query && req.query.script)) return false;
    res.status(503).json({ error: 'TEST SITE: it is not connected to a test database yet, so it stays closed (it would otherwise use the real data). Connect the test database (prefix TEST) to the Preview environment in Vercel.' });
    return true;
}
module.exports = { envInfo, blockUntilTestDb, isPreview, redisUrl, redisToken };
