// lib/armoryNewsParser.js — turns one Torn faction news entry (from /v2/faction/news,
// cat=armoryAction) into a structured event, or `{unparsed: true, text}` if it doesn't match
// anything recognized.
//
// Torn doesn't expose armory transactions as structured JSON — only as an HTML news sentence per
// event (same situation api/respect.js already handles for the attacknews feed). This file is
// the one place that translates that text into data; api/armory-tracker.js only ever deals in
// the structured result, never raw news strings.
//
// The endpoint, the "used one of the faction's <Item> items" wording, and the XID-extraction
// approach below are all confirmed against Jimidy's Faction Tools' own (currently-disabled, but
// real) consumption-tracker source — not a guess. The other action wordings (deposited, loaned,
// retrieved, returned, filled, opened) are NOT in that reference (it only ever tracked "used"
// events) — those patterns here are still an educated guess at Torn's phrasing. Every entry that
// doesn't match comes back as `{ unparsed: true, text }` rather than being silently dropped, so a
// leader can paste an example of what didn't parse and the pattern can be corrected.

function stripTags(html) {
    return String(html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
}

// Torn's news links a player as `<a href="...XID=12345...">Name</a>` — pulling the ID straight
// out of that is more reliable than matching the plain-text name against the members list later,
// exactly how the reference tool does it.
function extractLeadActorId(html) {
    const m = /<a[^>]*XID=(\d+)[^>]*>/i.exec(html);
    return m ? m[1] : null;
}

// Each pattern captures: actor name, optional quantity, item name, optional second actor (loan
// target / who a loaned item came back from). Patterns are tried in order, first match wins.
const PATTERNS = [
    { action: 'deposited', re: /^(.+?) deposited (\d+)x (.+?) into the faction armory\.?$/i },
    { action: 'used', re: /^(.+?) used one of the faction'?s (.+?) items?\.?$/i },
    { action: 'loaned', re: /^(.+?) loaned (\d+)x (.+?) to (.+?) from the faction armory\.?$/i },
    { action: 'retrieved', re: /^(.+?) retrieved (\d+)x (.+?) from (.+?) for the faction armory\.?$/i },
    { action: 'returned', re: /^(.+?) returned (\d+)x (.+?) to the faction armory\.?$/i },
    { action: 'filled', re: /^(.+?) filled (?:a |an )?(.+?) for the faction armory\.?$/i },
    { action: 'opened', re: /^(.+?) opened (?:a |an )?(.+?) from the faction armory\.?$/i },
];

function parseArmoryNewsEntry(id, entry) {
    const raw = entry.text ?? entry.news ?? '';
    const actorId = extractLeadActorId(raw);
    const text = stripTags(raw);
    const timestamp = entry.timestamp || null;
    for (const { action, re } of PATTERNS) {
        const m = re.exec(text);
        if (!m) continue;
        if (action === 'deposited' || action === 'loaned' || action === 'retrieved' || action === 'returned') {
            return { id, timestamp, action, actor: m[1].trim(), actorId, quantity: Number(m[2]), item: m[3].trim(), otherParty: m[4] ? m[4].trim() : null };
        }
        if (action === 'used') {
            return { id, timestamp, action, actor: m[1].trim(), actorId, quantity: 1, item: m[2].trim(), otherParty: null };
        }
        // filled / opened: no quantity in the sentence, no second party.
        return { id, timestamp, action, actor: m[1].trim(), actorId, quantity: 1, item: m[2].trim(), otherParty: null };
    }
    return { id, timestamp, unparsed: true, text };
}

module.exports = { parseArmoryNewsEntry, stripTags };
