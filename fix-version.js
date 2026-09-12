const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');
let changes = 0;

// 1. Add fetchLatestBaileysVersion to the import line
const oldImport = `const { default: makeWASocket, useMultiFileAuthState, DisconnectReason`;
if (c.includes(oldImport) && !c.includes('fetchLatestBaileysVersion')) {
  c = c.replace(oldImport, `const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion`);
  changes++;
}

// 2. Fetch the version before creating the socket, and pass it in
const oldLine = `    const currentSock = makeWASocket({
      auth: state,`;
const newLine = `    const { version } = await fetchLatestBaileysVersion();
    const currentSock = makeWASocket({
      version,
      auth: state,`;
if (c.includes(oldLine)) {
  c = c.replace(oldLine, newLine);
  changes++;
}

fs.writeFileSync('server.js', c);
console.log('changes made:', changes);
