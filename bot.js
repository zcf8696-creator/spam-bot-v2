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
const OWNER_ID = process.env.OWNER_ID;
const TIMEZONE = process.env.TIMEZONE || 'Asia/Jerusalem';
const PORT = process.env.PORT || 8080;
const DATA_FILE = 'spammers.json';

// רשימת בקשות ממתינות לאישור
const pendingRequests = new Map();

function loadSpammers() {
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
        return {};
    }
}
function saveSpammers() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(spammers, null, 2), 'utf8');
}

let spammers = loadSpammers();

const app = express();
app.get('/', (req, res) => res.send('OK'));
app.get('/health', (req, res) => res.send('OK'));
app.listen(PORT, () => console.log(`[+] HTTP server running on port ${PORT}`));

// ========== SELFBOT ==========
const selfbot = new SelfbotClient({ checkUpdate: false });

// ========== טבלת התקדמות ==========
async function showSpamProgress(interaction, phone, credits) {
    const totalSeconds = credits * 25;
    const endTime = Date.now() + totalSeconds * 1000;

    const createEmbed = (timeLeft, finished = false) => {
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
            embed.addFields({
                name: '📊 Stats',
                value: `✅ Credits Used: **${credits}**\n⏱️ Total: **${totalSeconds} sec**`,
                inline: false
            });
        } else {
            embed.addFields({
                name: '📊 Stats',
                value: `💳 Credits: **${credits}**`,
                inline: false
            });
        }
        return embed;
    };

    try {
        await interaction.editReply({ embeds: [createEmbed(totalSeconds)] });

        const interval = setInterval(async () => {
            const timeLeft = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));

            if (timeLeft <= 0) {
                clearInterval(interval);
                try {
                    await interaction.editReply({ embeds: [createEmbed(0, true)] });
                } catch (e) {}
                return;
            }

            try {
                await interaction.editReply({ embeds: [createEmbed(timeLeft)] });
            } catch (e) {}
        }, 5000);
    } catch (e) {
        console.log(`[-] Progress error: ${e.message}`);
    }
}

// ========== פונקציית ספאם ==========
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

// ========== SCHEDULER ==========
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
                const channel = selfbot.channels.cache.get(COMMAND_CHANNEL_ID);
                if (channel) {
                    await channel.send(`⏰ **ספאם מתוזמן:** \`${id}\`\n📱 ${sp.phone} | 💳 ${sp.credits}\n${result}`);
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
    console.log(`[+] Owner ID: ${OWNER_ID}`);
});

bot.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== COMMAND_CHANNEL_ID) return;

    if (message.content === '!panel') {
        const embed = new EmbedBuilder()
            .setTitle('🔒 Spam Panel')
            .setDescription(
                '**לחץ על `Spam` כדי לשלוח SMS**\n\n' +
                '**איך זה עובד:**\n' +
                '1️⃣ לחץ על כפתור `Spam` למטה\n' +
                '2️⃣ מלא את הטופס: מספר טלפון + קרדיטים\n' +
                '3️⃣ בחר שעה (אופציונלי) — אם ריק, ישלח מיד\n' +
                '4️⃣ **הבקשה תישלח לאישור הבעלים**\n'
            )
            .setColor(0x5865F2)
            .setFooter({ text: 'מערכת הספאם האוטומטית' });

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
                    .setStyle(ButtonStyle.Primary)
            );

        await message.channel.send({ embeds: [embed], components: [row] });
    }

    if (message.content === '!help') {
        await message.channel.send(
            '**🤖 פקודות:**\n\n' +
            '`!panel` — שלח פאנל עם כפתורים\n' +
            '`!list` — הצג את כל הספאמרים\n' +
            '`!remove <id>` — מחק ספאמר\n' +
            '`!purge` — מחק הודעות הבוט'
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
    // ===== כפתור: Spam =====
    if (interaction.isButton() && interaction.customId === 'spam_button') {
        const modal = new ModalBuilder()
            .setCustomId('spam_modal')
            .setTitle('Spam - שליחת SMS');

        const phoneInput = new TextInputBuilder()
            .setCustomId('phone')
            .setLabel('מספר טלפון')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('0501234567')
            .setRequired(true)
            .setMaxLength(15);

        const creditsInput = new TextInputBuilder()
            .setCustomId('credits')
            .setLabel('קרדיטים (1 קרדיט = 25 שניות)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('1')
            .setRequired(true)
            .setMaxLength(5);

        const hourInput = new TextInputBuilder()
            .setCustomId('hour')
            .setLabel('שעה (0-23) — ריק = עכשיו')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('14')
            .setRequired(false)
            .setMaxLength(2);

        const minuteInput = new TextInputBuilder()
            .setCustomId('minute')
            .setLabel('דקה (0-59) — ריק = עכשיו')
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
    }

    // ===== כפתור: רשימה =====
    if (interaction.isButton() && interaction.customId === 'list_button') {
        if (Object.keys(spammers).length === 0) {
            await interaction.reply({ content: '📭 אין ספאמרים', ephemeral: true });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        let count = 0;
        for (const [id, sp] of Object.entries(spammers)) {
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
                        .setCustomId(`cancel_${id}`)
                        .setLabel('🗑️ בטל')
                        .setStyle(ButtonStyle.Danger)
                );

            await interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });
            count++;

            if (count >= 5) break;
        }

        if (count >= 5 && Object.keys(spammers).length > 5) {
            await interaction.followUp({ content: `⚠️ מוצגים רק 5 ספאמרים ראשונים מתוך ${Object.keys(spammers).length}`, ephemeral: true });
        }
    }

    // ===== כפתור: הפעל עכשיו =====
    if (interaction.isButton() && interaction.customId.startsWith('run_now_')) {
        const id = interaction.customId.substring(8);

        if (!spammers[id]) {
            await interaction.reply({ content: `❌ \`${id}\` לא נמצא`, ephemeral: true });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        const sp = spammers[id];

        // שולח בקשה לאישור לבעלים
        await requestApproval(interaction, sp.phone, sp.credits, false, id);
    }

    // ===== כפתור: בטל =====
    if (interaction.isButton() && interaction.customId.startsWith('cancel_')) {
        const id = interaction.customId.substring(7);

        if (!spammers[id]) {
            await interaction.reply({ content: `❌ \`${id}\` לא נמצא`, ephemeral: true });
            return;
        }

        delete spammers[id];
        saveSpammers();

        await interaction.reply({
            content: `🗑️ ספאמר \`${id}\` **בוטל ונמחק**.`,
            ephemeral: true
        });

        console.log(`[+] Cancelled spammer: ${id}`);
    }

    // ===== טופס Spam =====
    if (interaction.isModalSubmit() && interaction.customId === 'spam_modal') {
        const phone = interaction.fields.getTextInputValue('phone');
        const credits = interaction.fields.getTextInputValue('credits');
        const hourRaw = interaction.fields.getTextInputValue('hour').trim();
        const minuteRaw = interaction.fields.getTextInputValue('minute').trim();

        await interaction.deferReply({ ephemeral: true });

        // אם אין שעה — בקשת אישור מיידית
        if (!hourRaw || !minuteRaw) {
            await requestApproval(interaction, phone, credits, false, null);
            return;
        }

        const hour = parseInt(hourRaw);
        const minute = parseInt(minuteRaw);

        if (isNaN(hour) || hour < 0 || hour > 23 || isNaN(minute) || minute < 0 || minute > 59) {
            await interaction.editReply({ content: '❌ שעה או דקה לא תקינות' });
            return;
        }

        // ספאם מתוזמן — בקשה לאישור
        await requestApproval(interaction, phone, credits, true, null, hour, minute);
    }

    // ===== אישור/דחייה של הבקשה (DM) =====
    if (interaction.isButton() && interaction.customId.startsWith('approve_')) {
        const requestId = interaction.customId.substring(8);
        const request = pendingRequests.get(requestId);

        if (!request) {
            await interaction.reply({ content: '❌ הבקשה כבר לא בתוקף', ephemeral: true });
            return;
        }

        // אישור
        pendingRequests.delete(requestId);

        await interaction.update({
            content: `✅ **אישרת את הבקשה!**\n\n🎯 ${request.phone}\n💳 ${request.credits} קרדיטים`,
            embeds: [],
            components: []
        });

        // מבצע את הספאם
        if (request.scheduled) {
            const id = `spam_${request.phone.slice(-4)}_${Date.now().toString().slice(-4)}`;
            spammers[id] = {
                phone: request.phone,
                credits: request.credits,
                hour: request.hour,
                minute: request.minute,
                enabled: true,
                createdAt: Date.now()
            };
            saveSpammers();

            await request.user.editReply({
                content: `✅ **הבקשה אושרה!**\n\n🆔 \`${id}\`\n📱 ${request.phone}\n💳 ${request.credits}\n🕐 ${String(request.hour).padStart(2, '0')}:${String(request.minute).padStart(2, '0')}`
            });
        } else {
            // מבצע עכשיו
            const result = await doSpam(request.phone, request.credits);

            const id = `spam_${request.phone.slice(-4)}_${Date.now().toString().slice(-4)}`;
            spammers[id] = {
                phone: request.phone,
                credits: request.credits,
                hour: null,
                minute: null,
                enabled: false,
                lastRun: Date.now(),
                createdAt: Date.now()
            };
            saveSpammers();

            await showSpamProgress({ editReply: (msg) => request.user.editReply(msg) }, request.phone, request.credits);
        }

        console.log(`[+] Approved: ${requestId}`);
    }

    if (interaction.isButton() && interaction.customId.startsWith('deny_')) {
        const requestId = interaction.customId.substring(5);
        const request = pendingRequests.get(requestId);

        if (!request) {
            await interaction.reply({ content: '❌ הבקשה כבר לא בתוקף', ephemeral: true });
            return;
        }

        pendingRequests.delete(requestId);

        await interaction.update({
            content: `❌ **דחית את הבקשה.**\n\n🎯 ${request.phone}`,
            embeds: [],
            components: []
        });

        await request.user.editReply({
            content: `❌ **הבקשה נדחתה על ידי הבעלים.**`
        });

        console.log(`[+] Denied: ${requestId}`);
    }
});

// ========== פונקציית בקשת אישור ==========
async function requestApproval(userInteraction, phone, credits, scheduled, id, hour = null, minute = null) {
    const requestId = Date.now().toString() + Math.random().toString(36).substring(2, 8);

    pendingRequests.set(requestId, {
        user: userInteraction,
        phone,
        credits,
        scheduled,
        hour,
        minute,
        createdAt: Date.now()
    });

    // אחרי 5 דקות — הבקשה מתבטלת אוטומטית
    setTimeout(() => {
        pendingRequests.delete(requestId);
    }, 5 * 60 * 1000);

    try {
        const owner = await bot.users.fetch(OWNER_ID);

        const timeStr = scheduled
            ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
            : 'מיידי';

        const embed = new EmbedBuilder()
            .setTitle('🔔 בקשת ספאם חדשה')
            .addFields(
                { name: '👤 מבקש', value: `${userInteraction.user.tag}`, inline: true },
                { name: '🎯 טלפון', value: phone, inline: true },
                { name: '💳 קרדיטים', value: String(credits), inline: true },
                { name: '🕐 שעה', value: timeStr, inline: true }
            )
            .setColor(0xFF6B00)
            .setFooter({ text: 'יש לך 5 דקות לאשר או לדחות' });

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

        await owner.send({ embeds: [embed], components: [row] });

        await userInteraction.editReply({
            content: '⏳ **הבקשה נשלחה לבעלים לאישור. אנא המתן...**'
        });
    } catch (e) {
        console.log(`[-] DM error: ${e.message}`);
        await userInteraction.editReply({ content: `❌ שגיאה בשליחת הבקשה: ${e.message}` });
    }
}

selfbot.login(SELFBOT_TOKEN);
bot.login(BOT_TOKEN);
