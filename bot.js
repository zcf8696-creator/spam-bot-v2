const { Client } = require('discord.js-selfbot-v13');
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

function generateSnowflake() {
    const epoch = 1420070400000n;
    const now = BigInt(Date.now());
    const snowflake = (now - epoch) << 22n;
    return snowflake.toString();
}

async function doSpam(phone, credits) {
    try {
        console.log(`[+] Spam: ${phone} | ${credits} credits`);
        const guild = client.guilds.cache.get(GUILD_ID);
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

        const applicationId = message.author.id;
        console.log(`[+] Application ID: ${applicationId}`);

        // שלב 1 - לוחץ על הכפתור כדי לקבל את ה-modal custom_id
        console.log(`[+] Clicking Spam button...`);

        const modalPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
            const handler = (m) => {
                clearTimeout(timeout);
                console.log(`[+] Modal received! customId: ${m.customId}`);
                resolve(m);
            };
            client.once('modalCreate', handler);
            client.once('interactionModalCreate', handler);
        });

        await message.clickButton(spamButton.customId);

        const modal = await modalPromise;

        // שלב 2 - שולח POST עם id ו-nonce
        const sessionId = client.ws.shards.first()?.sessionId;
        const modalId = generateSnowflake();
        const nonce = generateSnowflake();

        console.log(`[DEBUG] Session ID: ${sessionId}`);
        console.log(`[DEBUG] Modal ID: ${modalId}`);
        console.log(`[DEBUG] Nonce: ${nonce}`);

        // ממפה את השדות לפי customId
        const modalComponents = [];
        let fieldIndex = 0;
        for (const row of modal.components) {
            const rowComps = [];
            for (const comp of row.components) {
                let value = '';
                if (fieldIndex === 0) value = phone;
                else if (fieldIndex === 1) value = String(credits);
                rowComps.push({
                    type: 4,
                    custom_id: comp.customId,
                    value: value
                });
                fieldIndex++;
            }
            modalComponents.push({ type: 1, components: rowComps });
        }

        // ה-payload עם id, nonce ו-session_id
        const payload = {
            id: modalId,
            type: 5,
            application_id: applicationId,
            channel_id: CHANNEL_ID,
            guild_id: GUILD_ID,
            data: {
                id: modalId,
                custom_id: modal.customId,
                components: modalComponents
            },
            session_id: sessionId,
            nonce: nonce
        };

        console.log(`[DEBUG] POST payload:`, JSON.stringify(payload, null, 2));

        const response = await fetch('https://discord.com/api/v9/interactions', {
            method: 'POST',
            headers: {
                'Authorization': TOKEN,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9173 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36',
                'X-Super-Properties': Buffer.from(JSON.stringify({
                    os: 'Windows',
                    browser: 'Discord Client',
                    release_channel: 'stable',
                    client_version: '1.0.9173',
                    os_version: '10.0.26100',
                    os_arch: 'x64',
                    system_locale: 'he-IL',
                    client_build_number: 341295
                })).toString('base64'),
                'X-Discord-Locale': 'he-IL',
                'X-Discord-Timezone': 'Asia/Jerusalem'
            },
            body: JSON.stringify(payload)
        });

        if (response.ok || response.status === 204) {
            console.log(`[+] Direct POST successful!`);
            return `✅ ספאם בוצע! ${phone} | ${credits}`;
        } else {
            const errText = await response.text();
            console.log(`[-] POST failed: ${response.status} - ${errText}`);
            return `❌ POST failed: ${response.status}`;
        }
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

    for (const [name, sp] of Object.entries(spammers)) {
        if (!sp.enabled) continue;
        if (sp.hour === hour && sp.minute === minute) {
            console.log(`[+] Running spammer: ${name}`);
            await doSpam(sp.phone, sp.credits);
        }
    }
}, 60000);

client.on('ready', () => {
    console.log(`[+] Logged in as ${client.user.tag}`);
    console.log(`[+] Loaded ${Object.keys(spammers).length} spammers`);
});

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

client.login(TOKEN);
