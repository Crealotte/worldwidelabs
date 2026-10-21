// lib/welcome.js — the welcome chapters for pupils in the mentoring program, a bit like missions: the old welcome mails are broken down into
// chapters (1-5), each a small checklist. Finishing a chapter opens the next one, so a new member goes at their own pace — an eager one can do
// all of it in one go. A pupil only sees the chapter they are on (the others show a lock). The mentor sees how far their pupil is, on the site
// and in the script, and gets a To do line per pupil. Leaders write the chapters (Welcome chapters page). Nothing here expires: it is for people in
// the mentoring program, and ends when every step is done.
//
// A step can tick itself ("auto") when WWL can check it — script installed, usual online hours set, country picked, revives off, in an
// Organized Crime, on Discord, has a role — and once ticked it stays ticked. A step can also be "available from day N" in the faction (Organized
// Crimes open on day 3): such a step never holds up the next chapter, it just waits and shows once its day is reached.
//
// The role path (rolePath below) is the faction's ladder, matched on the Torn position name: Recruit (automatic on joining) -> Experiment A
// (automatic after 3 days) -> Experiment B (on WWL with the script installed: armory access) -> Guinea Pig (under lv15) / Lab Rat (lv15 and up)
// (joined everything: Discord, Intel and CAT; Intel and CAT are verified by a leader on Who's on board) -> Chemist (the war rule met in 3 of the last 5 wars). Positions are still set by a leader in Torn;
// "Ready for promotion" lists who meets the next step's requirements so leaders do not have to check everyone.
//
//   wwl:welcome-steps:{faction}  -> { chapters: [{ id, title, intro, tasks: [{ id, text, link, label, auto, autoArg, fromDay }] }] }
//   wwl:welcome-done:{faction}   -> hash playerId -> JSON { taskId: ticked-at-seconds }
//   wwl:promo-cache:{faction}    -> { at, list } the promotion list, kept for 30 minutes

const { loadProgram } = require('./mentoring');
const { energyDaily } = require('./steadfast');

const stepsKey = f => `wwl:welcome-steps:${f}`;
const doneKey = f => `wwl:welcome-done:${f}`;
const seenKey = f => `wwl:userscript-seen:${f}`;
const hoursKey = f => `wwl:online-hours:${f}`;
const tzKey = f => `wwl:tz:${f}`;
const promoKey = f => `wwl:promo-cache:${f}`;

// ---- War related role changes wait for the newsletter ----
// A move to Chemist and a move down from Chemist depend on the wars, so they only come up AFTER this month's newsletter, with the check-in messages to the members, was sent
// (a leader marks that on the Newsletter page). The other changes (Experiment B, Guinea Pig / Lab Rat: WWL, the script, Discord, Intel, CAT) come up straight away.
// The newsletter of a finished period comes out the first Sunday of the month, so a mark counts for the month that began on the latest first Sunday.
const sentKey = f => `wwl:checkin-sent:${f}`;
const firstSundayMs = (y, m) => { const f = new Date(Date.UTC(y, m, 1)); return Date.UTC(y, m, 1 + (7 - f.getUTCDay()) % 7); };
function cycleStart(now = Date.now()) { const d = new Date(now); for (let i = 0; i < 3; i++) { const t = firstSundayMs(d.getUTCFullYear(), d.getUTCMonth() - i); if (t <= now) return t; } return 0; }
const isWarChange = p => !!p && (p.to === 'Chemist' || p.kind === 'demote');
async function checkinState(redis, factionId) {
    const cycle = cycleStart();
    let rec = null; try { const raw = await redis(['GET', sentKey(factionId)]); rec = raw ? JSON.parse(raw) : null; } catch (e) { rec = null; }
    return { cycle, sent: !!(rec && rec.cycle === cycle), at: rec && rec.cycle === cycle ? rec.at || 0 : 0, by: rec && rec.cycle === cycle ? rec.by || '' : '' };
}
async function checkinSet(redis, factionId, on, by) {
    if (on) await redis(['SET', sentKey(factionId), JSON.stringify({ cycle: cycleStart(), at: Date.now(), by: String(by || '').slice(0, 40) })]);
    else await redis(['DEL', sentKey(factionId)]);
    try { await redis(['DEL', promoKey(factionId)]); } catch (e) { /* the list is worked out again */ }
    return checkinState(redis, factionId);
}
const STALLED_DAYS = 3;

const AUTO = { script: 'the WWL script is installed', hours: 'usual online hours are set', timezone: 'a country is picked on the timezone map', revives: 'revives are set to off', oc: 'is in an Organized Crime', discord: 'is on our Discord', role: 'has the role' };

// Starting texts to rewrite — used until a leader saves their own. In text, [label](https://...) becomes a link.
const T = (id, text, o = {}) => ({ id, text, link: o.link || '', label: o.label || '', auto: o.auto || '', autoArg: o.autoArg || '', fromDay: o.fromDay || 0, remind: o.remind || '' });
const DEFAULT_CONFIG = {
    chapters: [
        { id: 'c1', title: 'Settling in', intro: 'We are thrilled to have you on our team and hope you feel at home very soon. These steps get you settled: take them one chapter at a time, or all in one go if you feel like it. Finishing this chapter gets you to Experiment B, which gives you access to our armory. We look if this first chapter is done within your first 24 hours, because these are extremely important to us. Questions? Ask your mentor, or message Leadership or the Researchers (council).',
          tasks: [
              T('c1a', 'Say hi in our faction chat, we don\'t bite!'),
              T('c1b', 'Install the WWL script, so your to-dos show up right inside Torn.', { auto: 'script', link: 'dashboard', label: 'Open the dashboard' }),
              T('c1c', 'Tell us when you are usually online: on the WWL site, open the Mentoring page and tick the hours you are normally around. That way we can match you with a mentor who is online at the same time.', { auto: 'hours', link: 'mentoring', label: 'Set my online hours' }),
              T('c1d', 'Put your revives off in your settings, and only turn them on when you really need them. This prevents bleeding respect during wars when people revive you to hit you again ;)', { auto: 'revives', link: 'https://www.torn.com/preferences.php#tab=privacy', label: 'Open settings' }),
              T('c1e', 'Once you have a mentor, say hi in your Mentoring chat. They are there to help you with anything: gym, energy, wars and crimes.'),
          ] },
        { id: 'c2', title: 'Your roles and what they give you', intro: 'Here is how our roles work. You start as a Recruit (automatic when you join). After 3 days you become Experiment A (automatic). When you are on WWL with the script installed you become Experiment B, which gives you access to the armory. When you have joined everything (Discord, Intel and CAT) you become a Guinea Pig (under level 15) or a Lab Rat (level 15 and up). And when you have taken part in 3 of our last 5 wars you become a Chemist. Junior and Senior Researcher are our council roles: the leaders choose who gets those. Your own role path is shown at the top of this page.',
          tasks: [
              T('c2a', 'Have a look at your role path at the top of this page: it shows your role and what you still need for the next one.'),
              T('c2b', 'Know what the armory gives you: loan weapons and armour, free beer ALWAYS, free candy ALWAYS, and free Xanax when war prep starts (often 48h before a war, more on that later).', { link: 'https://www.torn.com/factions.php?step=your#/tab=armoury', label: 'Open the armory' }),
              T('c2c', 'Have a look at our training schedule to see which training perks are up.'),
              T('c2d', 'Read the post about our roles, to know who is who.'),
              T('c2e', 'New to Torn? Check our selection of must-read beginner guides.'),
          ] },
        { id: 'c3', title: 'Organized Crimes', intro: 'Organized Crimes (OC\'s) make you easy money and give the faction respect, and the higher the level, the higher the pay, so moving up is key! You can join them after your first 3 days in the faction.',
          tasks: [
              T('c3a', 'Open the Organized Crimes page and take a close look at your % in each of the roles.', { link: 'https://www.torn.com/factions.php?step=your&type=12#/tab=crimes', label: 'Open Crimes', fromDay: 3 }),
              T('c3b', 'We only start on level 3 OC\'s, so if you are below 85%, join one of these. See another crime role where you get 70%-85%? Join one of those ;)', { auto: 'oc', fromDay: 3 }),
              T('c3c', 'Don\'t see a crime you normally can take? Ask in faction chat to spawn new OC\'s.'),
              T('c3d', 'Read our forum post about OC\'s.'),
              T('c3e', 'Remember: always be in one, and be in Torn when it ends so no one needs to wait. The WWL script will remind you when you are not in one.'),
          ] },
        { id: 'c4', title: 'Intel, Discord and CAT', intro: 'These three are what we need to make you a Guinea Pig (under level 15) or a Lab Rat (level 15 and up). CAT is our war tool, a script (TornPDA on phone) or extension (on PC) with a public API key. It works best when EVERYONE is on it. It shows the opponent\'s stats and lets you "call" hits so no one else attacks the same person, which saves a lot of frustration and energy. I know this seems like a lot, but it is definitely worth it!',
          tasks: [
              T('c4a', 'Join Intel and enter a limited API key there. A leader verifies it for you on WWL.'),
              T('c4b', 'Come check out our Discord, and verify yourself there.', { auto: 'discord' }),
              T('c4c', 'Go to CAT, click the version you want (script for TornPDA, extension for PC) and install it.'),
              T('c4d', 'Go to the faction page: you will see several tabs under the chain/war spaces. Click the settings tab and enter a public API key. Yaaay, you did it! A leader verifies it for you on WWL.'),
              T('c4e', 'Stuck? On our Discord there is a channel called "script tutorials" with a photo guide on how to install it.'),
              T('c4f', 'Good to know: the leader activates CAT before EACH war, so don\'t worry if it does not seem to work between wars. You can also plan group attacks and call for help with it (which pings Discord).'),
          ] },
        { id: 'c5', title: 'Wars and chains', intro: 'You made it this far, congrats! That means you are ready for your first war and chain. We always aim for a 1000 chain, and the best practice for chaining is taking part in one. When you have taken part in 3 of our last 5 wars you become a Chemist. If you are in doubt, just ask in faction chat!',
          tasks: [
              T('c5a', 'Know the war types: there is always an "Upcoming war against XX" post saying if it is a Termed Win, a Termed Loss or a Real War, what score we need and the rules. This is key information!'),
              T('c5b', 'For each war we stack 48h before the start: have 900 - 1000 energy and 0 drug cooldown, unless you OD.'),
              T('c5c', 'Use CAT for calling hits. Also look at the list and the hospitalised people on their side: if not many targets are getting out within 5 minutes, slow down and only hit at 3:00 on the chain timer so it does not die.'),
              T('c5d', 'For each Xanax you take out of the armory you are expected to do 10 hits in the war/chain.'),
              T('c5e', 'Plan ahead: add your availability for the next war, and let us know if you cannot take part.', { link: 'availability', label: 'Open Availability' }),
              T('c5f', 'Read the war guide.'),
          ] },
    ],
};

async function loadConfig(redis, factionId) {
    try {
        const raw = await redis(['GET', stepsKey(factionId)]);
        if (raw) { const c = JSON.parse(raw); if (c && Array.isArray(c.chapters)) return { chapters: c.chapters, cards: Array.isArray(c.cards) ? c.cards : [], custom: true }; }
    } catch (e) { /* default */ }
    return { ...DEFAULT_CONFIG, cards: [], custom: false };
}
async function doneOf(redis, factionId, playerId) {
    try { const raw = await redis(['HGET', doneKey(factionId), String(playerId)]); return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}

// What WWL can see for a member. `snap` (their own Torn profile) is only given when the member is asking themselves — nobody else's revive
// setting or crime is visible to us, so those two are only ticked when the pupil opens their own page (and stay ticked).
async function autoFacts(redis, factionId, id, tasks, { snap, position, discordOf, self }) {
    const want = new Set(tasks.filter(t => t.auto).map(t => t.auto));
    const f = {};
    if (want.has('script')) f.script = Number(await redis(['HGET', seenKey(factionId), String(id)])) > 0;
    if (want.has('hours')) f.hours = !!(await redis(['HEXISTS', hoursKey(factionId), String(id)]));
    if (want.has('timezone')) f.timezone = !!(await redis(['HEXISTS', tzKey(factionId), String(id)]));
    if (want.has('revives') && snap) f.revives = snap.revivable === false;
    if (want.has('oc') && snap) f.oc = !!snap.inOC;
    if (want.has('discord') && discordOf) f.discord = (await discordOf(id, !!self)) === true;
    f.position = String(position || '').toLowerCase();
    return f;
}
const autoOk = (t, f) => t.auto === 'role' ? String(t.autoArg || '').toLowerCase().split(/[|,]/).map(s => s.trim()).filter(Boolean).some(r => f.position.includes(r)) : f[t.auto] === true;

// Works out each chapter: ticks (stored + automatic), which are waiting for their day, and which chapters are open. A chapter is open when the
// one before it has every step without a "from day" ticked. Returns the new automatic ticks too, so they can be kept.
function progress(config, done, days, facts) {
    const newly = {};
    let open = true, current = -1;
    const chapters = config.chapters.map((c, i) => {
        const tasks = (c.tasks || []).map(t => {
            const waiting = t.fromDay > 0 && (days == null || days < t.fromDay);
            let isDone = !!done[t.id];
            if (!isDone && t.auto && !waiting && facts && autoOk(t, facts)) { isDone = true; newly[t.id] = Math.floor(Date.now() / 1000); }
            return { id: t.id, text: t.text, link: t.link, label: t.label, auto: t.auto, fromDay: t.fromDay, remind: t.remind || '', waiting, done: isDone };
        });
        const blocking = tasks.filter(t => !(t.fromDay > 0));
        const complete = tasks.length > 0 && tasks.every(t => t.done);
        const passed = blocking.every(t => t.done); // opens the next chapter
        const locked = !open;
        if (!locked && !passed && current === -1) current = i;
        if (!passed) open = false;
        return { id: c.id, title: c.title, intro: c.intro, tasks, complete, locked, doneCount: tasks.filter(t => t.done).length, total: tasks.length };
    });
    const allDone = chapters.length > 0 && chapters.every(c => c.complete);
    return { chapters, current: current === -1 ? Math.max(0, chapters.length - 1) : current, allDone, newly };
}
// what a pupil is allowed to see: everything of the open chapters, only the title and a lock for the ones still closed
const forPupil = p => ({ ...p, chapters: p.chapters.map(c => c.locked ? { id: c.id, title: c.title, locked: true, total: c.total, doneCount: 0, complete: false, tasks: [] } : c), newly: undefined });

async function persistNew(redis, factionId, id, done, newly) {
    if (!Object.keys(newly).length) return done;
    const merged = { ...done, ...newly };
    await redis(['HSET', doneKey(factionId), String(id), JSON.stringify(merged)]);
    return merged;
}
const lastTick = done => Math.max(0, ...Object.values(done).map(Number).filter(Number.isFinite));

// ---- the role path ----
// 0 Recruit, 1 Experiment A, 2 Experiment B, 3 Guinea Pig / Lab Rat, 4 Chemist, 5 Junior Researcher, 6 Senior Researcher (the last two are council roles a
// leader appoints: there is nothing to tick for them) — matched on the position's name (case does not matter).
function roleIndex(position) {
    const p = String(position || '').toLowerCase();
    if (p.includes('senior researcher')) return 6;
    if (p.includes('junior researcher')) return 5;
    if (p.includes('chemist')) return 4;
    if (p.includes('guinea') || p.includes('lab rat')) return 3;
    if (p.includes('experiment b')) return 2;
    if (p.includes('experiment a')) return 1;
    if (p.includes('recruit')) return 0;
    return -1; // not on the ladder (a leader or council position)
}
const animalName = level => level == null ? 'Guinea Pig / Lab Rat' : level >= 15 ? 'Lab Rat' : 'Guinea Pig';
// info: { position, days, level, script, discord (true/false/null), intel, cat (true/false/null), warsOk (number|null), warsNeed }
function rolePath(info) {
    const cur = roleIndex(info.position);
    const yn = v => v === true ? true : v === false ? false : null; // null = cannot tell (yet)
    const steps = [
        { name: 'Recruit', reqs: [{ text: 'Joined the faction', ok: true, auto: true }] },
        { name: 'Experiment A', reqs: [{ text: '3 days in the faction', ok: info.days == null ? null : info.days >= 3, auto: true, detail: info.days == null ? '' : `day ${info.days + 1}` }] },
        { name: 'Experiment B', reqs: [{ text: 'On WWL', ok: true, auto: true }, { text: 'WWL script installed', ok: yn(info.script), auto: true }], gives: 'armory access' },
        { name: animalName(info.level), reqs: [{ text: 'On our Discord', ok: yn(info.discord), auto: true }, { text: 'Joined Intel', ok: yn(info.intel) }, { text: 'Installed CAT', ok: yn(info.cat) }] },
        { name: 'Chemist', reqs: [{ text: `War rule met in ${info.warsNeed || 3} of the last 5 wars`, ok: info.warsOk == null ? null : info.warsOk >= (info.warsNeed || 3), auto: true, detail: info.warsOk == null ? '' : `${info.warsOk} so far` }] },
        { name: 'Junior Researcher', reqs: [{ text: 'A council role: chosen by the leaders', ok: null, appointed: true }], appointed: true },
        { name: 'Senior Researcher', reqs: [{ text: 'A council role: chosen by the leaders', ok: null, appointed: true }], appointed: true },
    ].map(s => ({ ...s, met: !s.appointed && s.reqs.every(r => r.ok === true) }));
    // a Chemist keeps the role only while the war rule keeps being met (judged on the wars they could take part in)
    const needM = Math.min(info.warsNeed || 3, info.warsEligible ?? (info.warsNeed || 3));
    const keep = cur === 4 ? { text: `To stay a Chemist: war rule met in ${info.warsNeed || 3} of the last 5 wars`, ok: info.warsOk == null ? null : info.warsOk >= needM, detail: info.warsOk == null ? '' : `${info.warsOk} so far` } : null;
    return { current: cur, next: cur >= 0 && cur < 6 ? cur + 1 : null, position: info.position || '', steps, keep };
}
// the facts the role path needs for one member
async function roleInfo(ctx, id, done, config, self) {
    const { redis, factionId, roster, warOk, discordOf } = ctx;
    const m = (await roster()).find(x => x.id === String(id)) || {};
    const v = ctx.verifyOf ? await ctx.verifyOf(id) : {}; // Intel and CAT cannot be checked by WWL: a leader verifies them on Who's on board
    const info = { position: m.position || '', days: m.days ?? null, level: m.level ?? null, script: Number(await redis(['HGET', seenKey(factionId), String(id)])) > 0, intel: !!v.intel, cat: !!v.cat, discord: null, warsOk: null, warsNeed: 3 };
    if (discordOf) { const d = await discordOf(id, !!self); info.discord = d === true ? true : d === false ? false : null; }
    if (roleIndex(info.position) >= 3 && roleIndex(info.position) <= 4 && warOk) { const w = await warOk([{ id: String(id), days: m.days ?? null }]); info.warsOk = w.ok[String(id)] ?? 0; info.warsNeed = w.need; info.warsEligible = w.eligible[String(id)] ?? 0; }
    return info;
}

// ---- who is ready for promotion (leaders) ----
// Positions are set by a leader in Torn, so this only lists who meets the requirements of the next step but still holds the lower position:
// Experiment A -> B (script installed), Experiment B -> Guinea Pig / Lab Rat (Discord, Intel and CAT), Guinea Pig / Lab Rat -> Chemist (war rule).
// Kept for 30 minutes so opening the dashboard does not recompute it every time.
async function promotions(ctx, force) {
    const { redis, factionId, roster, warOk, discordMany, verifyAll } = ctx;
    if (!force) { try { const raw = await redis(['GET', promoKey(factionId)]); const c = raw ? JSON.parse(raw) : null; if (c && Date.now() - c.at < 30 * 60000) return c.list; } catch (e) { /* recompute */ } }
    const config = await loadConfig(redis, factionId);
    const list = [];
    const members = (await roster()).map(m => ({ ...m, idx: roleIndex(m.position) })).filter(m => m.idx >= 1 && m.idx <= 4);
    const seen = {};
    const seenFlat = (await redis(['HGETALL', seenKey(factionId)])) || [];
    for (let i = 0; i < seenFlat.length; i += 2) seen[seenFlat[i]] = Number(seenFlat[i + 1]);
    const ver = verifyAll ? await verifyAll() : {}; // Intel and CAT are verified by a leader on Who's on board
    const toB = members.filter(m => m.idx === 2), toC = members.filter(m => m.idx === 3), chem = members.filter(m => m.idx === 4);
    let disc = {};
    const held = members.filter(m => m.idx >= 2); // everyone who holds Experiment B or higher: their earlier requirements are checked too
    if (held.length && discordMany) { try { disc = await discordMany(held.map(m => m.id)); } catch (e) { /* unknown */ } }
    let wars = null;
    if ((toC.length || chem.length) && warOk) { try { wars = await warOk([...toC, ...chem].map(m => ({ id: m.id, days: m.days }))); } catch (e) { /* unknown */ } }
    for (const m of members) {
        // a position that was given without the requirements being met (set by hand in Torn): listed as 'check'. Only what is known for sure counts:
        // Discord only when it is a clear no (not unknown), and Intel and CAT as long as a leader has not marked them on Who's on board.
        if (m.idx >= 2) {
            const miss = [];
            const noScript = !(seen[m.id] > 0);
            if (noScript) miss.push('WWL script not installed');
            if (m.idx >= 3) {
                if (disc[m.id] === 'no' && !ver[m.id]?.discordExempt) miss.push('not on Discord');
                if (!ver[m.id]?.intel) miss.push('Intel not verified');
                if (!ver[m.id]?.cat) miss.push('CAT not verified');
            }
            if (miss.length) list.push({ id: m.id, name: m.name, from: m.position, to: noScript ? 'Experiment A' : 'Experiment B', kind: 'check', why: 'does not meet the requirements of the role: ' + miss.join(', ') });
        }
        if (m.idx === 1 && seen[m.id] > 0) list.push({ id: m.id, name: m.name, from: m.position, to: 'Experiment B', why: 'on WWL with the script installed' });
        if (m.idx === 2 && (disc[m.id] === 'yes' || ver[m.id]?.discordExempt) && ver[m.id]?.intel && ver[m.id]?.cat) list.push({ id: m.id, name: m.name, from: m.position, to: animalName(m.level), why: 'Discord, Intel and CAT done' });
        if (m.idx === 3 && wars && (wars.ok[m.id] || 0) >= wars.need) list.push({ id: m.id, name: m.name, from: m.position, to: 'Chemist', why: `war rule met in ${wars.ok[m.id]} of the last 5 wars` });
        // a Chemist who no longer meets the war rule goes back to Guinea Pig / Lab Rat. Only judged when enough wars are known, and only on the wars
        // they could take part in (a war they said beforehand they could not make does not count against them, same as the evaluation).
        if (m.idx === 4 && wars && wars.known >= wars.need) {
            const n = wars.ok[m.id] || 0, needM = Math.min(wars.need, wars.eligible[m.id] || 0);
            if (n < needM) list.push({ id: m.id, name: m.name, from: m.position, to: animalName(m.level), kind: 'demote', why: `war rule met in only ${n} of the last 5 wars (needs ${needM})` });
        }
    }
    try { await redis(['SET', promoKey(factionId), JSON.stringify({ at: Date.now(), list }), 'EX', 3600]); } catch (e) { /* not critical */ }
    return list;
}

// ---- To do lines (for member-todo): a pupil gets one line, a mentor one per pupil ----
async function welcomeTodoItems(redis, factionId, playerId, { site, snap, roster, discordOf }) {
    const items = [];
    const program = await loadProgram(redis, factionId);
    const config = await loadConfig(redis, factionId);
    const rosterList = await roster();
    const byId = Object.fromEntries(rosterList.map(m => [m.id, m]));
    const to = site ? `${site}/mentoring` : null;
    const view = async (id, self) => {
        const tasks = config.chapters.flatMap(c => c.tasks || []);
        let done = await doneOf(redis, factionId, id);
        const m = byId[String(id)];
        const p = progress(config, done, m ? m.days : null, await autoFacts(redis, factionId, id, tasks, { snap: self ? snap : null, position: m ? m.position : '', discordOf, self }));
        done = await persistNew(redis, factionId, id, done, p.newly);
        return { p, done };
    };
    if (program.pupils?.[String(playerId)]) {
        const { p } = await view(playerId, true);
        if (!p.allDone) { const c = p.chapters[p.current]; items.push({ id: 'welcome', text: `👋 Check your welcome chapters: chapter ${p.current + 1} of ${p.chapters.length}, ${c.title} (${c.doneCount} of ${c.total} steps done).`, cta: 'Open chapters', url: to, scriptTab: 'mentoring' }); }
    }
    const mine = Object.entries(program.pupils || {}).filter(([, pu]) => String(pu.mentorId) === String(playerId)).slice(0, 8);
    for (const [pupilId, pu] of mine) {
        const { p, done } = await view(pupilId, false);
        if (p.allDone) continue;
        const c = p.chapters[p.current];
        const idle = lastTick(done) ? (Date.now() / 1000 - lastTick(done)) / 86400 : null;
        const stalled = idle != null ? idle >= STALLED_DAYS : (pu.addedAt ? (Date.now() - pu.addedAt) / 86400000 >= STALLED_DAYS : false);
        items.push({ id: `welcome-pupil-${pupilId}`, text: `🎓 Help ${pu.name || `#${pupilId}`}: they are on welcome chapter ${p.current + 1} of ${p.chapters.length} (${c.title}), ${c.doneCount} of ${c.total} steps done${stalled ? ` — no progress for ${STALLED_DAYS}+ days, maybe check in with them` : ''}.`, cta: 'Open chapters', url: to, scriptTab: 'mentoring' });
    }
    return items;
}

async function welHandle(action, body, ctx) {
    const { redis, factionId, playerId, mentorOf, leader, roster, userSnap, discordOf } = ctx;
    const config = await loadConfig(redis, factionId);
    const allTasks = [...config.chapters, ...(config.cards || [])].flatMap(c => c.tasks || []);
    const rosterOf = async id => (await roster()).find(m => m.id === String(id)) || null;

    if (action === 'wel-my') {
        const program = await loadProgram(redis, factionId);
        const inProgram = !!program.pupils?.[String(playerId)]; // anyone can follow the welcome chapters; only people in the mentoring program are also nudged and followed by a mentor
        const me = await rosterOf(playerId);
        let done = await doneOf(redis, factionId, playerId);
        const needsSnap = allTasks.some(t => (t.auto === 'revives' || t.auto === 'oc') && !done[t.id]);
        const facts = await autoFacts(redis, factionId, playerId, allTasks, { snap: needsSnap ? await userSnap() : null, position: me ? me.position : '', discordOf, self: true });
        const p = progress(config, done, me ? me.days : null, facts);
        done = await persistNew(redis, factionId, playerId, done, p.newly);
        return { pupil: inProgram, days: me ? me.days : null, role: rolePath(await roleInfo(ctx, playerId, done, config, true)), ...forPupil(p) };
    }
    if (action === 'wel-done') { // a pupil ticks a step of their own (automatic steps tick themselves)
        const id = String(body.id || '');
        const t = allTasks.find(x => x.id === id);
        if (!t) throw new Error('That step no longer exists.');
        if (t.auto) throw new Error('That one ticks itself when it is done.');
        const me = await rosterOf(playerId);
        const done = await doneOf(redis, factionId, playerId);
        const ch = progress(config, done, me ? me.days : null, null).chapters.find(c => c.tasks.some(x => x.id === id));
        if (ch && ch.locked) throw new Error('Finish the chapter before it first.'); // a step of a standalone Lab Note has no lock
        if (body.done === false) delete done[id]; else done[id] = Math.floor(Date.now() / 1000);
        await redis(['HSET', doneKey(factionId), String(playerId), JSON.stringify(done)]);
        return { ok: true };
    }
    if (action === 'lab-get') { // the Lab Notes page, for any member: the role path, the welcome chapters and the other cards, each with their own ticks
        const program = await loadProgram(redis, factionId);
        const me = await rosterOf(playerId);
        let done = await doneOf(redis, factionId, playerId);
        const needsSnap = allTasks.some(t => (t.auto === 'revives' || t.auto === 'oc') && !done[t.id]);
        const facts = await autoFacts(redis, factionId, playerId, allTasks, { snap: needsSnap ? await userSnap() : null, position: me ? me.position : '', discordOf, self: true });
        const days = me ? me.days : null;
        const p = progress(config, done, days, facts);
        const cardsP = progress({ chapters: config.cards || [] }, done, days, facts); // standalone cards: same steps and ticks, but no lock between them
        done = await persistNew(redis, factionId, playerId, done, { ...p.newly, ...cardsP.newly });
        let mine = [];
        try { const raw = await redis(['HGET', `wwl:my-todos:${factionId}`, String(playerId)]); mine = raw ? JSON.parse(raw) : []; } catch (e) { /* none */ }
        const cards = cardsP.chapters.map(c => ({ ...c, locked: false, canRemind: c.tasks.some(t => t.remind), remindersOn: mine.some(x => String(x.id).startsWith(`lab-${c.id}-`)) }));
        return { pupil: !!program.pupils?.[String(playerId)], days, role: rolePath(await roleInfo(ctx, playerId, done, config, true)), welcome: forPupil(p), cards };
    }
    if (action === 'lab-reminders') { // after finishing a card: put its daily-reminder steps on the member's own daily to-do (or take them off again)
        const card = (config.cards || []).find(c => c.id === String(body.cardId || ''));
        if (!card) throw new Error('That Lab Note no longer exists.');
        const mineTasks = (card.tasks || []).filter(t => t.remind);
        if (!mineTasks.length) throw new Error('This Lab Note has no daily reminders.');
        const done = await doneOf(redis, factionId, playerId);
        if (body.on && !card.tasks.every(t => done[t.id])) throw new Error('Finish every step of the Lab Note first.');
        const k = `wwl:my-todos:${factionId}`;
        let list = [];
        try { const raw = await redis(['HGET', k, String(playerId)]); list = raw ? JSON.parse(raw) : []; } catch (e) { list = []; }
        list = list.filter(x => !String(x.id).startsWith(`lab-${card.id}-`));
        if (body.on) {
            if (list.length + mineTasks.length > 15) throw new Error('You can keep up to 15 reminders of your own: delete some first, then switch these on.');
            for (const t of mineTasks) list.push({ id: `lab-${card.id}-${t.id}`, text: String(t.remind).slice(0, 100), repeat: 'daily', at: Date.now(), lab: card.id });
        }
        if (list.length) await redis(['HSET', k, String(playerId), JSON.stringify(list)]); else await redis(['HDEL', k, String(playerId)]);
        return { ok: true, on: !!body.on };
    }
    if (action === 'wel-pupil' || action === 'wel-mentor-tick') { // a mentor (or a leader) looks at, or ticks for, one of their pupils
        const pupilId = String(body.pupilId || '');
        if (!(await mentorOf(pupilId)) && !(await leader())) throw new Error('That is not one of your pupils.');
        const pu = await rosterOf(pupilId);
        let done = await doneOf(redis, factionId, pupilId);
        if (action === 'wel-mentor-tick') {
            const id = String(body.id || '');
            const t = allTasks.find(x => x.id === id);
            if (!t) throw new Error('That step no longer exists.');
            if (t.auto) throw new Error('That one ticks itself when it is done.');
            if (body.done === false) delete done[id]; else done[id] = Math.floor(Date.now() / 1000);
            await redis(['HSET', doneKey(factionId), pupilId, JSON.stringify(done)]);
        }
        const p = progress(config, done, pu ? pu.days : null, await autoFacts(redis, factionId, pupilId, allTasks, { snap: null, position: pu ? pu.position : '', discordOf, self: false }));
        done = await persistNew(redis, factionId, pupilId, done, p.newly);
        return { days: pu ? pu.days : null, ...p, newly: undefined, role: rolePath(await roleInfo(ctx, pupilId, done, config, false)), lastTick: lastTick(done) || null };
    }
    if (action === 'wel-pupil-insight') { // what a mentor sees of their own pupil's training: energy per week and the energy plan they picked (or that they have none)
        const pupilId = String(body.pupilId || '');
        if (!(await mentorOf(pupilId)) && !(await leader())) throw new Error('That is not one of your pupils.');
        const ck = `wwl:pupil-insight:${factionId}:${pupilId}`;
        try { const hit = await redis(['GET', ck]); if (hit) return JSON.parse(hit); } catch (e) { /* compute it */ }
        const DAY = 86400, today = Math.floor(Date.now() / 1000 / DAY), iso = d => new Date(d * DAY * 1000).toISOString().slice(0, 10);
        let plan = null;
        try {
            const raw = await redis(['GET', `wwl:gym-plan:${pupilId}`]);
            const p = raw ? JSON.parse(raw) : null;
            if (p) {
                const items = (p.blocks || []).flatMap(b => b.items || []);
                const thisWeek = p.week === Math.floor(Date.now() / (7 * 86400e3));
                plan = { method: p.method || '', stat: p.stat || '', summary: p.summary || '', weekly: p.weekly ?? null, done: thisWeek ? items.filter(it => (p.checks || {})[it.key]).length : 0, total: items.length, savedAt: p.savedAt || null };
            }
        } catch (e) { /* no plan shown */ }
        let weeks = [], tracked = false;
        try {
            const d = await energyDaily(redis, factionId, today - 41, today);
            const mine = (d.members[pupilId] || {}).days || {};
            tracked = d.firstSnapshotDay != null;
            for (let k = 5; k >= 0; k--) {
                const endDay = today - k * 7, startDay = endDay - 6;
                let total = 0; const stats = [0, 0, 0, 0];
                for (let x = startDay; x <= endDay; x++) { const a = mine[iso(x)]; if (a) a.forEach((v, i) => { total += v; stats[i] += v; }); }
                weeks.push({ from: iso(startDay), to: iso(endDay), total, stats });
            }
        } catch (e) { /* no training shown */ }
        const out = { plan, weeks, tracked, weekly: plan?.weekly ?? null };
        try { await redis(['SET', ck, JSON.stringify(out), 'EX', 1800]); } catch (e) { /* not critical */ }
        return out;
    }
    // below: leaders only (checked by the caller)
    if (action === 'wel-config-get') {
        const program = await loadProgram(redis, factionId);
        const rosterList = await roster();
        const byId = Object.fromEntries(rosterList.map(m => [m.id, m]));
        const flat = (await redis(['HGETALL', doneKey(factionId)])) || [];
        const doneBy = {};
        for (let i = 0; i < flat.length; i += 2) { try { doneBy[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) { /* skip */ } }
        const seen = {};
        const seenFlat = (await redis(['HGETALL', seenKey(factionId)])) || [];
        for (let i = 0; i < seenFlat.length; i += 2) seen[seenFlat[i]] = Number(seenFlat[i + 1]);
        const pupils = Object.entries(program.pupils || {}).map(([id, pu]) => {
            const m = byId[id];
            const p = progress(config, doneBy[id] || {}, m ? m.days : null, null);
            const c = p.chapters[p.current];
            return { id, name: pu.name || (m && m.name) || `#${id}`, mentor: pu.mentorId ? (program.mentors?.[pu.mentorId]?.name || `#${pu.mentorId}`) : '', role: m ? m.position : '', days: m ? m.days : null, script: !!seen[id], allDone: p.allDone, chapter: p.current + 1, chapters: p.chapters.length, chapterTitle: c ? c.title : '', done: p.chapters.reduce((s, x) => s + x.doneCount, 0), total: p.chapters.reduce((s, x) => s + x.total, 0), lastTick: lastTick(doneBy[id] || {}) || null };
        });
        const gate = await checkinState(redis, factionId);
        return { config, pupils, autoKinds: AUTO, promotions: (await promotions(ctx, !!body.refreshPromotions)).map(p => ({ ...p, waiting: isWarChange(p) && !gate.sent })), checkin: gate };
    }
    if (action === 'wel-config-save') {
        const clean = (v, n) => String(v || '').trim().slice(0, n);
        // the welcome chapters and the standalone cards share one shape: title, intro, steps (a step can be a daily-reminder candidate: `remind`)
        const cleanSet = (list, max, tag) => (Array.isArray(list) ? list : []).slice(0, max).map((c, i) => ({
            id: /^c[a-z0-9]{1,12}$/.test(c?.id) ? c.id : `c${Date.now().toString(36)}${tag}${i}`,
            title: clean(c?.title, 80), intro: clean(c?.intro, 1200),
            tasks: (Array.isArray(c?.tasks) ? c.tasks : []).slice(0, 15).map((t, j) => ({
                id: /^c[a-z0-9]{1,16}$/.test(t?.id) ? t.id : `c${Date.now().toString(36)}${tag}${i}${j}`,
                text: clean(t?.text, 600), link: clean(t?.link, 300), label: clean(t?.label, 40),
                auto: Object.keys(AUTO).includes(t?.auto) ? t.auto : '', autoArg: clean(t?.autoArg, 80), fromDay: Math.max(0, Math.min(60, Math.floor(Number(t?.fromDay) || 0))),
                remind: clean(t?.remind, 100),
            })).filter(t => t.text),
        })).filter(c => c.title);
        await redis(['SET', stepsKey(factionId), JSON.stringify({ chapters: cleanSet(body.chapters, 10, 'a'), cards: cleanSet(body.cards, 40, 'k') })]);
        return { ok: true };
    }
    throw new Error('Unknown action');
}

module.exports = { welHandle, welcomeTodoItems, promotions, checkinState, checkinSet, isWarChange };
