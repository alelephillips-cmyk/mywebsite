const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');

const oldBlock = `if (word === 'tourl' || word === 'catbox') {
  const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) { await sock.sendMessage(sender, { text: 'Reply to an image/video with this command.' }); return; }
  try {
    const type = Object.keys(quoted)[0];
    const stream = await downloadMediaMessage({ message: quoted, key: msg.key }, 'buffer', {});
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', new Blob([stream]), 'file');
    const res = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: form });
    const link = await res.text();
    await sock.sendMessage(sender, { text: link });
  } catch (e) {
    await sock.sendMessage(sender, { text: 'Upload failed: ' + e.message });
  }
  return;
}`;

const newBlock = `if (word === 'tourl' || word === 'catbox') {
  if (!msg.message.imageMessage && !msg.message.videoMessage && !(msg.message.extendedTextMessage?.contextInfo?.quotedMessage)) {
    await sock.sendMessage(sender, { text: 'Reply to an image/video with this command.' });
    return;
  }
  try {
    const buffer = await sock.downloadMediaMessage(msg);
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', new Blob([buffer]), 'file');
    const res = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: form });
    const link = await res.text();
    await sock.sendMessage(sender, { text: link });
  } catch (e) {
    await sock.sendMessage(sender, { text: 'Upload failed: ' + e.message });
  }
  return;
}`;

if (!c.includes(oldBlock)) {
  console.log('NOT FOUND - block text did not match exactly');
} else {
  c = c.replace(oldBlock, newBlock);
  fs.writeFileSync('server.js', c);
  console.log('fixed tourl block');
}
