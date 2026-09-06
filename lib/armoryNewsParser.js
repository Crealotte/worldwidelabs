// lib/armoryNewsParser.js — turns one Torn faction news entry (armoryAction / armoryDeposit
// category) into a structured event, or null if it doesn't match anything recognized.
//
// Torn doesn't expose armory transactions as structured JSON — only as a human-readable news
// sentence per event (same as the "attacknews" feed api/respect.js already parses for losses).
// This file is the one place that translates that free text into data; api/armory-tracker.js
// only ever deals in the structured result, never raw news strings.
//
// Exact wording is based on how other Torn tool developers (see faction-armory-tracker on
// GitHub) describe these entries, not a verified live sample — a real feed may phrase things
// slightly differently. Every entry that doesn't match one of the patterns below comes back as
// `{ unparsed: true, text }` rather than being silently dropped, specifically so a leader can
// paste an example of what didn't parse and the pattern can be corrected.

function stripTags(html) {
    return String(html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
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
    const text = stripTags(entry.news || entry.text || '');
    const timestamp = entry.timestamp || null;
    for (const { action, re } of PATTERNS) {
        const m = re.exec(text);
        if (!m) continue;
        if (action === 'deposited' || action === 'loaned' || action === 'retrieved' || action === 'returned') {
            return { id, timestamp, action, actor: m[1].trim(), quantity: Number(m[2]), item: m[3].trim(), otherParty: m[4] ? m[4].trim() : null };
        }
        if (action === 'used') {
            return { id, timestamp, action, actor: m[1].trim(), quantity: 1, item: m[2].trim(), otherParty: null };
        }
        // filled / opened: no quantity in the sentence, no second party.
        return { id, timestamp, action, actor: m[1].trim(), quantity: 1, item: m[2].trim(), otherParty: null };
    }
    return { id, timestamp, unparsed: true, text };
}

module.exports = { parseArmoryNewsEntry, stripTags };
