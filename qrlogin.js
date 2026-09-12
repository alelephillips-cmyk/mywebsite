require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (u) => {
    if (u.connection === 'open') console.log('LINKED SUCCESSFULLY');
  });
}

start();
