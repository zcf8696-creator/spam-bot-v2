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
const OWNER_ID = process.env.OWNER_ID;
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

const pendingRequests = new Map();
const cooldowns = new Map();

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
        GatewayIntentBits.DirectMessages
    ]
});

bot.on('ready', () => {
    console.log(`[+] Bot: ${bot.user.tag}`);
    console.log(`[+] Owner: ${OWNER_ID}`);
    console.log(`[+] Unlimited users: ${UNLIMITED_IDS.join(', ') || 'none'}`);
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

bot.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // ===== פקודת purge ב-DM =====
    if (message.channel.type === 1 && message.content === '!purge') {
        const notification = await message.channel.send('🧹 מוחק הודעות...');
        await new Promise(r => setTimeout(r, 1000));
        const deleted = await purgeDMMessages(message.channel);
        try {
            await notification.edit(`✅ נמחקו **${deleted}** הודעות.`);
        } catch (e) {}
        return;
    }

    // ===== בדיקת חדרים =====
    const isCommandChannel = message.channel.id === COMMAND_CHANNEL_ID;
    const isCreditsChannel = CREDITS_CHANNEL_ID && message.channel.id === CREDITS_CHANNEL_ID;

    if (!isCommandChannel && !isCreditsChannel) return;

    // ===== פקודות בחדר קרדיטים =====
    if (isCreditsChannel) {
        if (message.content === '!credits-panel') {
            await sendCreditsPanel(message.channel);
        }
        return;
    }

    // ===== פקודות בחדר הראשי =====
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
            '`!panel` — שלח פאנל עם כפתורים\n' +
            '`!credits-panel` — שלח פאנל קרדיטים יומי\n' +
            '`!manage @user` — נהל קרדיטים של משתמש (בעלים)\n' +
            '`!give <@user> <amount>` — תן קרדיטים (בעלים)\n' +
            '`!transfer <@user> <amount>` — העבר קרדיטים מהחשבון שלך\n' +
            '`!list` — הצג את כל הספאמרים\n' +
            '`!remove <id>` — מחק ספאמר'
        );
    }

    // ===== !manage @user =====
    if (message.content.startsWith('!manage ')) {
        if (message.author.id !== OWNER_ID) {
            await message.channel.send('❌ רק הבעלים יכול להשתמש בפקודה הזו');
            return;
        }

        const target = message.mentions.users.first();
        if (!target) {
            await message.channel.send('❌ שימוש: `!manage @user`');
            return;
        }

        const u = getUser(target.id);
        const isUnlimited = hasUnlimited(target.id);

        const embed = new EmbedBuilder()
            .setTitle(`👤 ניהול קרדיטים — ${target.tag}`)
            .setDescription(
                `**🆔 ID:** \`${target.id}\`\n` +
                `**💳 יתרה:** ${isUnlimited ? '∞ **אין סוף**' : `**${u.credits}** קרדיטים`}\n` +
                `**📊 סה"כ נצבר:** **${u.totalClaimed || 0}**\n\n` +
                `בחר פעולה:`
            )
            .setColor(0x5865F2)
            .setFooter({ text: `© ${OWNER_NAME}` });

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`set_credits_${target.id}`)
                    .setLabel('💳 קבע קרדיטים')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`toggle_unlimited_${target.id}`)
                    .setLabel(isUnlimited ? '∞ הסר אין סוף' : '∞ הוסף אין סוף')
                    .setStyle(isUnlimited ? ButtonStyle.Danger : ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`add_credits_${target.id}`)
                    .setLabel('➕ הוסף קרדיטים')
                    .setStyle(ButtonStyle.Secondary)
            );

        await message.channel.send({ embeds: [embed], components: [row] });
        return;
    }

    // ===== !give =====
    if (message.content.startsWith('!give ')) {
        if (!hasUnlimited(message.author.id)) {
            await message.channel.send('❌ רק הבעלים או מורשים יכולים להשתמש בפקודה הזו');
            return;
        }
        const parts = message.content.split(/\s+/);
        const target = message.mentions.users.first();
        const amount = parseInt(parts[2]);

        if (!target || isNaN(amount) || amount <= 0) {
            await message.channel.send('❌ שימוש: `!give @user <amount>`');
            return;
        }

        const u = getUser(target.id);
        u.credits += amount;
        saveUsers();

        await message.channel.send(`✅ נתת **${amount}** קרדיטים ל-${target.tag}\n💳 סה"כ: **${u.credits}**`);
    }

    // ===== !transfer =====
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

        if (!senderUnlimited) {
            sender.credits -= amount;
        }
        receiver.credits += amount;
        saveUsers();

        await message.channel.send(
            `✅ **העברה בוצעה!**\n\n` +
            `📤 שלחת: **${amount}** קרדיטים ל-${target.tag}\n` +
            (senderUnlimited
                ? `💳 היתרה שלך: **∞**`
                : `💳 היתרה שלך: **${sender.credits}**`) +
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

    // ===== Claim Credits =====
    if (interaction.isButton() && interaction.customId === 'claim_credits') {
        if (hasUnlimited(interaction.user.id)) {
            const embed = new EmbedBuilder()
                .setTitle('∞ Unlimited Credits')
                .setDescription('יש לך **אין סוף קרדיטים**. אין צורך לקליים.')
                .setColor(0x2B2D31);

            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        const u = getUser(interaction.user.id);
        const now = Date.now();
        const timeSinceClaim = now - (u.lastClaim || 0);

        if (timeSinceClaim < CREDITS_COOLDOWN_MS) {
            const remaining = CREDITS_COOLDOWN_MS - timeSinceClaim;
            const hours = Math.floor(remaining / (60 * 60 * 1000));
            const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

            const embed = new EmbedBuilder()
                .setTitle('⏳ Already claimed today')
                .setDescription(`Come back in **${hours}h ${minutes}m**`)
                .setColor(0x2B2D31);

            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        u.credits += DAILY_CREDITS;
        u.lastClaim = now;
        u.totalClaimed = (u.totalClaimed || 0) + DAILY_CREDITS;
        saveUsers();

        const embed = new EmbedBuilder()
            .setTitle(`🎁 +${DAILY_CREDITS} Credits!`)
            .setDescription(
                `New balance: **${u.credits}** credits\n` +
                `Come back tomorrow!`
            )
            .setColor(0x2B2D31);

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
    }

    // ===== הקרדיטים שלי =====
    if (interaction.isButton() && interaction.customId === 'my_credits') {
        if (hasUnlimited(interaction.user.id)) {
            const embed = new EmbedBuilder()
                .setTitle('💳 הקרדיטים שלי')
                .setDescription('∞ **אין סוף קרדיטים**')
                .setColor(0x43b581)
                .setFooter({ text: `© ${OWNER_NAME}` });

            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        const u = getUser(interaction.user.id);
        const now = Date.now();
        const timeSinceClaim = now - (u.lastClaim || 0);
        const canClaim = timeSinceClaim >= CREDITS_COOLDOWN_MS;

        let nextClaim = 'זמין עכשיו! 🎁';
        if (!canClaim) {
            const remaining = CREDITS_COOLDOWN_MS - timeSinceClaim;
            const hours = Math.floor(remaining / (60 * 60 * 1000));
            const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
            nextClaim = `בעוד **${hours} שעות ו-${minutes} דקות**`;
        }

        const embed = new EmbedBuilder()
            .setTitle('💳 הקרדיטים שלי')
            .addFields(
                { name: '💰 יתרה', value: `**${u.credits}** קרדיטים`, inline: true },
                { name: '📊 סה"כ נצבר', value: `**${u.totalClaimed || 0}**`, inline: true },
                { name: '⏰ Claim הבא', value: nextClaim, inline: false }
            )
            .setColor(0x43b581)
            .setFooter({ text: `© ${OWNER_NAME}` });

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
    }

    // ===== כפתור Spam =====
    if (interaction.isButton() && interaction.customId === 'spam_button') {
        const now = Date.now();
        const lastUse = cooldowns.get(interaction.user.id) || 0;

        if (now - lastUse < COOLDOWN_MS) {
            const remaining = Math.ceil((COOLDOWN_MS - (now - lastUse)) / 1000);
            await interaction.reply({
                content: `⏳ **המתן ${remaining} שניות** לפני בקשה נוספת.`,
                ephemeral: true
            });
            return;
        }

        cooldowns.set(interaction.user.id, now);

        const modal = new ModalBuilder()
            .setCustomId('spam_modal')
            .setTitle('Spam-SMS');

        const phoneInput = new TextInputBuilder()
            .setCustomId('phone')
            .setLabel('מספר טלפון (ספרות בלבד)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('0501234567')
            .setRequired(true)
            .setMaxLength(15);

        const creditsInput = new TextInputBuilder()
            .setCustomId('credits')
            .setLabel('קרדיטים (מספרים בלבד)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('1')
            .setRequired(true)
            .setMaxLength(4);

        const hourInput = new TextInputBuilder()
            .setCustomId('hour')
            .setLabel('שעה 0-23 (מספרים בלבד)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('14')
            .setRequired(false)
            .setMaxLength(2);

        const minuteInput = new TextInputBuilder()
            .setCustomId('minute')
            .setLabel('דקה 0-59 (מספרים בלבד)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('30')
            .setRequired(false)
            .setMaxLength(2);

        modal.addComponents(
            new ActionRowBuilder().addComponents(phoneInput),
            new ActionRowBuilder().addComponents(creditsInput),
            new ActionRowBuilder().addComponents(hourInput),
            new ActionRowBuilder().addComponents(minuteInput)
        );

        await interaction.showModal(modal);
        return;
    }

    // ===== טופס Spam =====
    if (interaction.isModalSubmit() && interaction.customId === 'spam_modal') {
        try {
            const phone = interaction.fields.getTextInputValue('phone').trim();
            const credits = interaction.fields.getTextInputValue('credits').trim();
            const hourRaw = interaction.fields.getTextInputValue('hour').trim();
            const minuteRaw = interaction.fields.getTextInputValue('minute').trim();

            await interaction.deferReply({ ephemeral: true });

            if (!isValidPhone(phone)) {
                await interaction.editReply({
                    content: '❌ **מספר טלפון לא תקין**\n\nהמספר חייב להכיל **ספרות בלבד** (9-15 ספרות).\nדוגמה: `0501234567`'
                });
                return;
            }

            if (!isValidCredits(credits)) {
                await interaction.editReply({
                    content: '❌ **קרדיטים לא תקינים**\n\nהקרדיטים חייבים להיות **מספרים בלבד** בין 1 ל-1000.'
                });
                return;
            }

            if (hourRaw && !isValidHour(hourRaw)) {
                await interaction.editReply({
                    content: '❌ **שעה לא תקינה**\n\nהשעה חייבת להיות **מספרים בלבד** בין 0 ל-23.'
                });
                return;
            }

            if (minuteRaw && !isValidMinute(minuteRaw)) {
                await interaction.editReply({
                    content: '❌ **דקה לא תקינה**\n\nהדקה חייבת להיות **מספרים בלבד** בין 0 ל-59.'
                });
                return;
            }

            const u = getUser(interaction.user.id);
            const creditsNum = parseInt(credits);

            if (!hasUnlimited(interaction.user.id) && u.credits < creditsNum) {
                await interaction.editReply({
                    content: `❌ **אין לך מספיק קרדיטים**\n\n💳 יש לך: **${u.credits}**\n💳 צריך: **${creditsNum}**\n\n🎁 לך ל-<#${CREDITS_CHANNEL_ID}> כדי לקבל קרדיטים חינם.`
                });
                return;
            }

            if (!hourRaw || !minuteRaw) {
                await requestApproval(interaction, phone, credits, false, null);
                return;
            }

            const hour = parseInt(hourRaw);
            const minute = parseInt(minuteRaw);

            await requestApproval(interaction, phone, credits, true, null, hour, minute);
        } catch (e) {
            console.log(`[-] Modal submit error: ${e.message}`);
        }
        return;
    }

    // ===== רשימה =====
    if (interaction.isButton() && interaction.customId === 'list_button') {
        const userSpammers = Object.entries(spammers).filter(([id, sp]) => sp.ownerId === interaction.user.id);

        if (userSpammers.length === 0) {
            await interaction.reply({ content: '📭 אין לך ספאמרים', ephemeral: true });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        let count = 0;
        for (const [id, sp] of userSpammers) {
            const status = sp.enabled ? '✅ פעיל' : '❌ כבוי';
            const time = sp.hour !== null ? `${String(sp.hour).padStart(2, '0')}:${String(sp.minute).padStart(2, '0')}` : 'מיידי';

            const embed = new EmbedBuilder()
                .setTitle(`📱 ${id}`)
                .setDescription(
                    `**מספר:** ${sp.phone}\n` +
                    `**קרדיטים:** ${sp.credits}\n` +
                    `**שעה:** ${time}\n` +
                    `**סטטוס:** ${status}`
                )
                .setColor(sp.enabled ? 0x43b581 : 0x99aab5);

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`run_now_${id}`)
                        .setLabel('🚀 הפעל עכשיו')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`del_spam_${id}`)
                        .setLabel('🗑️ בטל')
                        .setStyle(ButtonStyle.Danger)
                );

            await interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });
            count++;

            if (count >= 5) break;
        }
        return;
    }

    // ===== הפעל עכשיו =====
    if (interaction.isButton() && interaction.customId.startsWith('run_now_')) {
        const id = interaction.customId.substring(8);

        if (!spammers[id]) {
            await interaction.reply({ content: `❌ \`${id}\` לא נמצא`, ephemeral: true });
            return;
        }

        if (spammers[id].ownerId !== interaction.user.id) {
            await interaction.reply({ content: '❌ זה לא הספאמר שלך', ephemeral: true });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        const sp = spammers[id];
        await requestApproval(interaction, sp.phone, sp.credits, false, null);
        return;
    }

    // ===== מחק ספאמר =====
    if (interaction.isButton() && interaction.customId.startsWith('del_spam_')) {
        const id = interaction.customId.substring(9);

        if (!spammers[id]) {
            await interaction.reply({ content: `❌ \`${id}\` לא נמצא`, ephemeral: true });
            return;
        }

        if (spammers[id].ownerId !== interaction.user.id) {
            await interaction.reply({ content: '❌ זה לא הספאמר שלך', ephemeral: true });
            return;
        }

        delete spammers[id];
        saveSpammers();

        await interaction.reply({
            content: `🗑️ ספאמר \`${id}\` **בוטל ונמחק**.`,
            ephemeral: true
        });
        return;
    }

    // ===== כפתור: קבע קרדיטים =====
    if (interaction.isButton() && interaction.customId.startsWith('set_credits_')) {
        if (interaction.user.id !== OWNER_ID) {
            await interaction.reply({ content: '❌ אין לך הרשאה', ephemeral: true });
            return;
        }

        const targetId = interaction.customId.substring(12);

        const modal = new ModalBuilder()
            .setCustomId(`set_credits_modal_${targetId}`)
            .setTitle('קבע קרדיטים');

        const amountInput = new TextInputBuilder()
            .setCustomId('amount')
            .setLabel('מספר קרדיטים (0 = איפוס)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('100')
            .setRequired(true)
            .setMaxLength(6);

        modal.addComponents(new ActionRowBuilder().addComponents(amountInput));

        await interaction.showModal(modal);
        return;
    }

    // ===== טופס: קבע קרדיטים =====
    if (interaction.isModalSubmit() && interaction.customId.startsWith('set_credits_modal_')) {
        if (interaction.user.id !== OWNER_ID) {
            await interaction.reply({ content: '❌ אין לך הרשאה', ephemeral: true });
            return;
        }

        const targetId = interaction.customId.substring(18);
        const amountRaw = interaction.fields.getTextInputValue('amount').trim();

        if (!/^\d{1,6}$/.test(amountRaw)) {
            await interaction.reply({ content: '❌ חייב להיות מספר בלבד', ephemeral: true });
            return;
        }

        const amount = parseInt(amountRaw);
        const u = getUser(targetId);
        u.credits = amount;
        saveUsers();

        await interaction.reply({
            content: `✅ **קרדיטים נקבעו**\n\n<@${targetId}> — **${amount}** קרדיטים`,
            ephemeral: true
        });
        return;
    }

    // ===== כפתור: הוסף קרדיטים =====
    if (interaction.isButton() && interaction.customId.startsWith('add_credits_')) {
        if (interaction.user.id !== OWNER_ID) {
            await interaction.reply({ content: '❌ אין לך הרשאה', ephemeral: true });
            return;
        }

        const targetId = interaction.customId.substring(12);

        const modal = new ModalBuilder()
            .setCustomId(`add_credits_modal_${targetId}`)
            .setTitle('הוסף קרדיטים');

        const amountInput = new TextInputBuilder()
            .setCustomId('amount')
            .setLabel('כמה להוסיף?')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('50')
            .setRequired(true)
            .setMaxLength(6);

        modal.addComponents(new ActionRowBuilder().addComponents(amountInput));

        await interaction.showModal(modal);
        return;
    }

    // ===== טופס: הוסף קרדיטים =====
    if (interaction.isModalSubmit() && interaction.customId.startsWith('add_credits_modal_')) {
        if (interaction.user.id !== OWNER_ID) {
            await interaction.reply({ content: '❌ אין לך הרשאה', ephemeral: true });
            return;
        }

        const targetId = interaction.customId.substring(18);
        const amountRaw = interaction.fields.getTextInputValue('amount').trim();

        if (!/^\d{1,6}$/.test(amountRaw)) {
            await interaction.reply({ content: '❌ חייב להיות מספר בלבד', ephemeral: true });
            return;
        }

        const amount = parseInt(amountRaw);
        const u = getUser(targetId);
        u.credits += amount;
        saveUsers();

        await interaction.reply({
            content: `✅ **נוספו ${amount} קרדיטים**\n\n<@${targetId}> — סה"כ: **${u.credits}**`,
            ephemeral: true
        });
        return;
    }

    // ===== כפתור: אין סוף =====
    if (interaction.isButton() && interaction.customId.startsWith('toggle_unlimited_')) {
        if (interaction.user.id !== OWNER_ID) {
            await interaction.reply({ content: '❌ אין לך הרשאה', ephemeral: true });
            return;
        }

        const targetId = interaction.customId.substring(17);

        if (targetId === OWNER_ID) {
            await interaction.reply({ content: '❌ לך כבר יש אין סוף', ephemeral: true });
            return;
        }

        const idx = UNLIMITED_IDS.indexOf(targetId);
        const target = await bot.users.fetch(targetId);

        if (idx !== -1) {
            UNLIMITED_IDS.splice(idx, 1);
            await interaction.reply({
                content: `❌ **הוסר אין סוף**\n\n${target.tag} — חזר לקרדיטים רגילים`,
                ephemeral: true
            });
        } else {
            UNLIMITED_IDS.push(targetId);
            await interaction.reply({
                content: `∞ **נוסף אין סוף**\n\n${target.tag} — יש עכשיו אין סוף קרדיטים`,
                ephemeral: true
            });
        }

        // מעדכן את הודעת הניהול
        try {
            const u = getUser(targetId);
            const isUnlimited = hasUnlimited(targetId);

            const newEmbed = new EmbedBuilder()
                .setTitle(`👤 ניהול קרדיטים — ${target.tag}`)
                .setDescription(
                    `**🆔 ID:** \`${target.id}\`\n` +
                    `**💳 יתרה:** ${isUnlimited ? '∞ **אין סוף**' : `**${u.credits}** קרדיטים`}\n` +
                    `**📊 סה"כ נצבר:** **${u.totalClaimed || 0}**\n\n` +
                    `בחר פעולה:`
                )
                .setColor(0x5865F2)
                .setFooter({ text: `© ${OWNER_NAME}` });

            const newRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`set_credits_${target.id}`)
                        .setLabel('💳 קבע קרדיטים')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`toggle_unlimited_${target.id}`)
                        .setLabel(isUnlimited ? '∞ הסר אין סוף' : '∞ הוסף אין סוף')
                        .setStyle(isUnlimited ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`add_credits_${target.id}`)
                        .setLabel('➕ הוסף קרדיטים')
                        .setStyle(ButtonStyle.Secondary)
                );

            await interaction.message.edit({ embeds: [newEmbed], components: [newRow] });
        } catch (e) {
            console.log(`[-] Failed to update manage message: ${e.message}`);
        }
        return;
    }

    // ===== אישור =====
    if (interaction.isButton() && interaction.customId.startsWith('approve_')) {
        const requestId = interaction.customId.substring(8);
        const request = pendingRequests.get(requestId);

        if (!request) {
            await interaction.reply({ content: '❌ הבקשה כבר לא בתוקף', ephemeral: true });
            return;
        }

        pendingRequests.delete(requestId);
        if (request.ownerTimeout) clearTimeout(request.ownerTimeout);

        await interaction.update({
            content: `✅ **אישרת את הבקשה!**\n\n🎯 ${request.phone}\n💳 ${request.credits} קרדיטים`,
            embeds: [],
            components: []
        });

        const u = getUser(request.userId);
        const userUnlimited = hasUnlimited(request.userId);

        if (!userUnlimited) {
            u.credits = Math.max(0, u.credits - parseInt(request.credits));
            saveUsers();
        }

        try {
            if (request.userInteraction) {
                await request.userInteraction.editReply({
                    content: `🚀 **מתחיל spam...**`,
                    embeds: [],
                    components: []
                });
            }
        } catch (e) {}

        if (request.scheduled) {
            const id = `spam_${request.phone.slice(-4)}_${Date.now().toString().slice(-4)}`;
            spammers[id] = {
                phone: request.phone,
                credits: request.credits,
                hour: request.hour,
                minute: request.minute,
                enabled: true,
                ownerId: request.userId,
                createdAt: Date.now()
            };
            saveSpammers();

            try {
                if (request.userInteraction) {
                    const balanceStr = userUnlimited ? '∞' : u.credits;
                    await request.userInteraction.editReply({
                        content: `✅ **הספאם המתוזמן נוצר!**\n\n🆔 \`${id}\`\n📱 ${request.phone}\n💳 ${request.credits}\n🕐 ${String(request.hour).padStart(2, '0')}:${String(request.minute).padStart(2, '0')}\n\n💳 יתרה: **${balanceStr}**`
                    });
                }
            } catch (e) {}
        } else {
            await doSpam(request.phone, request.credits);

            const id = `spam_${request.phone.slice(-4)}_${Date.now().toString().slice(-4)}`;
            spammers[id] = {
                phone: request.phone,
                credits: request.credits,
                hour: null,
                minute: null,
                enabled: false,
                lastRun: Date.now(),
                ownerId: request.userId,
                createdAt: Date.now()
            };
            saveSpammers();

            if (request.userInteraction) {
                await showSpamProgress(
                    (msg) => request.userInteraction.editReply(msg),
                    request.phone,
                    request.credits
                );
            }
        }

        console.log(`[+] Approved: ${requestId}`);
        return;
    }

    // ===== דחייה =====
    if (interaction.isButton() && interaction.customId.startsWith('deny_')) {
        const requestId = interaction.customId.substring(5);
        const request = pendingRequests.get(requestId);

        if (!request) {
            await interaction.reply({ content: '❌ הבקשה כבר לא בתוקף', ephemeral: true });
            return;
        }

        pendingRequests.delete(requestId);
        if (request.ownerTimeout) clearTimeout(request.ownerTimeout);

        await interaction.update({
            content: `❌ **דחית את הבקשה.**\n\n🎯 ${request.phone}`,
            embeds: [],
            components: []
        });

        try {
            if (request.userInteraction) {
                await request.userInteraction.editReply({
                    content: `❌ **הבקשה נדחתה על ידי ${OWNER_NAME}.**`,
                    embeds: [],
                    components: []
                });
            }
        } catch (e) {}

        console.log(`[+] Denied: ${requestId}`);
        return;
    }

    // ===== בטל בקשה =====
    if (interaction.isButton() && interaction.customId.startsWith('cancel_request_')) {
        const requestId = interaction.customId.substring(15);
        const request = pendingRequests.get(requestId);

        if (!request) {
            await interaction.reply({ content: '❌ הבקשה כבר לא בתוקף', ephemeral: true });
            return;
        }

        if (request.userId !== interaction.user.id) {
            await interaction.reply({ content: '❌ רק מי שביקש יכול לבטל', ephemeral: true });
            return;
        }

        pendingRequests.delete(requestId);
        if (request.ownerTimeout) clearTimeout(request.ownerTimeout);

        await interaction.update({
            content: `🚫 **הבקשה בוטלה.**`,
            embeds: [],
            components: []
        });

        try {
            if (request.ownerMessage) {
                await request.ownerMessage.edit({
                    content: `🚫 **המבקש ביטל את הבקשה.**\n\n🎯 ${request.phone}\n👤 ${request.userTag}`,
                    embeds: [],
                    components: []
                });
            }
        } catch (e) {}

        console.log(`[+] Cancelled by user: ${requestId}`);
        return;
    }
});

// ========== בקשת אישור ==========
async function requestApproval(userInteraction, phone, credits, scheduled, id, hour = null, minute = null) {
    const requestId = Date.now().toString() + Math.random().toString(36).substring(2, 8);

    const request = {
        userInteraction: userInteraction,
        userId: userInteraction.user.id,
        userTag: userInteraction.user.tag,
        phone,
        credits,
        scheduled,
        hour,
        minute,
        createdAt: Date.now(),
        ownerMessage: null,
        ownerTimeout: null
    };

    pendingRequests.set(requestId, request);

    try {
        const owner = await bot.users.fetch(OWNER_ID);

        const timeStr = scheduled
            ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
            : 'מיידי';

        const u = getUser(request.userId);
        const userUnlimited = hasUnlimited(request.userId);

        const embed = new EmbedBuilder()
            .setTitle('🔔 בקשת ספאם חדשה')
            .addFields(
                { name: '👤 מבקש', value: `${userInteraction.user.tag}`, inline: true },
                { name: '🎯 טלפון', value: phone, inline: true },
                { name: '💳 קרדיטים', value: String(credits), inline: true },
                { name: '🕐 שעה', value: timeStr, inline: true },
                { name: '💰 יתרה אחרי', value: userUnlimited ? '∞' : String(u.credits - parseInt(credits)), inline: true }
            )
            .setColor(0xFF6B00)
            .setFooter({ text: 'יש לך 10 דקות לאשר או לדחות' });

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`approve_${requestId}`)
                    .setLabel('✅ אשר')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`deny_${requestId}`)
                    .setLabel('❌ דחה')
                    .setStyle(ButtonStyle.Danger)
            );

        const ownerMsg = await owner.send({ embeds: [embed], components: [row] });
        request.ownerMessage = ownerMsg;

        request.ownerTimeout = setTimeout(async () => {
            const stillPending = pendingRequests.get(requestId);
            if (stillPending) {
                pendingRequests.delete(requestId);

                try {
                    await ownerMsg.delete();
                } catch (e) {}

                try {
                    await userInteraction.editReply({
                        content: `⌛ **הבקשה פגה** — ${OWNER_NAME} לא הגיב תוך 10 דקות.`,
                        embeds: [],
                        components: []
                    });
                } catch (e) {}
            }
        }, APPROVAL_TIMEOUT_MS);

        const userEmbed = new EmbedBuilder()
            .setTitle(`⏳ הבקשה נשלחה ל${OWNER_NAME}`)
            .setDescription(
                `**🎯 טלפון:** ${phone}\n` +
                `**💳 קרדיטים:** ${credits}\n` +
                `**🕐 שעה:** ${timeStr}\n` +
                `**💰 היתרה שלך:** ${userUnlimited ? '∞' : u.credits}\n\n` +
                `ממתין לאישור...\n` +
                `תוכל לבטל את הבקשה בכל רגע.`
            )
            .setColor(0xFF6B00);

        const cancelRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`cancel_request_${requestId}`)
                    .setLabel('🚫 בטל בקשה')
                    .setStyle(ButtonStyle.Secondary)
            );

        await userInteraction.editReply({
            embeds: [userEmbed],
            components: [cancelRow]
        });
    } catch (e) {
        console.log(`[-] DM error: ${e.message}`);
        try {
            await userInteraction.editReply({ content: `❌ שגיאה בשליחת הבקשה: ${e.message}` });
        } catch (err) {}
    }
}

selfbot.login(SELFBOT_TOKEN);
bot.login(BOT_TOKEN);
