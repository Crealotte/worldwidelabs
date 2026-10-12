// lib/env.js — the test site. A Vercel "preview" deployment (the dev branch) runs this same code, but it must NEVER touch the real WWL data. So a preview stays closed until it has been given its own
// test database: it only opens when the environment variable WWL_TEST_DB=1 is set for the Preview environment (which is the owner's confirmation that the Preview variables point at the test
// database, see userscripts/../README-DEV in the notes of the dev site). The site itself asks 'env-info' (no key, no database) to know whether to show the orange TEST banner.

const isPreview = () => process.env.VERCEL_ENV === 'preview';
const dbReady = () => process.env.WWL_TEST_DB === '1';

function envInfo() { return { env: process.env.VERCEL_ENV || 'local', test: isPreview(), dbReady: !isPreview() || dbReady(), branch: process.env.VERCEL_GIT_COMMIT_REF || '' }; }

// true (and the answer is sent) when this request must not go on: a preview without a test database. What stays possible: env-info, script-version and downloading the userscript.
function blockUntilTestDb(req, res) {
    if (!isPreview() || dbReady()) return false;
    const action = (req.body && req.body.action) || (req.query && req.query.action) || '';
    if (action === 'env-info' || action === 'script-version' || (req.method === 'GET' && req.query && req.query.script)) return false;
    res.status(503).json({ error: 'TEST SITE: it is not connected to a test database yet, so it stays closed (it would otherwise use the real data). Set up the test database and WWL_TEST_DB=1 for the Preview environment in Vercel.' });
    return true;
}
module.exports = { envInfo, blockUntilTestDb, isPreview };
