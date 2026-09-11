require('dotenv').config();
const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');

const app = express();
app.use((req, res, next) => {
  return next(); // TEMP: password disabled for PWA build
  if (req.path === '/manifest.json' || req.path === '/icon.png') return next();
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
let connectionStatus = 'starting';
let connectionError = null;
let authRegistered = false;
let startPromise = null;
let reconnectTimer = null;
let reconnectAttempts = 0;

function disconnectCode(error) {
  return error?.output?.statusCode || error?.data?.statusCode || error?.statusCode || null;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function publicConnectionError() {
  if (connectionStatus === 'logged_out') {
    return 'The saved WhatsApp session is logged out. Remove the old auth_info session before pairing a new device.';
  }
  if (connectionStatus === 'reconnecting' || connectionStatus === 'starting' || connectionStatus === 'connecting') {
    return 'WhatsApp is reconnecting. Wait a few seconds and try CONNECT DEVICE again.';
  }
  return connectionError || 'WhatsApp backend is not ready. Try again shortly.';
}

function scheduleReconnect() {
  if (reconnectTimer || connectionStatus === 'logged_out') return;
  if (sock && !pairingReady) {
    try { sock.end(new Error('Replacing closed WhatsApp socket')); } catch (error) {}
    sock = null;
  }
  const wait = Math.min(30000, 1000 * Math.pow(2, Math.min(reconnectAttempts, 5)));
  reconnectAttempts += 1;
  connectionStatus = 'reconnecting';
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startBot().catch(error => console.error('Reconnect failed:', error.message));
  }, wait);
}

async function waitForPairingSocket(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (authRegistered) {
      throw new Error('This backend already has a registered WhatsApp session.');
    }
    if (sock && (connectionStatus === 'connecting' || connectionStatus === 'open')) {
      return sock;
    }
    if (!sock && !startPromise && connectionStatus !== 'logged_out') {
      startBot().catch(error => console.error('Pairing start failed:', error.message));
    }
    await delay(250);
  }
  throw new Error(publicConnectionError());
}

async function startBot() {
  if (startPromise) return startPromise;
  const currentStart = (async () => {
    connectionStatus = 'starting';
    connectionError = null;
    const { state, saveCreds } = await useMultiFileAuthState(process.env.AUTH_DIR || 'auth_info');
    authRegistered = Boolean(state.creds.registered);
    const currentSock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['KIUBY XMD', 'Chrome', '1.0.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
    });
    sock = currentSock;
    connectionStatus = 'connecting';
    currentSock.ev.on('creds.update', saveCreds);
    currentSock.ev.on('connection.update', update => {
      if (currentSock !== sock) return;
      const { connection, lastDisconnect } = update;
      if (connection === 'connecting') {
        pairingReady = false;
        connectionStatus = 'connecting';
        connectionError = null;
      } else if (connection === 'open') {
        pairingReady = true;
        connectionStatus = 'open';
        connectionError = null;
        reconnectAttempts = 0;
        console.log('WhatsApp connected for ' + 'KIUBY XMD');
      } else if (connection === 'close') {
        pairingReady = false;
        const code = disconnectCode(lastDisconnect?.error);
        connectionError = lastDisconnect?.error?.message || 'WhatsApp connection closed';
        connectionStatus = code === DisconnectReason.loggedOut ? 'logged_out' : 'reconnecting';
        sock = null;
        if (code !== DisconnectReason.loggedOut) scheduleReconnect();
        console.log('WhatsApp connection closed:', connectionError, 'code:', code || 'unknown');
      }
    });
      currentSock.ev.on('messages.upsert', async (m) => {
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

    // fromMe messages now allowed
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
  })();
  startPromise = currentStart;
  currentStart.finally(() => {
    if (startPromise === currentStart) startPromise = null;
  });
  return currentStart;
}
let premium = fs.existsSync('./premium.json') ? JSON.parse(fs.readFileSync('./premium.json')) : [];

function isPremium(jid) {
  const num = jid.split('@')[0];
  return premium.includes(num);
}

const ownerOnlyCommands = ["setmenuvideo","trackip","hostip","device","disk","vcc","vcf","statusdelay","statussettings","readreceipts"];
const OWNER_NUMBER = '256731696709';
const commands = ["setmenuvideo","testanticallmsg","testgoodbye","testwelcome","unmute","warn","welcome","blmatches","blscorers","blstandings","blupcoming","clmatches","clscorers","clstandings","clupcoming","eflmatches","eflscorers","eflstandings","eflupcoming","elmatches","elscorers","elstandings","elupcoming","eplmatches","eplscorers","eplstandings","eplupcoming","l1matches","l1scorers","l1standings","l1upcoming","llmatches","llscorers","llstandings","llupcoming","matches","samatches","sascorers","sastandings","saupcoming","scorers","standings","upcoming","wcmatches","wcscorers","wcstandings","wcupcoming","wrestlingevents","wwenews","wweschedule","feedback","helpers","analyze","browse","calculate","code","device","disk","emojimix","fancy","forward","gitclone","gsmarena","hostip","itunes","mediatag","memes","obfuscate","open","opentime","qrcode","quotes","react","readmore","readreceipts","recipe","remini","removebg","reverse","savestatus","say","sendasviewonce","smeme","ssweb","sswebpc","sswebtab","statusdelay","statussettings","story","summarize","summerbeach","take","telesticker","tinyurl","toimage","tostatus","tourl","tovideo","toviewonce","trackip","translate","twaudio","userid","vcc","vcf","videodoc","volaudio","volvideo","vv2","wallpaper","translate2","trivia","webp2mp4"];



app.use('/admin.html', (req, res, next) => {
  const auth = { login: 'kiuby', password: 'Pips256..' };
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
  if (login === auth.login && password === auth.password) {
    return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Admin Only"');
  res.status(401).send('Admin authentication required.');
});

app.use('/admin-data', (req, res, next) => {
  const auth = { login: 'kiuby', password: 'Pips256..' };
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
  if (login === auth.login && password === auth.password) {
    return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Admin Only"');
  res.status(401).send('Admin authentication required.');
});

app.get('/admin-data', (req, res) => {
  res.json({ owner: OWNER_NUMBER, premium: premium });
});

app.post('/admin-data/add', (req, res) => {
  const { number } = req.body;
  const clean = (number || '').replace(/[^0-9]/g, '');
  if (clean && !premium.includes(clean)) {
    premium.push(clean);
    fs.writeFileSync('./premium.json', JSON.stringify(premium));
  }
  res.json({ success: true, premium });
});

app.post('/admin-data/remove', (req, res) => {
  const { number } = req.body;
  const clean = (number || '').replace(/[^0-9]/g, '');
  premium = premium.filter(n => n !== clean);
  fs.writeFileSync('./premium.json', JSON.stringify(premium));
  res.json({ success: true, premium });
});

app.use('/admin.html', (req, res, next) => {
  const auth = { login: 'kiuby', password: 'Pips256..' };
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
  if (login === auth.login && password === auth.password) {
    return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Admin Only"');
  res.status(401).send('Admin authentication required.');
});

app.use('/admin-data', (req, res, next) => {
  const auth = { login: 'kiuby', password: 'Pips256..' };
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
  if (login === auth.login && password === auth.password) {
    return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Admin Only"');
  res.status(401).send('Admin authentication required.');
});

app.get('/admin-data', (req, res) => {
  res.json({ owner: OWNER_NUMBER, premium: premium });
});

app.post('/admin-data/add', (req, res) => {
  const { number } = req.body;
  const clean = (number || '').replace(/[^0-9]/g, '');
  if (clean && premium.indexOf(clean) === -1) {
    premium.push(clean);
    fs.writeFileSync('./premium.json', JSON.stringify(premium));
  }
  res.json({ success: true, premium: premium });
});

app.post('/admin-data/remove', (req, res) => {
  const { number } = req.body;
  const clean = (number || '').replace(/[^0-9]/g, '');
  premium = premium.filter(function(n){ return n !== clean; });
  fs.writeFileSync('./premium.json', JSON.stringify(premium));
  res.json({ success: true, premium: premium });
});

app.post('/pair', async (req, res) => {
  const rawNumber = String(req.body?.number || '');
  const number = rawNumber.replace(/\D/g, '');
  if (!number) return res.status(400).json({ error: 'Enter the WhatsApp number with country code.' });
  if (number.length < 8 || number.length > 15) {
    return res.status(400).json({ error: 'Enter a valid international number with country code.' });
  }
  if (authRegistered) {
    return res.status(409).json({ error: 'This bot already has a registered WhatsApp session. Use the existing device or reset the saved session before pairing again.' });
  }
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const activeSocket = await waitForPairingSocket(20000);
      const code = await activeSocket.requestPairingCode(number);
      return res.json({ code, status: 'pairing_code_ready' });
    } catch (error) {
      lastError = error;
      connectionError = error.message || 'Pairing failed';
      if (authRegistered) break;
      if (attempt < 2) {
        scheduleReconnect();
        await delay(1500);
      }
    }
  }
  const isTemporary = !authRegistered && connectionStatus !== 'logged_out';
  return res.status(isTemporary ? 503 : 409).json({ error: isTemporary ? publicConnectionError() : (lastError?.message || publicConnectionError()) });
});

app.get('/status', (req, res) => {
  res.json({
    connected: pairingReady,
    status: connectionStatus,
    pairingAvailable: !authRegistered && connectionStatus !== 'logged_out',
    error: pairingReady ? null : publicConnectionError(),
  });
});

startBot();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
