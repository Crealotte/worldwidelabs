// lib/welcome.js — the welcome chapters for pupils in the mentoring program, a bit like missions: the old welcome mails are broken down into
// chapters (1-5), each a small checklist. Finishing a chapter opens the next one, so a new member goes at their own pace — an eager one can do
// all of it in one go. A pupil only sees the chapter they are on (the others show a lock). The mentor sees how far their pupil is, on the site
// and in the script, and gets a To do line per pupil. Leaders write the chapters (Welcome steps page). Nothing here expires: it is for people in
// the mentoring program, and ends when every step is done.
//
// A step can tick itself ("auto") when WWL can check it — script installed, usual online hours set, country picked, revives off, in an
// Organized Crime, has a role — and once ticked it stays ticked. A step can also be "available from day N" in the faction (Organized Crimes
// open on day 3): such a step never holds up the next chapter, it just waits and shows once its day is reached.
//
//   wwl:welcome-steps:{faction}  -> { chapters: [{ id, title, intro, tasks: [{ id, text, link, label, auto, autoArg, fromDay }] }] }
//   wwl:welcome-done:{faction}   -> hash playerId -> JSON { taskId: ticked-at-seconds }

const { loadProgram } = require('./mentoring');

const stepsKey = f => `wwl:welcome-steps:${f}`;
const doneKey = f => `wwl:welcome-done:${f}`;
const seenKey = f => `wwl:userscript-seen:${f}`;
const hoursKey = f => `wwl:online-hours:${f}`;
const tzKey = f => `wwl:tz:${f}`;
const STALLED_DAYS = 3;

const AUTO = { script: 'the WWL script is installed', hours: 'usual online hours are set', timezone: 'a country is picked on the timezone map', revives: 'revives are set to off', oc: 'is in an Organized Crime', role: 'has the role' };

// Starting texts to rewrite — used until a leader saves their own. In text, [label](https://...) becomes a link.
const T = (id, text, o = {}) => ({ id, text, link: o.link || '', label: o.label || '', auto: o.auto || '', autoArg: o.autoArg || '', fromDay: o.fromDay || 0 });
const DEFAULT_CONFIG = {
    chapters: [
        { id: 'c1', title: 'Welcome!', intro: 'We are thrilled to have you on our team and hope you feel at home very soon. These steps get you settled: take them one chapter at a time, or all in one go if you feel like it. We look if this first chapter is done within your first 24 hours, because these are extremely important to us. Questions? Ask your mentor, or message Leadership or the Researchers (council).',
          tasks: [
              T('c1a', 'Say hi in our faction chat, we don\'t bite!'),
              T('c1b', 'Install the WWL script, so your to-dos show up right inside Torn.', { auto: 'script', link: 'dashboard', label: 'Open the dashboard' }),
              T('c1c', 'Tell us when you are usually online: on the WWL site, open the Mentoring page and tick the hours you are normally around. That way we can match you with a mentor who is online at the same time.', { auto: 'hours', link: 'mentoring', label: 'Set my online hours' }),
              T('c1d', 'Join Intel and enter a limited API key there. (Required to become a Guinea Pig, under lv15, or a Lab Rat, over lv15.)'),
              T('c1e', 'Come check out our Discord. (Also required for Guinea Pig / Lab Rat.)'),
              T('c1f', 'Put your revives off in your settings, and only turn them on when you really need them. This prevents bleeding respect during wars when people revive you to hit you again ;)', { auto: 'revives', link: 'https://www.torn.com/preferences.php#tab=privacy', label: 'Open settings' }),
          ] },
        { id: 'c2', title: 'Your role and the armory', intro: 'Your recruit status wears off after a few days and you become an "Experiment". With Intel and Discord done we make you a Guinea Pig or Lab Rat, and that opens our armories.',
          tasks: [
              T('c2a', 'Check that you are on Intel and on Discord. That is what we need to make you a Guinea Pig or Lab Rat.'),
              T('c2b', 'Know what the armory gives you: loan weapons and armour, free beer ALWAYS, free candy ALWAYS, and free Xanax when war prep starts (often 48h before a war, more on that later).', { link: 'https://www.torn.com/factions.php?step=your#/tab=armoury', label: 'Open the armory' }),
              T('c2c', 'Have a look at our training schedule to see which training perks are up.'),
              T('c2d', 'Read the post about our roles, to know who is who.'),
              T('c2e', 'New to Torn? Check our selection of must-read beginner guides.'),
          ] },
        { id: 'c3', title: 'Our war tool: CAT', intro: 'CAT is the war tool we use, a script (TornPDA on phone) or extension (on PC) with a public API key. It works best when EVERYONE is on it. It shows the opponent\'s stats and lets you "call" hits so no one else attacks the same person, which saves a lot of frustration and energy. I know this seems like a lot, but it is definitely worth it!',
          tasks: [
              T('c3a', 'Go to CAT, click the version you want (script for TornPDA, extension for PC) and install it.'),
              T('c3b', 'Go to the faction page: you will see several tabs under the chain/war spaces.'),
              T('c3c', 'Click the settings tab and enter a public API key. Yaaay, you did it!'),
              T('c3d', 'Stuck? On our Discord there is a channel called "script tutorials" with a photo guide on how to install it.'),
              T('c3e', 'Good to know: the leader activates the tool before EACH war, so don\'t worry if it does not seem to work between wars. You can also plan group attacks and call for help with it (which pings Discord).'),
          ] },
        { id: 'c4', title: 'Organized Crimes', intro: 'You are an official member now, which means you can join our OC\'s (Organized Crimes). They make you easy money and give the faction respect, and the higher the level, the higher the pay, so moving up is key! (Crimes open after your first 3 days in the faction.)',
          tasks: [
              T('c4a', 'Open the Organized Crimes page and take a close look at your % in each of the roles.', { link: 'https://www.torn.com/factions.php?step=your&type=12#/tab=crimes', label: 'Open Crimes', fromDay: 3 }),
              T('c4b', 'We only start on level 3 OC\'s, so if you are below 85%, join one of these. See another crime role where you get 70%-85%? Join one of those ;)', { auto: 'oc', fromDay: 3 }),
              T('c4c', 'Don\'t see a crime you normally can take? Ask in faction chat to spawn new OC\'s.'),
              T('c4d', 'Read our forum post about OC\'s.'),
              T('c4e', 'Remember: always be in one, and be in Torn when it ends so no one needs to wait. The WWL script will remind you when you are not in one.'),
          ] },
        { id: 'c5', title: 'Ready for war and chain', intro: 'You made it this far, congrats! That means you are ready for your first war and chain. We always aim for a 1000 chain, and the best practice for chaining is taking part in one. If you are in doubt, just ask in faction chat!',
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
        if (raw) { const c = JSON.parse(raw); if (c && Array.isArray(c.chapters)) return { chapters: c.chapters, custom: true }; }
    } catch (e) { /* default */ }
    return { ...DEFAULT_CONFIG, custom: false };
}
async function doneOf(redis, factionId, playerId) {
    try { const raw = await redis(['HGET', doneKey(factionId), String(playerId)]); return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}

// What WWL can see for a member. `snap` (their own Torn profile) is only given when the member is asking themselves — nobody else's revive
// setting or crime is visible to us, so those two are only ticked when the pupil opens their own page (and stay ticked).
async function autoFacts(redis, factionId, id, tasks, { snap, position }) {
    const want = new Set(tasks.filter(t => t.auto).map(t => t.auto));
    const f = {};
    if (want.has('script')) f.script = Number(await redis(['HGET', seenKey(factionId), String(id)])) > 0;
    if (want.has('hours')) f.hours = !!(await redis(['HEXISTS', hoursKey(factionId), String(id)]));
    if (want.has('timezone')) f.timezone = !!(await redis(['HEXISTS', tzKey(factionId), String(id)]));
    if (want.has('revives') && snap) f.revives = snap.revivable === false;
    if (want.has('oc') && snap) f.oc = !!snap.inOC;
    if (want.has('role')) f.role = true; // checked per task below (the role names differ per task)
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
            return { id: t.id, text: t.text, link: t.link, label: t.label, auto: t.auto, fromDay: t.fromDay, waiting, done: isDone };
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

// ---- To do lines (for member-todo): a pupil gets one line, a mentor one per pupil ----
async function welcomeTodoItems(redis, factionId, playerId, { site, snap, roster }) {
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
        const p = progress(config, done, m ? m.days : null, await autoFacts(redis, factionId, id, tasks, { snap: self ? snap : null, position: m ? m.position : '' }));
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
    const { redis, factionId, playerId, mentorOf, leader, roster, userSnap } = ctx;
    const config = await loadConfig(redis, factionId);
    const allTasks = config.chapters.flatMap(c => c.tasks || []);
    const rosterOf = async id => (await roster()).find(m => m.id === String(id)) || null;

    if (action === 'wel-my') {
        const program = await loadProgram(redis, factionId);
        if (!program.pupils?.[String(playerId)]) return { pupil: false };
        const me = await rosterOf(playerId);
        let done = await doneOf(redis, factionId, playerId);
        const needsSnap = allTasks.some(t => (t.auto === 'revives' || t.auto === 'oc') && !done[t.id]);
        const facts = await autoFacts(redis, factionId, playerId, allTasks, { snap: needsSnap ? await userSnap() : null, position: me ? me.position : '' });
        const p = progress(config, done, me ? me.days : null, facts);
        await persistNew(redis, factionId, playerId, done, p.newly);
        return { pupil: true, days: me ? me.days : null, ...forPupil(p) };
    }
    if (action === 'wel-done') { // a pupil ticks a step of their own (automatic steps tick themselves)
        const program = await loadProgram(redis, factionId);
        if (!program.pupils?.[String(playerId)]) throw new Error('You are not in the mentoring program.');
        const id = String(body.id || '');
        const t = allTasks.find(x => x.id === id);
        if (!t) throw new Error('That step no longer exists.');
        if (t.auto) throw new Error('That one ticks itself when it is done.');
        const me = await rosterOf(playerId);
        const done = await doneOf(redis, factionId, playerId);
        const ch = progress(config, done, me ? me.days : null, null).chapters.find(c => c.tasks.some(x => x.id === id));
        if (ch.locked) throw new Error('Finish the chapter before it first.');
        if (body.done === false) delete done[id]; else done[id] = Math.floor(Date.now() / 1000);
        await redis(['HSET', doneKey(factionId), String(playerId), JSON.stringify(done)]);
        return { ok: true };
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
        const p = progress(config, done, pu ? pu.days : null, await autoFacts(redis, factionId, pupilId, allTasks, { snap: null, position: pu ? pu.position : '' }));
        done = await persistNew(redis, factionId, pupilId, done, p.newly);
        return { days: pu ? pu.days : null, ...p, newly: undefined, lastTick: lastTick(done) || null };
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
            return { id, name: pu.name || (m && m.name) || `#${id}`, mentor: pu.mentorId ? (program.mentors?.[pu.mentorId]?.name || `#${pu.mentorId}`) : '', days: m ? m.days : null, script: !!seen[id], allDone: p.allDone, chapter: p.current + 1, chapters: p.chapters.length, chapterTitle: c ? c.title : '', done: p.chapters.reduce((s, x) => s + x.doneCount, 0), total: p.chapters.reduce((s, x) => s + x.total, 0), lastTick: lastTick(doneBy[id] || {}) || null };
        });
        return { config, pupils, autoKinds: AUTO };
    }
    if (action === 'wel-config-save') {
        const clean = (v, n) => String(v || '').trim().slice(0, n);
        const chapters = (Array.isArray(body.chapters) ? body.chapters : []).slice(0, 10).map((c, i) => ({
            id: /^c[a-z0-9]{1,12}$/.test(c?.id) ? c.id : `c${Date.now().toString(36)}${i}`,
            title: clean(c?.title, 80), intro: clean(c?.intro, 1200),
            tasks: (Array.isArray(c?.tasks) ? c.tasks : []).slice(0, 15).map((t, j) => ({
                id: /^c[a-z0-9]{1,16}$/.test(t?.id) ? t.id : `c${Date.now().toString(36)}${i}${j}`,
                text: clean(t?.text, 600), link: clean(t?.link, 300), label: clean(t?.label, 40),
                auto: Object.keys(AUTO).includes(t?.auto) ? t.auto : '', autoArg: clean(t?.autoArg, 80), fromDay: Math.max(0, Math.min(60, Math.floor(Number(t?.fromDay) || 0))),
            })).filter(t => t.text),
        })).filter(c => c.title);
        await redis(['SET', stepsKey(factionId), JSON.stringify({ chapters })]);
        return { ok: true };
    }
    throw new Error('Unknown action');
}

module.exports = { welHandle, welcomeTodoItems };
