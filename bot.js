const { Client } = require('discord.js-selfbot-v13');
const fs = require('fs');
const express = require('express');
const cron = require('node-cron');

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;
const MESSAGE_ID = process.env.MESSAGE_ID;
const OWNER_ID = process.env.OWNER_ID;
const TIMEZONE = process.env.TIMEZONE || 'Asia/Jerusalem';
const PORT = process.env.PORT || 8080;
const DATA_FILE = 'spammers.json';

// ---------- טעינת ספאמרים ----------
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

// ---------- HTTP server for Render ----------
const app = express();
app.get('/', (req, res) => res.send('OK'));
app.get('/health', (req, res) => res.send('OK'));
app.listen(PORT, () => console.log(`[+] HTTP server running on port ${PORT}`));

// ---------- Discord client ----------
const client = new Client({ checkUpdate: false });

// ---------- Spam function ----------
async function doSpam(phone, credits) {
    try {
        console.log(`[+] Spam: ${phone} | ${credits} credits`);
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return '❌ השרת לא נמצא';
        const channel = guild.channels.cache.get(CHANNEL_ID);
        if (!channel) return '❌ החדר לא נמצא';

        const message = await channel.messages.fetch(MESSAGE_ID);
        if (!message) return '❌ ההודעה לא נמצאה';

        // מוצא את הכפתור Spam
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

        console.log(`[+] Clicking Spam button...`);

        // ממתין ל-modal
        const modalPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
            
            client.once('modalSubmit', async (modal) => {
                // לא בשימוש - נטפל בזה ידנית
            });

            // מחכים ל-modal_create
            client.once('modalCreate', async (modal) => {
                clearTimeout(timeout);
                try {
                    // ממלא את השדות
                    for (const row of modal.components) {
                        for (const comp of row.components) {
                            if (comp.label && (comp.label.includes('Phone') || comp.label.toLowerCase().includes('phone'))) {
                                comp.setValue(phone);
                            } else if (comp.label && (comp.label.includes('Credit') || comp.label.toLowerCase().includes('credit'))) {
                                comp.setValue(String(credits));
                            }
                        }
                    }
                    await modal.submit();
                    resolve('✅ ספאם בוצע! ' + phone + ' | ' + credits);
                } catch (e) {
                    reject(e);
                }
            });
        });

        await spamButton.click();

        const result = await modalPromise;
        return result;
    } catch (e) {
        console.log(`[-] Error: ${e.message}`);
        return `❌ שגיאה: ${e.message}`;
    }
}

// ---------- Scheduler (בודק כל דקה) ----------
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
        if (sp.hour === hour && sp.minute === minute) {
            console.log(`[+] Running spammer: ${name}`);
            await doSpam(sp.phone, sp.credits);
        }
    }
}, 60000);

// ---------- on ready ----------
client.on('ready', () => {
    console.log(`[+] Logged in as ${client.user.tag}`);
    console.log(`[+] Loaded ${Object.keys(spammers).length} spammers`);
});

// ---------- on message ----------
client.on('messageCreate', async (message) => {
    if (message.author.id !== OWNER_ID) return;

    const content = message.content.trim();
    const parts = content.split(/\s+/);

    if (content.startsWith('!add ') && parts.length >= 6) {
        const name = parts[1];
        const phone = parts[2];
        const credits = parts[3];
        const hour = parseInt(parts[4]);
        const minute = parseInt(parts[5]);
        spammers[name] = { phone, credits, hour, minute, enabled: true };
        saveSpammers();
        await message.channel.send(`✅ ספאמר \`${name}\` נוצר:\n📱 ${phone} | 💳 ${credits} | 🕐 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} | ✅ פעיל`);
    }

    else if (content.startsWith('!remove ') && parts.length >= 2) {
        const name = parts[1];
        if (spammers[name]) {
            delete spammers[name];
            saveSpammers();
            await message.channel.send(`🗑️ ספאמר \`${name}\` נמחק`);
        } else {
            await message.channel.send(`❌ לא נמצא`);
        }
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

    else if (content.startsWith('!enable ') && parts.length >= 2) {
        const name = parts[1];
        if (spammers[name]) {
            spammers[name].enabled = true;
            saveSpammers();
            await message.channel.send(`✅ \`${name}\` הופעל`);
        }
    }

    else if (content.startsWith('!disable ') && parts.length >= 2) {
        const name = parts[1];
        if (spammers[name]) {
            spammers[name].enabled = false;
            saveSpammers();
            await message.channel.send(`❌ \`${name}\` כובה`);
        }
    }

    else if (content.startsWith('!now ') && parts.length >= 2) {
        const name = parts[1];
        if (!spammers[name]) {
            await message.channel.send(`❌ לא נמצא`);
            return;
        }
        const sp = spammers[name];
        await message.channel.send(`🚀 מבצע \`${name}\`...`);
        const result = await doSpam(sp.phone, sp.credits);
        await message.channel.send(result);
    }

    else if (content.startsWith('!set ') && parts.length >= 4) {
        const name = parts[1];
        const field = parts[2];
        const value = parts[3];
        if (!spammers[name]) {
            await message.channel.send(`❌ לא נמצא`);
            return;
        }
        if (field === 'phone') {
            spammers[name].phone = value;
            saveSpammers();
            await message.channel.send(`✅ \`${name}\` — טלפון: \`${value}\``);
        } else if (field === 'credits') {
            spammers[name].credits = value;
            saveSpammers();
            await message.channel.send(`✅ \`${name}\` — קרדיטים: \`${value}\``);
        } else if (field === 'time' && parts.length >= 5) {
            spammers[name].hour = parseInt(value);
            spammers[name].minute = parseInt(parts[4]);
            saveSpammers();
            await message.channel.send(`✅ \`${name}\` — שעה: \`${String(spammers[name].hour).padStart(2, '0')}:${String(spammers[name].minute).padStart(2, '0')}\``);
        }
    }

    else if (content === '!help') {
        const help = '**🤖 פקודות:**\n\n' +
            '`!add <שם> <טלפון> <קרדיטים> <שעה> <דקה>` — צור ספאמר\n' +
            '`!remove <שם>` — מחק\n' +
            '`!list` — הצג\n' +
            '`!enable <שם>` — הפעל\n' +
            '`!disable <שם>` — כבה\n' +
            '`!now <שם>` — בצע עכשיו\n' +
            '`!set <שם> phone <מספר>`\n' +
            '`!set <שם> credits <כמות>`\n' +
            '`!set <שם> time <שעה> <דקה>`\n\n' +
            '**דוגמה:**\n`!add spam1 0501234567 5 7 30`';
        await message.channel.send(help);
    }
});

// ---------- Start ----------
client.login(TOKEN);
