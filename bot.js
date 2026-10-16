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

// ==== PRANK ====
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

// ========== PRANK ENDPOINTS ==========
app.get('/prank/status', (req, res) => {
    const id = req.query.id;
    if (!id) return res.json({ status: 'error' });
    const status = prankRequests.get(id) || { status: 'pending' };
    res.json(status);
});

// ==== מוגן במפתח סודי ====
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

// ==== חדש: רשימת בקשות ממתינות ====
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

// ========== SELFBOT ==========
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

// ========== BOT ==========
const bot = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers
    ]
});

bot.on('ready', () => {
    console.log(`[+] Bot: ${bot.user.tag}`);
    console.log(`[+] OWNER_ID: ${OWNER_ID}`);
    console.log(`[+] APPROVER_IDS: ${APPROVER_IDS.join(', ') || 'none'}`);
    console.log(`[+] MANAGE_CHANNEL_ID: ${MANAGE_CHANNEL_ID}`);
    console.log(`[+] COMMAND_CHANNEL_ID: ${COMMAND_CHANNEL_ID}`);
    console.log(`[+] CREDITS_CHANNEL_ID: ${CREDITS_CHANNEL_ID}`);
    console.log(`[+] UNLIMITED_IDS: ${UNLIMITED_IDS.join(', ') || 'none'}`);
    console.log(`[+] PRANK_SERVER: ${PRANK_SERVER}`);
    console.log(`[+] PRANK_SECRET: ${PRANK_SECRET ? 'set' : 'MISSING'}`);
});

async function purgeDMMessages(channel) {
    let deleted = 0;
    let lastId = null;

    while (true) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;

        const messages = await channel.messages.fetch(options);
        if (messages.size === 0) break;

        for (const [id, msg] of messages) {
            try {
                await msg.delete();
                deleted++;
                await new Promise(r => setTimeout(r, 500));
            } catch (e) {}
        }

        lastId = messages.last().id;
        if (messages.size < 100) break;
    }

    return deleted;
}

async function sendCreditsPanel(channel) {
    const embed = new EmbedBuilder()
        .setTitle('🎁 Free Gift!')
        .setDescription(`Claim **${DAILY_CREDITS} free credits** every **24 hours**.`)
        .setColor(0x2B2D31);

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('claim_credits')
                .setLabel(`Claim ${DAILY_CREDITS} Credits`)
                .setEmoji('🔔')
                .setStyle(ButtonStyle.Danger)
        );

    await channel.send({ embeds: [embed], components: [row] });
}

async function sendManagePanel(channel) {
    const embed = new EmbedBuilder()
        .setTitle('💳 Credit Manager')
        .setDescription(
            '**נהל קרדיטים למשתמשים**\n\n' +
            '💳 **קבע קרדיטים** — קובע יתרה חדשה\n' +
            '➕ **הוסף קרדיטים** — מוסיף ליתרה קיימת\n' +
            '🔓 **אין סוף** — מדליק/מכבה אין סוף'
        )
        .setColor(0x5865F2)
        .setFooter({ text: `© ${OWNER_NAME}` });

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('menu_set_credits')
                .setLabel('קבע קרדיטים')
                .setEmoji('💳')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('menu_add_credits')
                .setLabel('הוסף קרדיטים')
                .setEmoji('➕')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('menu_toggle_unlimited')
                .setLabel('אין סוף')
                .setStyle(ButtonStyle.Danger)
        );

    await channel.send({ embeds: [embed], components: [row] });
}

bot.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // ==== פקודות prank — עובדות בכל חדר ====
    if (message.content.startsWith('!approve ')) {
        if (!isApprover(message.author.id)) {
            await message.channel.send('❌ אין לך הרשאה').catch(() => {});
            return;
        }
        const id = message.content.substring(9).trim();
        if (!id) {
            await message.channel.send('❌ שימוש: `!approve <id>`').catch(() => {});
            return;
        }
        try {
            const r = await fetch(`${PRANK_SERVER}/prank/approve?id=${encodeURIComponent(id)}&key=${encodeURIComponent(PRANK_SECRET)}`);
            if (r.ok) {
                await message.channel.send(`✅ **אושר**\n🆔 \`${id}\``).catch(() => {});
            } else {
                const t = await r.text();
                await message.channel.send(`❌ שגיאה: ${t}`).catch(() => {});
            }
        } catch (e) {
            await message.channel.send(`❌ שגיאה: ${e.message}`).catch(() => {});
        }
        return;
    }

    if (message.content.startsWith('!deny ')) {
        if (!isApprover(message.author.id)) {
            await message.channel.send('❌ אין לך הרשאה').catch(() => {});
            return;
        }
        const id = message.content.substring(6).trim();
        if (!id) {
            await message.channel.send('❌ שימוש: `!deny <id>`').catch(() => {});
            return;
        }
        try {
            const r = await fetch(`${PRANK_SERVER}/prank/deny?id=${encodeURIComponent(id)}&key=${encodeURIComponent(PRANK_SECRET)}`);
            if (r.ok) {
                await message.channel.send(`❌ **נדחה**\n🆔 \`${id}\``).catch(() => {});
            } else {
                const t = await r.text();
                await message.channel.send(`❌ שגיאה: ${t}`).catch(() => {});
            }
        } catch (e) {
            await message.channel.send(`❌ שגיאה: ${e.message}`).catch(() => {});
        }
        return;
    }

    if (message.content === '!pending') {
        if (!isApprover(message.author.id)) {
            await message.channel.send('❌ אין לך הרשאה').catch(() => {});
            return;
        }
        try {
            const r = await fetch(`${PRANK_SERVER}/prank/pending?key=${encodeURIComponent(PRANK_SECRET)}`);
            const list = await r.json();
            if (!Array.isArray(list) || list.length === 0) {
                await message.channel.send('📭 אין בקשות').catch(() => {});
                return;
            }
            let msg = '**📋 בקשות ממתינות:**\n\n';
            for (const item of list) {
                msg += `🆔 \`${item.id}\` — ${item.status}\n`;
            }
            await message.channel.send(msg).catch(() => {});
        } catch (e) {
            await message.channel.send(`❌ שגיאה: ${e.message}`).catch(() => {});
        }
        return;
    }
    // ==== סוף פקודות prank ====

    if (message.channel.type === 1 && message.content === '!purge') {
        const notification = await message.channel.send('🧹 מוחק הודעות...');
        await new Promise(r => setTimeout(r, 1000));
        const deleted = await purgeDMMessages(message.channel);
        try {
            await notification.edit(`✅ נמחקו **${deleted}** הודעות.`);
        } catch (e) {}
        return;
    }

    const isCommandChannel = message.channel.id === COMMAND_CHANNEL_ID;
    const isCreditsChannel = CREDITS_CHANNEL_ID && message.channel.id === CREDITS_CHANNEL_ID;
    const isManageChannel = MANAGE_CHANNEL_ID && message.channel.id === MANAGE_CHANNEL_ID;

    if (!isCommandChannel && !isCreditsChannel && !isManageChannel) return;

    if (isCreditsChannel) {
        if (message.content === '!credits-panel') {
            await sendCreditsPanel(message.channel);
        }
        return;
    }

    if (isManageChannel) {
        if (!isApprover(message.author.id)) return;

        if (message.content === '!menu' || message.content === '!credits-menu') {
            await sendManagePanel(message.channel);
        }
        return;
    }

    if (message.content === '!panel') {
        const embed = new EmbedBuilder()
            .setAuthor({ name: OWNER_NAME, iconURL: bot.user.displayAvatarURL() })
            .setTitle('🔒 Spam Panel')
            .setDescription(
                '**לחץ על `Spam` כדי לשלוח SMS**\n\n' +
                '**איך זה עובד:**\n' +
                '1️⃣ לחץ על כפתור `Spam` למטה\n' +
                '2️⃣ מלא את הטופס: מספר טלפון + קרדיטים\n' +
                '3️⃣ בחר שעה (אופציונלי) — אם ריק, ישלח מיד\n' +
                '4️⃣ **הבקשה תישלח לאישור הבעלים**\n\n' +
                '💳 **הקרדיטים שלך מחויבים מהחשבון**'
            )
            .setColor(0x5865F2)
            .setFooter({ text: `© ${OWNER_NAME} • מערכת הספאם האוטומטית` });

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('spam_button')
                    .setLabel('Spam')
                    .setEmoji('🚀')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('list_button')
                    .setLabel('רשימה')
                    .setEmoji('📋')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('my_credits')
                    .setLabel('הקרדיטים שלי')
                    .setEmoji('💳')
                    .setStyle(ButtonStyle.Secondary)
            );

        await message.channel.send({ embeds: [embed], components: [row] });
    }

    if (message.content === '!help') {
        await message.channel.send(
            '**🤖 פקודות:**\n\n' +
            '`!panel` — שלח פאנל ספאם\n' +
            '`!credits-panel` — שלח פאנל קרדיטים יומי\n' +
            '`!menu` — שלח פאנל ניהול (בחדר manage)\n' +
            '`!transfer @user <amount>` — העבר קרדיטים\n' +
            '`!list` — הצג ספאמרים\n' +
            '`!remove <id>` — מחק ספאמר\n' +
            '`!approve <id>` — אשר בקשת prank\n' +
            '`!deny <id>` — דחה בקשת prank\n' +
            '`!pending` — הצג בקשות prank ממתינות'
        );
    }

    if (message.content.startsWith('!transfer ')) {
        const parts = message.content.split(/\s+/);
        const target = message.mentions.users.first();
        const amount = parseInt(parts[2]);

        if (!target || isNaN(amount) || amount <= 0) {
            await message.channel.send('❌ שימוש: `!transfer @user <amount>`');
            return;
        }

        if (target.id === message.author.id) {
            await message.channel.send('❌ לא ניתן להעביר לעצמך');
            return;
        }

        const sender = getUser(message.author.id);
        const senderUnlimited = hasUnlimited(message.author.id);

        if (!senderUnlimited && sender.credits < amount) {
            await message.channel.send(`❌ אין לך מספיק קרדיטים\n💳 יש לך: **${sender.credits}**`);
            return;
        }

        const receiver = getUser(target.id);

        if (!senderUnlimited) sender.credits -= amount;
        receiver.credits += amount;
        saveUsers();

        await message.channel.send(
            `✅ **העברה בוצעה!**\n\n` +
            `📤 שלחת: **${amount}** קרדיטים ל-${target.tag}\n` +
            (senderUnlimited ? `💳 היתרה שלך: **∞**` : `💳 היתרה שלך: **${sender.credits}**`) +
            `\n💳 היתרה של ${target.tag}: **${receiver.credits}**`
        );
    }

    if (message.content === '!list') {
        if (Object.keys(spammers).length === 0) {
            await message.channel.send('📭 אין ספאמרים');
            return;
        }
        let msg = '**📋 רשימת ספאמרים:**\n\n';
        for (const [id, sp] of Object.entries(spammers)) {
            const status = sp.enabled ? '✅' : '❌';
            const time = sp.hour !== null ? `${String(sp.hour).padStart(2, '0')}:${String(sp.minute).padStart(2, '0')}` : 'מיידי';
            msg += `**${id}** ${status}\n  📱 ${sp.phone} | 💳 ${sp.credits} | 🕐 ${time}\n\n`;
        }
        await message.channel.send(msg);
    }

    if (message.content.startsWith('!remove ')) {
        const id = message.content.substring(8).trim();
        if (spammers[id]) {
            delete spammers[id];
            saveSpammers();
            await message.channel.send(`🗑️ \`${id}\` נמחק`);
        } else {
            await message.channel.send(`❌ לא נמצא`);
        }
    }
});

// ========== INTERACTIONS ==========
bot.on('interactionCreate', async (interaction) => {

    if (interaction.isButton() && interaction.customId === 'menu_set_credits') {
        if (!isApprover(interaction.user.id)) {
            await interaction.reply({ content: '❌ אין לך הרשאה', ephemeral: true });
            return;
        }

        const modal = new ModalBuilder()
            .setCustomId('menu_set_credits_modal')
            .setTitle('קבע קרדיטים');

        const nameInput = new TextInputBuilder()
            .setCustomId('name')
            .setLabel('שם המשתמש')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('MRzeno')
            .setRequired(true)
            .setMaxLength(50);

        const amountInput = new TextInputBuilder()
            .setCustomId('amount')
            .setLabel('כמות קרדיטים')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('100')
            .setRequired(true)
            .setMaxLength(6);

        modal.addComponents(
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(amountInput)
        );

        await interaction.showModal(modal);
        return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'menu_set_credits_modal') {
        if (!isApprover(interaction.user.id)) return;

        const name = interaction.fields.getTextInputValue('name').trim();
        const amountRaw = interaction.fields.getTextInputValue('amount').trim();

        if (!/^\d{1,6}$/.test(amountRaw)) {
            await interaction.reply({ content: '❌ כמות חייבת להיות מספר בלבד', ephemeral: true });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        const guild = interaction.guild;
        const member = await findUserByName(guild, name);

        if (!member) {
            await interaction.editReply({ content: `❌ לא מצאתי משתמש בשם \`${name}\`` });
            return;
        }

        const amount = parseInt(amountRaw);
        const u = getUser(member.id);
        u.credits = amount;
        saveUsers();

        await interaction.editReply({
            content: `✅ **קרדיטים נקבעו**\n\n👤 ${member.user.tag}\n💳 **${amount}** קרדיטים`
        });
        return;
    }

    if (interaction.isButton() && interaction.customId === 'menu_add_credits') {
        if (!isApprover(interaction.user.id)) {
            await interaction.reply({ content: '
