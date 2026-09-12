const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');
let count = 0;

c = c.replace(
  /const quoted = msg\.message\.extendedTextMessage\?\.contextInfo\?\.quotedMessage;\s*\n\s*if \(!quoted\) \{ await sock\.sendMessage\(sender, \{ text: 'Reply to an image\/video with this command\.' \}\); return; \}\s*\n\s*try \{\s*\n\s*const type = Object\.keys\(quoted\)\[0\];\s*\n\s*const stream = await downloadMediaMessage\(\{ message: quoted, key: msg\.key \}, 'buffer', \{\}\);/,
  () => {
    count++;
    return `if (!msg.message.imageMessage && !msg.message.videoMessage && !(msg.message.extendedTextMessage?.contextInfo?.quotedMessage)) {
    await sock.sendMessage(sender, { text: 'Reply to an image/video with this command.' });
    return;
  }
  try {
    const stream = await sock.downloadMediaMessage(msg);`;
  }
);

fs.writeFileSync('server.js', c);
console.log('replacements made:', count);
