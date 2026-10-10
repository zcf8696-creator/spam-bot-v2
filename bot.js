const { Client, MessageButton, MessageActionRow, Modal, TextInputComponent } = require('discord.js-selfbot-v13');
const fs = require('fs');
const express = require('express');

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;
const MESSAGE_ID = process.env.MESSAGE_ID;
const OWNER_ID = process.env.OWNER_ID;
const TIMEZONE = process.env.TIMEZONE || 'Asia/Jerusalem';
const PORT = process.env.PORT || 8080;
const DATA_FILE = 'spammers.json';

const ALLOWED_IDS = (OWNER_ID || '').split(',').map(id => id.trim()).filter(id => id);

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

const client = new Client({ checkUpdate: false });

// ---------- Spam function ----------
async function doSpam(phone, credits) {
    try {
        console.log(`[+] Spam: ${phone} | ${credits} credits`);
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return { success: false, message: '❌ השרת לא נמצא' };
        const channel = guild.channels.cache.get(CHANNEL_ID);
        if (!channel) return { success: false, message: '❌ החדר לא נמצא' };

        const message = await channel.messages.fetch(MESSAGE_ID);
        if (!message) return { success: false, message: '❌ ההודעה לא נמצאה' };

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

        if (!spamButton) return { success: false, message: '❌ הכפתור לא נמצא' };

        console.log(`[+] Clicking Spam button...`);

        const modalPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout - no modal')), 10000);
            client.once('interactionModalCreate', (m) => {
                clearTimeout(timeout);
                console.log(`[+] Modal received!`);
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
        console.log(`[+] Modal replied successfully!`);

        return { success: true, message: `✅ ספאם בוצע! ${phone} | ${credits}` };
    } catch (e) {
        console.log(`[-] Error: ${e.message}`);
        return { success: false, message: `❌ שגיאה: ${e.message}` };
    }
}

// ---------- Setup panel ----------
async function sendSetupPanel(channel) {
    const row = new MessageActionRow()
        .addComponents(
            new MessageButton()
                .setCustomId('create_spammer')
                .setLabel('➕ צור ספאמר')
                .setStyle('SUCCESS'),
            new MessageButton()
                .setCustomId('list_spammers')
                .setLabel('📋 רשימה')
                .setStyle('PRIMARY'),
            new MessageButton()
                .setCustomId('run_now')
                .setLabel('🚀 הפעל עכשיו')
                .setStyle('DANGER')
        );

    await channel.send({
        content: '**🤖 פאנל ספאמר**\n\nלחץ על הכפתורים למטה:',
        components: [row]
    });
}

// ---------- Scheduler ----------
setInterval(async () => {
    const now = new Date();
    const tz = new Intl.DateTimeFormat('en-US', {
        timeZone: TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(now);

    const [hour, minute] = tz.split(':').map(Number);

    for (const [name, sp] of Object.entries(spammers)) {
        if (!sp.enabled) continue;
        if (sp.lastRun && Date.now() - sp.lastRun < 5 * 60 * 1000) continue;
        if (sp.hour === hour && sp.minute === minute) {
            console.log(`[+] Running spammer: ${name}`);
            const result = await doSpam(sp.phone, sp.credits);
            sp.lastRun = Date.now();
            saveSpammers();

            try {
                const channel = client.channels.cache.get(CHANNEL_ID);
                if (channel) {
                    await channel.send(`⏰ **ספאם מתוזמן:** \`${name}\`\n📱 ${sp.phone} | 💳 ${sp.credits}\n${result.message}`);
                }
            } catch (e) {
                console.log(`[-] Notification error: ${e.message}`);
            }
        }
    }
}, 60000);

// ---------- on ready ----------
client.on('ready', () => {
    console.log(`[+] Logged in as ${client.user.tag}`);
    console.log(`[+] Loaded ${Object.keys(spammers).length} spammers`);
    console.log(`[+] Authorized users: ${ALLOWED_IDS.join(', ')}`);
});

// ---------- on message ----------
client.on('messageCreate', async (message) => {
    if (!ALLOWED_IDS.includes(message.author.id)) return;

    const content = message.content.trim();

    if (content === '!setup') {
        await sendSetupPanel(message.channel);
    }
    else if (content === '!help') {
        await message.channel.send(
            '**🤖 פקודות:**\n\n' +
            '`!setup` — שלח פאנל כפתורים\n' +
            '`!list` — הצג את כל הספאמרים\n' +
            '`!now <שם>` — בצע ספאמר עכשיו\n' +
            '`!remove <שם>` — מחק ספאמר\n' +
            '`!enable <שם>` — הפעל\n' +
            '`!disable <שם>` — כבה'
        );
    }
    else if (content === '!list') {
        if (Object.keys(spammers).length === 0) {
            await message.channel.send('📭 אין ספאמרים');
            return;
        }
        let msg = '**📋 רשימת ספאמרים:**\n\n';
        for (const [name, sp] of Object.entries(spammers)) {
            const status = sp.enabled ? '✅' : '❌';
            msg += `**${name}** ${status}\n  📱 ${sp.phone} | 💳 ${sp.credits} | 🕐 ${String(sp.hour).padStart(2, '0')}:${String(sp.minute).padStart(2, '0')}\n\n`;
        }
        await message.channel.send(msg);
    }
    else if (content.startsWith('!now ') && content.length > 5) {
        const name = content.substring(5).trim();
        if (!spammers[name]) {
            await message.channel.send(`❌ \`${name}\` לא נמצא`);
            return;
        }
        const sp = spammers[name];
        await message.channel.send(`🚀 מבצע \`${name}\`...`);
        const result = await doSpam(sp.phone, sp.credits);
        await message.channel.send(result.message);
    }
    else if (content.startsWith('!remove ') && content.length > 8) {
        const name = content.substring(8).trim();
        if (spammers[name]) {
            delete spammers[name];
            saveSpammers();
            await message.channel.send(`🗑️ \`${name}\` נמחק`);
        } else {
            await message.channel.send(`❌ \`${name}\` לא נמצא`);
        }
    }
    else if (content.startsWith('!enable ') && content.length > 8) {
        const name = content.substring(8).trim();
        if (spammers[name]) {
            spammers[name].enabled = true;
            saveSpammers();
            await message.channel.send(`✅ \`${name}\` הופעל`);
        }
    }
    else if (content.startsWith('!disable ') && content.length > 9) {
        const name = content.substring(9).trim();
        if (spammers[name]) {
            spammers[name].enabled = false;
            saveSpammers();
            await message.channel.send(`❌ \`${name}\` כובה`);
        }
    }
});

// ---------- Button interactions ----------
client.on('interactionButtonCreate', async (interaction) => {
    if (!ALLOWED_IDS.includes(interaction.user.id)) return;

    // Create spammer - show modal
    if (interaction.customId === 'create_spammer') {
        const modal = new Modal()
            .setCustomId('new_spammer_modal')
            .setTitle('צור ספאמר חדש');

        const nameInput = new TextInputComponent()
            .setCustomId('name')
            .setLabel('שם הספאמר')
            .setStyle('SHORT')
            .setRequired(true)
            .setMaxLength(20);

        const phoneInput = new TextInputComponent()
            .setCustomId('phone')
            .setLabel('מספר טלפון')
            .setStyle('SHORT')
            .setRequired(true)
            .setMaxLength(15);

        const creditsInput = new TextInputComponent()
            .setCustomId('credits')
            .setLabel('כמות קרדיטים')
            .setStyle('SHORT')
            .setRequired(true)
            .setMaxLength(5);

        const hourInput = new TextInputComponent()
            .setCustomId('hour')
            .setLabel('שעה (0-23)')
            .setStyle('SHORT')
            .setRequired(true)
            .setMaxLength(2);

        const minuteInput = new TextInputComponent()
            .setCustomId('minute')
            .setLabel('דקה (0-59)')
            .setStyle('SHORT')
            .setRequired(true)
            .setMaxLength(2);

        const row1 = new MessageActionRow().addComponents(nameInput);
        const row2 = new MessageActionRow().addComponents(phoneInput);
        const row3 = new MessageActionRow().addComponents(creditsInput);
        const row4 = new MessageActionRow().addComponents(hourInput);
        const row5 = new MessageActionRow().addComponents(minuteInput);

        modal.addComponents(row1, row2, row3, row4, row5);

        await interaction.showModal(modal);
    }

    // List spammers
    else if (interaction.customId === 'list_spammers') {
        if (Object.keys(spammers).length === 0) {
            await interaction.reply({ content: '📭 אין ספאמרים', ephemeral: true });
            return;
        }
        let msg = '**📋 רשימת ספאמרים:**\n\n';
        for (const [name, sp] of Object.entries(spammers)) {
            const status = sp.enabled ? '✅' : '❌';
            msg += `**${name}** ${status}\n  📱 ${sp.phone} | 💳 ${sp.credits} | 🕐 ${String(sp.hour).padStart(2, '0')}:${String(sp.minute).padStart(2, '0')}\n\n`;
        }
        await interaction.reply({ content: msg, ephemeral: true });
    }

    // Run now - show modal to choose spammer
    else if (interaction.customId === 'run_now') {
        if (Object.keys(spammers).length === 0) {
            await interaction.reply({ content: '📭 אין ספאמרים להריץ', ephemeral: true });
            return;
        }

        const modal = new Modal()
            .setCustomId('run_now_modal')
            .setTitle('הפעל ספאמר עכשיו');

        const nameInput = new TextInputComponent()
            .setCustomId('name')
            .setLabel('שם הספאמר להרצה')
            .setStyle('SHORT')
            .setRequired(true)
            .setMaxLength(20);

        const row1 = new MessageActionRow().addComponents(nameInput);
        modal.addComponents(row1);

        await interaction.showModal(modal);
    }
});

// ---------- Modal submit ----------
client.on('interactionModalSubmit', async (interaction) => {
    if (!ALLOWED_IDS.includes(interaction.user.id)) return;

    // New spammer created
    if (interaction.customId === 'new_spammer_modal') {
        const fields = {};
        for (const row of interaction.components) {
            for (const comp of row.components) {
                fields[comp.customId] = comp.value;
            }
        }

        const name = fields.name;
        const phone = fields.phone;
        const credits = fields.credits;
        const hour = parseInt(fields.hour);
        const minute = parseInt(fields.minute);

        if (isNaN(hour) || hour < 0 || hour > 23 || isNaN(minute) || minute < 0 || minute > 59) {
            await interaction.reply({ content: '❌ שעה או דקה לא תקינות', ephemeral: true });
            return;
        }

        spammers[name] = { phone, credits, hour, minute, enabled: true };
        saveSpammers();

        await interaction.reply({
            content: `✅ ספאמר \`${name}\` נוצר בהצלחה!\n📱 ${phone}\n💳 ${credits}\n🕐 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
            ephemeral: true
        });

        console.log(`[+] Created spammer: ${name}`);
    }

    // Run now
    else if (interaction.customId === 'run_now_modal') {
        const name = interaction.components[0].components[0].value;

        if (!spammers[name]) {
            await interaction.reply({ content: `❌ \`${name}\` לא נמצא`, ephemeral: true });
            return;
        }

        await interaction.reply({ content: `🚀 מבצע \`${name}\`...`, ephemeral: true });

        const sp = spammers[name];
        const result = await doSpam(sp.phone, sp.credits);

        const channel = client.channels.cache.get(CHANNEL_ID);
        if (channel) {
            await channel.send(`🚀 **הרצה ידנית:** \`${name}\`\n${result.message}`);
        }
    }
});

client.login(TOKEN);
