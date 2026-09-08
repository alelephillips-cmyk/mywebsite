const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
let sock;
let premium = fs.existsSync('./premium.json') ? JSON.parse(fs.readFileSync('./premium.json')) : [];
function isPremium(jid) {
const num = jid.split('@')[0];
return premium.includes(num);
}
const commands = ["setmenuvideo","testanticallmsg","testgoodbye","testwelcome","unmute","warn","welcome","statusdelay","statussettings","readreceipts","device","disk","hostip","trackip","vcc","vcf"];
async function startBot() {
const { state, saveCreds } = await useMultiFileAuthState('auth_info');
sock = makeWASocket({ auth: state });
sock.ev.on('creds.update', saveCreds);
sock.ev.on('connection.update', (update) => {
const { connection, lastDisconnect, qr } = update;
if (qr) {
qrcode.generate(qr, { small: true });
}
if (connection === 'close') {
const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
console.log('Connection closed, reconnecting:', shouldReconnect);
if (shouldReconnect) startBot();
} else if (connection === 'open') {
console.log('Bot connected!');
}
});
sock.ev.on('messages.upsert', async (m) => {
const msg = m.messages[0];
if (!msg.message) return;
try {
const vo = msg.message.viewOnceMessageV2?.message || msg.message.viewOnceMessage?.message;
if (vo) {
const type = Object.keys(vo)[0];
const buffer = await sock.downloadMediaMessage(msg);
if (type === 'imageMessage') {
await sock.sendMessage(sock.user.id, { image: buffer, caption: 'Saved view-once image' });
} else if (type === 'videoMessage') {
await sock.sendMessage(sock.user.id, { video: buffer, caption: 'Saved view-once video' });
}
}
} catch (e) { console.log('viewonce error', e.message); }
if (msg.key.fromMe) return;
const sender = msg.key.remoteJid;
const text = (msg.message.conversation || (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) || '').trim();
const word = text.toLowerCase().split(' ')[0];
if (word === 'menu') {
await sock.sendMessage(sender, { image: { url: '/data/data/com.termux/files/home/botpanel/menu.png' }, caption: commands.join('\n') });
return;
}
if (word === 'pp') {
try {
const ctx = msg.message.extendedTextMessage?.contextInfo;
const target = ctx?.participant || sender;
const ppUrl = await sock.profilePictureUrl(target, 'image');
await sock.sendMessage(sender, { image: { url: ppUrl } });
} catch (e) {
await sock.sendMessage(sender, { text: 'Could not get profile picture.' });
}
return;
}
if (word === 'vv') {
try {
const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
if (!quoted) { await sock.sendMessage(sender, { text: 'Reply to a view-once message with .vv' }); return; }
const type = Object.keys(quoted)[0];
const buffer = await sock.downloadMediaMessage({ message: quoted });
if (type === 'imageMessage') { await sock.sendMessage(sender, { image: buffer, caption: 'Here is your view-once image' }); }
else if (type === 'videoMessage') { await sock.sendMessage(sender, { video: buffer, caption: 'Here is your view-once video' }); }
} catch (e) { await sock.sendMessage(sender, { text: 'Could not extract view-once message' }); }
return;
}
if (word === 'insult') {
try {
const ctx = msg.message.extendedTextMessage?.contextInfo;
const target = ctx?.participant;
if (!target) { await sock.sendMessage(sender, { text: 'Reply to someone message with .insult' }); return; }
const insults = ['You are as sharp as a marble.', 'I would agree with you but then we would both be wrong.', 'You bring everyone so much joy when you leave the room.'];
const pick = insults[Math.floor(Math.random()*insults.length)];
await sock.sendMessage(sender, { text: pick, mentions: [target] });
} catch (e) { await sock.sendMessage(sender, { text: 'Could not insult, reply to a message.' }); }
return;
}
const funReplies = {
hug: 'sends a warm hug', kiss: 'sends a sweet kiss', slap: 'slaps you playfully', pat: 'pats your head gently',
poke: 'pokes you', bonk: 'bonks you on the head', bite: 'bites you playfully', cuddle: 'cuddles you warmly',
wave: 'waves at you', wink: 'winks at you', smile: 'smiles at you', cry: 'cries a little', blush: 'blushes',
happy: 'is happy right now', dance: 'dances happily', yeet: 'yeets you into the sky', bully: 'playfully bullies you',
handhold: 'holds your hand', highfive: 'high fives you', lick: 'licks you', glomp: 'glomps you with a big hug',
nom: 'noms on you', kill: 'pretends to eliminate you jokingly', awoo: 'awoos loudly', cringe: 'cringes hard',
love: 'sends you love', headpat: 'gives you a headpat', triggered: 'is triggered',
joke: 'Why did the developer go broke? Because he used up all his cache.',
quote: 'Believe you can and you are halfway there.',
fact: 'Honey never spoils.', catfact: 'Cats sleep for 70% of their lives.',
dogfact: 'A dog nose print is unique like a human fingerprint.',
roast: 'You are proof that even AI has limits on patience.',
pickup: 'Are you a parking ticket? Because you have fine written all over you.',
advice: 'Do not wait for the perfect moment, take the moment and make it perfect.',
compliment: 'You are doing amazing, keep going!', rate: 'I would rate that a solid 8 out of 10!',
owo: 'OwO what is this', uwu: 'UwU', mock: 'MoCkInG yOuR mEsSaGe', clap: '👏👏👏',
lenny: '( ͡° ͜ʖ ͡°)', tableflip: '(╯°□°）╯︵ ┻━┻', unflip: '┬─┬ ノ( ゜-゜ノ)', shrug: '¯\(ツ)/¯',
facepalm: 'facepalm moment', disapprove: 'not impressed', gg: 'GG! Well played.', f: 'F',
chad: 'Certified Chad moment.', based: 'That is based.', flex: 'Flexing hard right now.',
dank: 'Dank meme detected.', yolo: 'You Only Live Once!', legend: 'You are a legend.',
dealwithit: 'Deal with it.', notbad: 'Not bad, not bad at all.', oops: 'Oops! That was not supposed to happen.'
};
if (funReplies[word]) {
await sock.sendMessage(sender, { text: 'KIUBY XMD: ' + funReplies[word] });
return;
}
if (word === '8ball') {
const answers = ['Yes','No','Maybe','Definitely','Ask again later','Absolutely not'];
await sock.sendMessage(sender, { text: answers[Math.floor(Math.random()*answers.length)] });
return;
}
if (word === 'coinflip') {
await sock.sendMessage(sender, { text: Math.random() < 0.5 ? 'Heads' : 'Tails' });
return;
}
if (word === 'hi') {
await sock.sendMessage(sender, { text: 'Hello! Bot is online.' });
return;
}
if (word === 'premium' && !isPremium(sender)) {
await sock.sendMessage(sender, { text: 'This is a premium feature. Contact the owner to get access.' });
return;
}
if (word === 'calculate') {
try {
const expr = text.split(' ').slice(1).join('');
const result = eval(expr);
await sock.sendMessage(sender, { text: 'Result: ' + result });
} catch (e) {
await sock.sendMessage(sender, { text: 'Invalid calculation' });
}
return;
}
if (commands.includes(word)) {
await sock.sendMessage(sender, { text: 'My developer is kiuby the greatest developer ever he will come soon, ❤️' });
return;
}
});
}
startBot();
module.exports = {
sendMessage: (jid, text) => sock ? sock.sendMessage(jid, { text }) : null
};



