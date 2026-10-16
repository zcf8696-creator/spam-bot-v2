const { Client: SelfbotClient } = require('discord.js-selfbot-v13');
const { Client, GatewayIntentBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const express = require('express');

const SELFBOT_TOKEN = process.env.DISCORD_TOKEN;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;
const MESSAGE_ID = process.env.MESSAGE_ID;
const COMMAND_CHANNEL_ID = process.env.COMMAND_CHANNEL_ID;
const FEEDBACK_CHANNEL_ID = process.env.FEEDBACK_CHANNEL_ID;
const CREDITS_CHANNEL_ID = process.env.CREDITS_CHANNEL_ID;
const MANAGE_CHANNEL_ID = process.env.MANAGE_CHANNEL_ID;
const OWNER_ID = process.env.OWNER_ID;
const APPROVER_IDS = (process.env.APPROVER_IDS || '').split(',').map(id => id.trim()).filter(id => id);
const UNLIMITED_IDS = (process.env.UNLIMITED_IDS || '').split(',').map(id => id.trim()).filter(id => id);
const OWNER_NAME = 'ᴹᴿZENO亗';
const TIMEZONE = process.env.TIMEZONE || 'Asia/Jerusalem';
const PORT = process.env.PORT || 8080;
const SPAMMERS_FILE = 'spammers.json';
const USERS_FILE = 'users.json';
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 20 * 1000;
const DAILY_CREDITS = 5;
const CREDITS_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const PRANK_SECRET = process.env.PRANK_SECRET || 'CHANGE_ME_LONG_RANDOM';
const PRANK_SERVER = process.env.PRANK_SERVER || 'https://spam-bot-v2.onrender.com';

const pendingRequests = new Map();
const cooldowns = new Map();
const prankRequests = new Map();

function getAllApprovers() {
    const set = new Set([OWNER_ID, ...APPROVER_IDS]);
    return [...set];
}

function isApprover(userId) {
    return userId === OWNER_ID || APPROVER_IDS.includes(userId);
}

function loadJSON(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return {};
    }
}
function saveJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

let spammers = loadJSON(SPAMMERS_FILE);
let users = loadJSON(USERS_FILE);

function saveSpammers() { saveJSON(SPAMMERS_FILE, spammers); }
function saveUsers() { saveJSON(USERS_FILE, users); }

function getUser(userId) {
    if (!users[userId]) {
        users[userId] = { credits: 0, lastClaim: 0, totalClaimed: 0 };
    }
    return users[userId];
}

function hasUnlimited(userId) {
    if (userId === OWNER_ID) return true;
    return UNLIMITED_IDS.includes(userId);
}

async function findUserByName(guild, name) {
    const cleanName = name.replace(/^@/, '').trim().toLowerCase();

    let member = guild.members.cache.find(m =>
        m.user.username.toLowerCase() === cleanName ||
        m.user.tag.toLowerCase() === cleanName ||
        m.displayName.toLowerCase() === cleanName
    );

    if (member) return member;

    try {
        const members = await guild.members.fetch();
        member = members.find(m =>
            m.user.username.toLowerCase() === cleanName ||
            m.user.tag.toLowerCase() === cleanName ||
            m.displayName.toLowerCase() === cleanName
        );
        if (member) return member;
    } catch (e) {
        console.log(`[-] Failed to fetch members: ${e.message}`);
    }

    member = guild.members.cache.find(m =>
        m.user.username.toLowerCase().includes(cleanName) ||
        m.displayName.toLowerCase().includes(cleanName)
    );

    return member || null;
}

function isValidPhone(phone) {
    const cleaned = phone.replace(/[\s\-()]/g, '');
    return /^[0-9+]{9,15}$/.test(cleaned) && /^[0+]/.test(cleaned);
}
function isValidCredits(credits) {
    return /^\d{1,4}$/.test(credits) && parseInt(credits) >= 1 && parseInt(credits) <= 1000;
}
function isValidHour(hour) {
    return /^\d{1,2}$/.test(hour) && parseInt(hour) >= 0 && parseInt(hour) <= 23;
}
function isValidMinute(minute) {
    return /^\d{1,2}$/.test(minute) && parseInt(minute) >= 0 && parseInt(minute) <= 59;
}

const app = express();
app.get('/', (req, res) => res.send('OK'));
app.get('/health', (req, res) => res.send('OK'));

app.get('/prank/status', (req, res) => {
    const id = req.query.id;
    if (!id) return res.json({ status: 'error' });
    const status = prankRequests.get(id) || { status: 'pending' };
    res.json(status);
});

app.get('/prank/approve', (req, res) => {
    const { id, key } = req.query;
    if (!id) return res.status(400).send('Missing ID');
    if (key !== PRANK_SECRET) return res.status(403).send('Forbidden');
    prankRequests.set(id, { status: 'approved', code: 'אני זונה של ZENO' });
    res.send('Approved');
});

app.get('/prank/deny', (req, res) => {
    const { id, key } = req.query;
    if (!id) return res.status(400).send('Missing ID');
    if (key !== PRANK_SECRET) return res.status(403).send('Forbidden');
    prankRequests.set(id, { status: 'denied' });
    res.send('Denied');
});

app.get('/prank/pending', (req, res) => {
    const { key } = req.query;
    if (key !== PRANK_SECRET) return res.status(403).send('Forbidden');
    const list = [];
    for (const [id, data] of prankRequests.entries()) {
        list.push({ id, status: data.status });
    }
    res.json(list);
});

app.listen(PORT, () => console.log(`[+] HTTP server running on port ${PORT}`));

const selfbot = new SelfbotClient({ checkUpdate: false });

async function showSpamProgress(editFunc, phone, credits) {
    const totalSeconds = credits * 25;
    const startTime = Date.now();
    const endTime = startTime + totalSeconds * 1000;

    const createEmbed = (timeLeft, finished = false) => {
        const elapsed = (Date.now() - startTime) / 1000;
        const success = Math.max(0, Math.floor(elapsed * 0.7));

        const embed = new EmbedBuilder()
            .setTitle(finished ? '✅ Spam Finished' : '🚀 Spam in Progress')
            .addFields(
                { name: '🎯 Target', value: phone, inline: true },
                {
                    name: finished ? '⏱️ Total Time' : '⏱️ Time Left',
                    value: finished ? `${totalSeconds} Sec` : `${timeLeft} Sec`,
                    inline: true
                }
            )
            .setColor(finished ? 0x43b581 : 0xFF6B00);

        if (finished) {
            const feedbackText = FEEDBACK_CHANNEL_ID
                ? `נשמח שתרשום לנו את דעתך על הספאמר בחדר <#${FEEDBACK_CHANNEL_ID}>`
                : 'נשמח שתרשום לנו את דעתך על הספאמר בחדר feedback';

            embed.addFields(
                {
                    name: '📊 Stats',
                    value: `✅ Success: **${success}**\n💳 Credits Used: **${credits}**\n⏱️ Total: **${totalSeconds} sec**`,
                    inline: false
                },
                {
                    name: '⭐ דעתך חשובה לנו',
                    value: feedbackText,
                    inline: false
                }
            );
            embed.setFooter({ text: `© ${OWNER_NAME}` });
        } else {
            embed.addFields({
                name: '📊 Stats',
                value: `✅ Success: **${success}**\n💳 Credits: **${credits}**`,
                inline: false
            });
        }
        return embed;
    };

    try {
        await editFunc({ embeds: [createEmbed(totalSeconds)], components: [] });

        const interval = setInterval(async () => {
            const timeLeft = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));

            if (timeLeft <= 0) {
                clearInterval(interval);
                try {
                    await editFunc({ embeds: [createEmbed(0, true)], components: [] });
                } catch (e) {}
                return;
            }

            try {
                await editFunc({ embeds: [createEmbed(timeLeft)], components: [] });
            } catch (e) {}
        }, 2000);
    } catch (e) {
        console.log(`[-] Progress error: ${e.message}`);
    }
}

async function doSpam(phone, credits) {
    try {
        console.log(`[+] Spam: ${phone} | ${credits} credits`);
        const guild = selfbot.guilds.cache.get(GUILD_ID);
        if (!guild) return '❌ השרת לא נמצא';
        const channel = guild.channels.cache.get(CHANNEL_ID);
        if (!channel) return '❌ החדר לא נמצא';

        const message = await channel.messages.fetch(MESSAGE_ID);
        if (!message) return '❌ ההודעה לא נמצאה';

        let spamButton = null;
        for (const row of message.components) {
            for (const comp of row.components) {
                if (comp.label && comp.label.includes('Spam')) {
                    spamButton = comp;
                    break;
                }
            }
            if (spamButton) break;
        }
        if (!spamButton) return '❌ הכפתור לא נמצא';

        const modalPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
            selfbot.once('interactionModalCreate', (m) => {
                clearTimeout(timeout);
                resolve(m);
            });
        });

        await message.clickButton(spamButton.customId);
        const modal = await modalPromise;

        let fieldIndex = 0;
        for (const row of modal.components) {
            for (const comp of row.components) {
                if (comp.type === 'TEXT_INPUT' || comp.type === 4) {
                    if (fieldIndex === 0) comp.setValue(phone);
                    else if (fieldIndex === 1) comp.setValue(String(credits));
                    fieldIndex++;
                }
            }
        }

        await modal.reply();
        console.log(`[+] Spam submitted!`);
        return `✅ ספאם בוצע! ${phone} | ${credits}`;
    } catch (e) {
        console.log(`[-] Error: ${e.message}`);
        return `❌ שגיאה: ${e.message}`;
    }
}

setInterval(async () => {
    const now = new Date();
    const tz = new Intl.DateTimeFormat('en-US', {
        timeZone: TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(now);
    const [hour, minute] = tz.split(':').map(Number);

    for (const [id, sp] of Object.entries(spammers)) {
        if (!sp.enabled) continue;
        if (sp.lastRun && Date.now() - sp.lastRun < 5 * 60 * 1000) continue;
        if (sp.hour === hour && sp.minute === minute) {
            console.log(`[+] Scheduled: ${id}`);
            const result = await doSpam(sp.phone, sp.credits);
            sp.lastRun = Date.now();
            saveSpammers();

            try {
                if (sp.ownerId) {
                    const owner = await bot.users.fetch(sp.ownerId);
                    await owner.send(`⏰ **ספאם מתוזמן בוצע!**\n\n🆔 \`${id}\`\n📱 ${sp.phone}\n💳 ${sp.credits}\n\n${result}`);
                }
            } catch (e) {}
        }
    }
}, 60000);

selfbot.on('ready', () => {
    console.log(`[+] Selfbot: ${selfbot.user.tag}`);
});
