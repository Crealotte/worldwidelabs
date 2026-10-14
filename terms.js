// terms.js — the terms & conditions of the three Labs programs, as the owner wrote them: the investment fund, rent-to-buy (private islands) and buddy banking. They are shown to the people they are for
// (My investments, My rental, and the owner's Buddy banking page) and an investor or tenant can accept them: the date is kept (see invHandle / tenHandle) and the owner sees who accepted.
// To change a text, change it here and raise the version: everyone is then asked to accept the new version.
'use strict';

const TERMS_VERSION = { invest: '2026-10-14', property: '2026-10-09', buddy: '2026-10-14' };
const TERMS = {
    invest: { title: 'How the Labs Investment Fund works', sections: [
        ['1️⃣ Apply & Get Approved', ['Click 📥 Join Waitlist and submit your Torn Name and ID. An admin will review and notify you.']],
        ['2️⃣ Set Up via Waitlist', ['When applying via 📥 Join Waitlist, enter your investment amount and renewal preference directly in the form. An admin reviews your request and, when approved, you\'ll receive a DM with trade instructions to fund your contract. Do NOT send money directly — always use the in-game Trade system. Your contract locks for 6 months.']],
        ['3️⃣ Receive Weekly Payouts', ['Every 7 days from your start date you earn a payout based on the Unit Rate Baseline:', '🟠 Copper ~$529,000/wk per 100m invested', '🥉 Bronze ~$1,442,000/wk per 250m invested', '🥈 Silver ~$3,125,000/wk per 500m invested', '🥇 Gold/Plat ~$6,731,000/wk per 1b invested', 'Payouts roll individually per investor — not global.']],
        ['🧮 Your total sets your tier', ['All your deposits count together. The total you have in decides your tier, and each tier starts at its full amount: 499m is Bronze, 500m is Silver. The tier decides what you are paid per 1m invested, so a new deposit can lift your whole payout.', 'Example: 300m is Bronze, so you are paid 1,442,000 / 250m x 300m = 1,730,400 a week.', 'You are paid one way, weekly (every Sunday) or monthly (the last Sunday of the month), on all your deposits.']],
        ['🔒 Every deposit has its own lock', ['Each deposit keeps its own start and end date. If you invest in January and again in May, you can still take out the January deposit when its own term ends.', 'If you prefer one date for everything, you can ask to merge your deposits: they all then end on the latest date.']],
        ['4️⃣ Pause Mode', ['Going on holiday? Enable pause mode. Payouts are held and released in full when you return. No compounding while held.']],
        ['5️⃣ Withdrawal & automatic renewal', ['Your contract runs for 180 days. To withdraw when it ends, give notice at least 30 days before the end date.', 'Without notice, your contract renews automatically for another 180 days.', 'If you want to renew yourself, tell us at least 30 days before the end date and you can choose 90 or 180 days. After that, it renews for 180 days.']],
        ['⚠️ Forfeiture Rules', ['• Federal Jail — balance wiped, contract terminated', '• 30 days inactive without activating Pause Mode — account forfeited', '• Abuse/foul play — admin discretion']],
        ['📜 Terms & Conditions Summary', ['Duration: 180 days per deposit. Withdrawal requires notice at least 30 days before the end date, otherwise the deposit renews for another 180 days.', 'Risk: In-game market and management risks apply. No real-life compensation for losses.', 'Security: Multi-company structure spreads risk. Backup reserves protect payouts.', 'Fair Play: Bad-faith actors are removed permanently from the fund and director pool.', 'Transparency: All operations tracked via Discord and Torn mail.']],
        ['💎 Investor Increment Flexibility', ['Existing investors can gradually increase instead of jumping to the next tier.', '• 100m → 250m: steps of 25m', '• 250m → 500m: steps of 50m', '• 500m → 1b: steps of 100m', '• 1b and up: steps of 250m', 'ROI only changes when the next main tier is reached.']],
    ] },
    property: { title: 'Labs Rent-to-Buy: Terms of Service', sections: [
        ['', ['By initiating a Rent-to-Buy contract, you agree to the following terms. These rules ensure the program remains fair and sustainable for all participants.']],
        ['👤 Ownership & Identity', ['Player-Bound: Every contract is strictly tied to the individual player who initiated it.', 'Non-Transferable: Equity cannot be moved, gifted, or sold to another player.', 'Spousal Clause: While a spouse may live in the property, they have zero claim to the accumulated equity. If the contract holder leaves the game or defaults, the spouse must vacate or start a new contract from zero.']],
        ['⏳ 30-Day Contract Cycles', ['All contracts run on a fixed 30-day billing cycle.', 'Partial payments or "daily rates" are not supported. You are committed to the full 30-day fee (Rent + Equity) once the cycle begins.']],
        ['⏸️ The "48-Hour" Inactivity Pause', ['To prevent properties from sitting empty, you must be active at the time of renewal.', 'The Rule: If you are inactive for more than 48 hours at the exact time your 30-day period expires, your contract is automatically paused.', 'Effect: The Private Island will be returned to the market for a new player. Your accumulated equity is SAFE and will remain on your ledger until a new property becomes available for you.']],
        ['🛑 Termination & Forfeiture (Equity Wipe)', ['Equity is permanently forfeited (wiped to $0) under the following conditions:', 'Federal Jail: If the player is permanently Federally Jailed or account-deleted.', 'Abandoned Status: If a player is inactive for 30 consecutive days without prior notice ("Vacation Mode"), the account is considered "Quit" and all equity is cleared.']],
        ['⚡ Buyout & Upgrades', ['Instant Buyout: You may pay the remaining balance of the "Full PI Price" at any time to receive the deeds immediately.', 'Portability: If you wish to upgrade to a higher tier (e.g., 2600 to 4100), 100% of your current equity will be transferred to the new property.']],
        ['⚖️ General Rules', ['Labs and CreaLotte reserves the right to terminate a contract if a player is found to be acting maliciously.', 'Prices are subject to change based on market volatility and game updates, but existing contracts will have their "Full PI Price" locked in at the start of the 30-day cycle.', '2600 happy PI: 17 months', '3600 happy PI: 19 months', '4100 happy PI: 21 months']],
    ] },
    buddy: { title: 'Buddy Banking — Admin-funded Investments', sections: [
        ['How it works', ['I (admin) put up the cash. You invest it in your City Bank and earn the interest. When the term ends, you keep 30% of the profit and send me 70% of the profit. You reinvest the principal for the next round; if we agree to stop, you send the principal back too.']],
        ['Tiers', ['Everyone starts at Bronze so I can build trust. Successful Bronze cycles unlock Silver/Gold.', 'Bronze — $500,000,000 • 30 days', 'Silver — $1,000,000,000 • 30 days (promotion required)', 'Gold — $2,000,000,000 • 60 days (promotion required)']],
        ['Eligibility', ['1. Pair your Torn key with /pair (must include merits + money permissions).', '2. Bank Interest merit must be 10/10.', '3. You must NOT already have an active City Bank investment.', '4. You can only run one Buddy Banking plan at a time.']],
    ] },
};
const termsHtml = id => `<div style="font-size:13px;line-height:1.55;">${TERMS[id].sections.map(([h, lines]) => `${h ? `<div style="font-weight:700;margin-top:10px;">${esc(h)}</div>` : ''}${lines.map(l => `<div style="${/^(•|🥉|🥈|🥇|🟠|💎)|^\d\./.test(l) ? 'padding-left:10px;' : ''}">${esc(l)}</div>`).join('')}`).join('')}</div>`;
// the panel for the people a program is for: open and with an accept button until they have accepted this version, folded away afterwards
function termsPanel(id, accepted) {
    const ok = accepted && accepted.v === TERMS_VERSION[id];
    return `<details class="panel" ${ok ? '' : 'open'} style="${ok ? '' : 'border-color:#e0a030;'}"><summary class="av-sum"><h3 style="display:inline;margin:0;">📜 ${esc(TERMS[id].title)}</h3> <span style="font-size:12px;color:${ok ? 'var(--success,#35d99b)' : '#e0a030'};margin-left:8px;">${ok ? `✓ accepted on ${esc(accepted.on)}` : 'please read and accept'}</span></summary>
        <div style="margin-top:8px;">${termsHtml(id)}</div>
        ${ok ? '' : `<button type="button" class="terms-accept" data-doc="${id}" style="margin-top:12px;">I have read the terms and I accept them</button>`}</details>`;
}
// the accept button of a terms panel: the investor and the tenant each have their own action; afterwards the page is read again
function termsWire(reload) {
    document.querySelectorAll('.terms-accept').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: b.dataset.doc === 'property' ? 'ten-terms-accept' : b.dataset.doc === 'buddy' ? 'bud-terms-accept' : 'inv-terms-accept' }) });
        const r = await res.json().catch(() => ({ error: 'Server problem' }));
        if (r.error) { toast(r.error); b.disabled = false; return; }
        toast('Thank you'); reload();
    }));
}
