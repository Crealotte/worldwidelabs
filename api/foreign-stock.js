// api/foreign-stock.js — WorldWideLabs Overseas Stock dashboard.
// Stock data itself isn't something Torn's own API exposes at all — every tool in this space
// (YATA, TornPDA, TornTools, Torn Intel, etc.) relies on the same crowd-sourced mechanism:
// browser extensions scrape the in-game Travel Agency page when someone actually lands abroad,
// and report it to a shared database. YATA's is the central, most established one, and it
// publishes a fully public, no-key-needed read endpoint — so that's what this reuses, rather
// than trying to duplicate years of community data-collection ourselves.
//
// Honesty note baked into the design: since this is fundamentally "last known sighting" data,
// we surface exactly how old each country's data is (the freshness timestamp) instead of
// pretending it's always live — a quiet country's stale numbers look identical to a fresh one
// otherwise, which is the actual root cause of the "these tools are often wrong" complaint.
//
// POST { key, action: 'read' } -> per-country stock lists with computed profit, and freshness

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const ITEMS_CACHE_KEY = 'wwl:torn-items-cache';
const ITEMS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // item market values don't need refreshing often

const COUNTRY_NAMES = {
    mex: 'Mexico', cay: 'Cayman Islands', can: 'Canada', haw: 'Hawaii',
    uni: 'United Kingdom', arg: 'Argentina', swi: 'Switzerland', jap: 'Japan',
    chi: 'China', uae: 'UAE', sou: 'South Africa',
};

async function redis(command) {
    const res = await fetch(REDIS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.result;
}

// Torn's own item directory (names + market values) — cached since this barely changes day to day.
async function getItemDirectory(key) {
    try {
        const raw = await redis(['GET', ITEMS_CACHE_KEY]);
        const cached = raw ? JSON.parse(raw) : null;
        if (cached && Date.now() - cached.fetchedAt < ITEMS_CACHE_TTL_MS) return cached.items;

        const res = await fetch(`https://api.torn.com/torn/?selections=items&key=${encodeURIComponent(key)}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error.error);
        await redis(['SET', ITEMS_CACHE_KEY, JSON.stringify({ items: data.items, fetchedAt: Date.now() })]);
        return data.items;
    } catch (e) {
        // Fall back to a stale cached copy rather than showing zero profit info everywhere.
        try {
            const raw = await redis(['GET', ITEMS_CACHE_KEY]);
            return raw ? JSON.parse(raw).items : {};
        } catch (e2) { return {}; }
    }
}

module.exports = async function handler(req, res) {
    try {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { key, action } = req.body || {};
        if (!key) return res.status(400).json({ error: 'Missing key' });
        if (action !== 'read') return res.status(400).json({ error: 'Unknown action' });

        const [stockRes, itemDirectory] = await Promise.all([
            fetch('https://yata.yt/api/v1/travel/export/'),
            getItemDirectory(key),
        ]);
        const stockData = await stockRes.json();
        const now = Date.now();

        const countries = Object.entries(stockData.stocks || {}).map(([code, country]) => {
            const items = (country.stocks || []).map(item => {
                const dir = itemDirectory?.[item.id];
                const marketValue = dir?.market_value ?? null;
                const profit = marketValue != null ? marketValue - item.cost : null;
                return {
                    id: item.id,
                    name: dir?.name || item.name,
                    quantity: item.quantity,
                    cost: item.cost,
                    marketValue,
                    profit,
                    profitPct: marketValue && item.cost > 0 ? Math.round((profit / item.cost) * 100) : null,
                };
            }).sort((a, b) => (b.profitPct ?? -Infinity) - (a.profitPct ?? -Infinity));

            const updatedAt = country.update ? country.update * 1000 : null;
            return {
                code, name: COUNTRY_NAMES[code] || code,
                items, updatedAt,
                ageMinutes: updatedAt ? Math.round((now - updatedAt) / 60000) : null,
            };
        }).sort((a, b) => a.name.localeCompare(b.name));

        return res.status(200).json({ countries, payloadTimestamp: stockData.timestamp ? stockData.timestamp * 1000 : null });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
