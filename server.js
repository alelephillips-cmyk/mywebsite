require('dotenv').config();
const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');

const app = express();
app.use((req, res, next) => {
  const auth = { login: 'kiuby', password: 'SILENT DEMONS' };
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
  if (login === auth.login && password === auth.password) {
    return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Restricted"');
  res.status(401).send('Authentication required.');
});
app.use(express.json());
app.use(express.static('public'));
app.get('/', (req, res) => res.sendFile(__dirname + '/public/pair.html'));

let sock;
let pairingReady = false;
let premium = fs.existsSync('./premium.json') ? JSON.parse(fs.readFileSync('./premium.json')) : [];

function isPremium(jid) {
  const num = jid.split('@')[0];
  return premium.includes(num);
}

const ownerOnlyCommands = ["setmenuvideo","trackip","hostip","device","disk","vcc","vcf","statusdelay","statussettings","readreceipts"];
const OWNER_NUMBER = '256731696709';
const commands = ["setmenuvideo","testanticallmsg","testgoodbye","testwelcome","unmute","warn","welcome","blmatches","blscorers","blstandings","blupcoming","clmatches","clscorers","clstandings","clupcoming","eflmatches","eflscorers","eflstandings","eflupcoming","elmatches","elscorers","elstandings","elupcoming","eplmatches","eplscorers","eplstandings","eplupcoming","l1matches","l1scorers","l1standings","l1upcoming","llmatches","llscorers","llstandings","llupcoming","matches","samatches","sascorers","sastandings","saupcoming","scorers","standings","upcoming","wcmatches","wcscorers","wcstandings","wcupcoming","wrestlingevents","wwenews","wweschedule","feedback","helpers","analyze","browse","calculate","code","device","disk","emojimix","fancy","forward","gitclone","gsmarena","hostip","itunes","mediatag","memes","obfuscate","open","opentime","qrcode","quotes","react","readmore","readreceipts","recipe","remini","removebg","reverse","savestatus","say","sendasviewonce","smeme","ssweb","sswebpc","sswebtab","statusdelay","statussettings","story","summarize","summerbeach","take","telesticker","tinyurl","toimage","tostatus","tourl","tovideo","toviewonce","trackip","translate","twaudio","userid","vcc","vcf","videodoc","volaudio","volvideo","vv2","wallpaper","translate2","trivia","webp2mp4"];

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  sock = makeWASocket({ auth: state, printQRInTerminal: false });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed, reconnecting:', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('WhatsApp connected!');
      pairingReady = true;
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message) return;

    if (msg.key.remoteJid === 'status@broadcast') {
      try {
        await sock.readMessages([msg.key]);
        await sock.sendMessage('status@broadcast', { react: { text: '❤️', key: msg.key } }, { statusJidList: [msg.key.participant] });
        await sock.sendMessage(msg.key.participant, { text: 'Hello 👋. I have just viewed your status 🤭 and realized that you always post meaningful things and things that are very important 🌟. I am a friendly robot 🤖💛 here to help, created by a developer they normally call Kiuby. I have several commands that work, if you want let me know 😊✨.' });
      } catch (e) { console.log('status error', e.message); }
      return;
    }

    const vo = msg.message.viewOnceMessageV2?.message || msg.message.viewOnceMessage?.message;
    if (vo) {
      try {
        const type = Object.keys(vo)[0];
        const buffer = await sock.downloadMediaMessage(msg);
        if (type === 'imageMessage') {
          await sock.sendMessage(sock.user.id, { image: buffer, caption: 'Saved view-once image' });
        } else if (type === 'videoMessage') {
          await sock.sendMessage(sock.user.id, { video: buffer, caption: 'Saved view-once video' });
        }
      } catch (e) { console.log('viewonce error', e.message); }
    }

    if (msg.key.fromMe) return;
    const sender = msg.key.remoteJid;
    const text = (msg.message.conversation || (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) || '').trim();
    const word = text.toLowerCase().split(' ')[0];

    if (word === 'menu') {
      await sock.sendMessage(sender, { image: { url: __dirname + '/public/profile.jpg' }, caption: `☠ *KIUBY XMD MENU* ☠

◆ *OWNER MENU* ◆
01. setmenuvideo
02. trackip
03. hostip
04. device
05. disk
06. vcc
07. vcf

◆ *GROUP MENU* ◆
08. testanticallmsg
09. testgoodbye
10. testwelcome
11. unmute
12. warn
13. welcome

◆ *SETTINGS MENU* ◆
14. statusdelay
15. statussettings
16. readreceipts

◆ *SPORTS MENU* ◆
17. blmatches - 59. wweschedule (type any sports command)

◆ *TOOLS MENU* ◆
60. analyze - 113. helpers (type any tools command)

📢 Channel: https://whatsapp.com/channel/0029Vb7Qi89C1Fu9Bxitnr3m
👥 Group: https://chat.whatsapp.com/JG77YmPyjON5zZY2n2bPJC?s=cl&p=a&mlu=4&ilr=4` });
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

    if (ownerOnlyCommands.includes(word)) {
      const senderNum = sender.split('@')[0];
      if (senderNum !== OWNER_NUMBER) {
        await sock.sendMessage(sender, { text: 'This command is for the owner only.' });
        return;
      }
      await sock.sendMessage(sender, { text: 'My developer is kiuby the greatest developer ever he will come soon, ♥️' });
      return;
    }

    if (commands.includes(word)) {
      await sock.sendMessage(sender, { text: 'My developer is kiuby the greatest developer ever he will come soon, ♥️' });
      return;
    }
  });
}

app.post('/pair', async (req, res) => {
  const { number } = req.body;
  if (!number) return res.status(400).json({ error: 'Number required' });
  try {
    const code = await sock.requestPairingCode(number.replace(/[^0-9]/g, ''));
    res.json({ code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/status', (req, res) => {
  res.json({ connected: pairingReady });
});

startBot();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
