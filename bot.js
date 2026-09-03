const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

let sock;
let premium = fs.existsSync('./premium.json') ? JSON.parse(fs.readFileSync('./premium.json')) : [];

function isPremium(jid) {
  const num = jid.split('@')[0];
  return premium.includes(num);
}

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
    if (!msg.message || msg.key.fromMe) return;
    const sender = msg.key.remoteJid;
    const text = msg.message.conversation || '';

    if (text.toLowerCase() === 'hi') {
      await sock.sendMessage(sender, { text: 'Hello! Bot is online.' });
    }

    if (text.toLowerCase() === 'premium' && !isPremium(sender)) {
      await sock.sendMessage(sender, { text: 'This is a premium feature. Contact the owner to get access.' });
    }
  });
}

startBot();

module.exports = {
  sendMessage: (jid, text) => sock ? sock.sendMessage(jid, { text }) : null
};
