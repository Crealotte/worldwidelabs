// lib/welcome.js — the welcome steps for new recruits (their first days in the faction, like a series of welcome mails): each step is a short
// message with a link (a WWL page such as the Mentoring page, or a forum thread) that shows up from a given day on. Recruits see them on the
// dashboard and in the script's To do; a mentor sees the steps their pupil gets (and which are ticked off) to be able to help.
// Leaders write the steps (Welcome steps page). Torn gives each member's days_in_faction, so a step "from day 1" shows from the second day on.
//
//   wwl:welcome-steps:{faction}  -> { windowDays, steps: [{ id, title, text, day, link, label }] }   (link: a full URL, or a WWL page like "mentoring")
//   wwl:welcome-done:{faction}   -> hash playerId -> JSON { stepId: ticked-at }

const stepsKey = f => `wwl:welcome-steps:${f}`;
const doneKey = f => `wwl:welcome-done:${f}`;

// Starting points to rewrite — used until a leader saves their own.
const DEFAULT_CONFIG = {
    windowDays: 14, // eased in: the old series ran in 5 days, this spreads the same five mails over two weeks, with war and chain last
    steps: [
        { id: 'w1', day: 0, title: 'You are in WWL! Your first things to do', summary: 'Install the script, join Intel and Discord, put your revives off, and say hi in faction chat.',
          text: 'Great, you found your way into World Wide Labs, our faction tool! Your mentor will help you from here, and the next steps show up here one at a time so you are not overwhelmed.\n\nFor now, just these:\n- install the WWL script (the button on your dashboard) so your to-dos show up right inside Torn\n- join Intel (with a limited API key) and come check out our Discord. These two are required to become a Guinea Pig (< lv15) or Lab Rat (> lv15)\n- put your revives off in your [settings](https://www.torn.com/preferences.php#tab=privacy), and only turn them on when you really need them. This prevents bleeding respect during wars when people revive you to hit you again ;)\n- say hi in our faction chat, we don\'t bite!\n\nWe will look if this is completed within your first 24 hours, because these are extremely important to us. Questions? Ask your mentor, or message Leadership or the Researchers (council).\n\nLots of Love, Crea',
          link: '', label: '' },
        { id: 'w2', day: 1, title: 'Your recruit status wears off soon', summary: 'In 2 days you become an Experiment; with Intel and Discord done you become a Guinea Pig or Lab Rat and get the armory.',
          text: 'In 2 days your recruit status will wear off! This means you become an "Experiment". This role gives access to our perks, but not the armory yet. If you are on Intel and Discord we will make you a Guinea Pig or Lab Rat.\n\nWhat does that mean? You get access to our armories:\n- you can loan weapons and armour\n- you can use free beer ALWAYS\n- you can use free candy ALWAYS\n- you can access free Xanax, when war prep starts (often 48h before a war, more on that later ;) )\n\nYou will also be able to do OC\'s (more on that later :D )\n\nWant to know what training perks are up? Check our training schedule. Want to know more about our roles? Check the roles post. Are you new to Torn? Make sure to check out our selection of must-read beginner guides.\n\nLots of Love, Crea',
          link: '', label: '' },
        { id: 'w4', day: 3, title: 'You are an official member: Organized Crimes', summary: 'Join an Organized Crime: start on level 3 if you are below 85%, take roles at 70-85%, and ask for new OCs in chat.',
          text: 'Today is the day you become an official member of our faction! This means you can join our OC\'s (Organized Crimes). Why? Because they make you easy money and give the faction respect!\n\nYou can find them [here](https://www.torn.com/factions.php?step=your&type=12#/tab=crimes). Take a close look at your % in each of the roles:\n- we decided to only start on level 3 OC\'s, so if you are below 85% join one of these\n- do you see another crime role where you get 70%-85%? Join one of those ;)\n- don\'t see a crime you normally can take? Ask in faction chat to spawn new OC\'s\n\nThe higher the level, the higher the pay, so moving up is key! Want more info? Check our forum post on OC\'s.\n\nMost important is to always be in one, and to be in Torn when it ends so no one needs to wait. This is the point where the reminders start when you are not in an OC or not in the right one.\n\nAny questions? Hop in our faction chat and I\'m sure someone will answer.\n\nLots of Love, Crea',
          link: 'https://www.torn.com/factions.php?step=your&type=12#/tab=crimes', label: 'Open Crimes' },
        { id: 'w3', day: 6, title: 'Our war tool: CAT', summary: 'Install CAT (script on TornPDA / extension on PC), then add a public API key in its settings tab.',
          text: 'You are rolling into our faction and have done the other things we asked (if not, we will DM you). It is time to go deeper into the war tool we use: CAT.\n\nThis is a script (TornPDA on phone) or extension (on PC) you need to install and put a public API key in. It is an amazing tool, but it works best when EVERYONE is on it, which is why it gets its own step.\n\n-> go to CAT and click the version you want\n-> install it\n-> go to the faction page, you will see several tabs under the chain/war spaces\n-> click the settings tab\n-> enter a public API key\n-> yaaay, you did it!\n\nThis tool was made by the same developer as Intel. It shows the opponent\'s stats and lets you "call" hits so no one else attacks the same person, which saves a lot of frustration and energy! You can also plan group attacks and call for help (which pings Discord). The leader has to activate the tool before EACH war, so don\'t worry if it does not seem to work yet.\n\nOn our Discord there is a channel called "script tutorials" with a photo guide on how to install it. I know this seems like a lot, but it is definitely worth it! If you need help, ask in faction chat or Discord and we will gladly help you through it.\n\nLots of Love, Crea',
          link: '', label: '' },
        { id: 'w5', day: 10, title: 'Ready for your first war and chain', summary: 'How wars work: war types, stacking 48h before, calling hits in CAT, 10 hits per Xanax. Tell us if you cannot take part.',
          text: 'You made it this far, congrats! That means you are ready for your first war and chain. We always aim for a 1000 chain, and the best practice for chaining is taking part in one.\n\nThere will always be an "Upcoming war against XX" post with the info on whether the war is a:\n- Termed Win\n- Termed Loss\n- Real War\nIt holds what the war will be, what score we need and the rules of that war. This is key information!\n\nFor each war we stack 48h before the start. I expect everyone to have 900 - 1000 energy and 0 drug cooldown, unless you OD.\n\nIt is extremely important to use CAT for calling hits. Also look at the list and the hospitalised people on their side: if not many targets are getting out within 5 minutes, it is key to slow down and only hit at 3:00 on the chain timer so it does not die. If you are in doubt, just ask in faction chat!\n\nFor each Xanax you take out of the armory you are expected to do 10 hits in the war/chain.\n\nIf you for whatever reason cannot take part, let us know in the war post. This is important to plan ahead of time. We also recommend reading the war guide.\n\nLots of Love, Crea',
          link: 'availability', label: 'Open Availability' },
    ],
};

async function loadConfig(redis, factionId) {
    try { const raw = await redis(['GET', stepsKey(factionId)]); if (raw) { const c = JSON.parse(raw); if (c && Array.isArray(c.steps)) return { windowDays: Number(c.windowDays) || 3, steps: c.steps, custom: true }; } } catch (e) { /* default */ }
    return { ...DEFAULT_CONFIG, custom: false };
}
const linkUrl = (link, site) => { link = String(link || '').trim(); if (!link) return null; if (/^https?:\/\//i.test(link)) return link; return site ? `${site}/${link.replace(/^\/+/, '')}` : null; };

// steps that apply to someone who has been in the faction `days` days: inside the recruit window and from their day on
function activeSteps(config, days) {
    if (days == null || days >= config.windowDays) return [];
    return config.steps.filter(s => Number(s.day) <= days).sort((a, b) => Number(a.day) - Number(b.day));
}
async function doneOf(redis, factionId, playerId) {
    try { const raw = await redis(['HGET', doneKey(factionId), String(playerId)]); return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}

// For the To do list: the recruit's own steps they have not ticked off yet.
async function welcomeTodoItems(redis, factionId, playerId, days, site) {
    const config = await loadConfig(redis, factionId);
    const steps = activeSteps(config, days);
    if (!steps.length) return [];
    const done = await doneOf(redis, factionId, playerId);
    return steps.filter(s => !done[s.id]).map(s => ({ id: `welcome-${s.id}`, text: `👋 ${s.title}${s.summary ? ` — ${s.summary}` : ''}`, cta: s.label || 'Read it on WWL', url: linkUrl(s.link, site) || (site ? `${site}/dashboard` : null) }));
}

async function welHandle(action, body, { redis, factionId, playerId, daysInFaction, leader, mentorOf, daysOfMember, recruits }) {
    if (action === 'wel-my') {
        const config = await loadConfig(redis, factionId);
        const steps = activeSteps(config, daysInFaction);
        const done = await doneOf(redis, factionId, playerId);
        return { recruit: daysInFaction != null && daysInFaction < config.windowDays, days: daysInFaction, steps: steps.map(s => ({ ...s, done: !!done[s.id] })) };
    }
    if (action === 'wel-done') {
        const id = String(body.id || '');
        const done = await doneOf(redis, factionId, playerId);
        if (body.done === false) delete done[id]; else done[id] = Math.floor(Date.now() / 1000);
        await redis(['HSET', doneKey(factionId), String(playerId), JSON.stringify(done)]);
        return { ok: true };
    }
    if (action === 'wel-pupil') { // a mentor (or a leader) looks at what a pupil gets and has ticked
        const pupilId = String(body.pupilId || '');
        if (!(await mentorOf(pupilId)) && !(await leader())) throw new Error('That is not one of your pupils.');
        const config = await loadConfig(redis, factionId);
        const days = await daysOfMember(pupilId);
        const steps = activeSteps(config, days);
        const done = await doneOf(redis, factionId, pupilId);
        return { recruit: days != null && days < config.windowDays, days, windowDays: config.windowDays, steps: steps.map(s => ({ ...s, done: !!done[s.id] })), total: config.steps.length };
    }
    // below: leaders only (checked by the caller)
    if (action === 'wel-config-get') {
        const config = await loadConfig(redis, factionId);
        const rec = await recruits(); // [{ id, name, days }] members still inside the window
        const flat = (await redis(['HGETALL', doneKey(factionId)])) || [];
        const doneBy = {};
        for (let i = 0; i < flat.length; i += 2) { try { doneBy[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) { /* skip */ } }
        return { config, recruits: rec.filter(m => m.days < config.windowDays).map(m => ({ ...m, steps: activeSteps(config, m.days).map(s => ({ id: s.id, title: s.title, done: !!(doneBy[m.id] || {})[s.id] })) })) };
    }
    if (action === 'wel-config-save') {
        const steps = (Array.isArray(body.steps) ? body.steps : []).slice(0, 12).map((s, i) => ({
            id: /^w[a-z0-9]{1,12}$/.test(s?.id) ? s.id : `w${Date.now().toString(36)}${i}`,
            day: Math.max(0, Math.min(13, Math.floor(Number(s?.day) || 0))),
            title: String(s?.title || '').trim().slice(0, 80), summary: String(s?.summary || '').trim().slice(0, 200), text: String(s?.text || '').trim().slice(0, 2500),
            link: String(s?.link || '').trim().slice(0, 300), label: String(s?.label || '').trim().slice(0, 40),
        })).filter(s => s.title);
        const windowDays = Math.max(1, Math.min(14, Math.floor(Number(body.windowDays) || 3)));
        await redis(['SET', stepsKey(factionId), JSON.stringify({ windowDays, steps })]);
        return { ok: true };
    }
    throw new Error('Unknown action');
}

module.exports = { welHandle, welcomeTodoItems };
