if (word === 'ping') {
  const start = Date.now();
  await sock.sendMessage(sender, { text: `Pong! ${Date.now() - start}ms` });
  return;
}

if (word === 'runtime' || word === 'alive') {
  const uptime = process.uptime();
  const h = Math.floor(uptime / 3600);
  const m = Math.floor((uptime % 3600) / 60);
  await sock.sendMessage(sender, { text: `Bot has been running for ${h}h ${m}m` });
  return;
}

if (word === 'creator' || word === 'owner') {
  await sock.sendMessage(sender, { text: 'Created by Kiuby 💛' });
  return;
}

if (word === 'repo') {
  await sock.sendMessage(sender, { text: 'https://github.com/alelephillips-cmyk/mywebsite' });
  return;
}

if (word === 'fancy') {
  const input = text.split(' ').slice(1).join(' ');
  const map = {a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ꜰ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'s',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ'};
  const out = input.toLowerCase().split('').map(c => map[c] || c).join('');
  await sock.sendMessage(sender, { text: out || 'Usage: fancy <text>' });
  return;
}

if (word === 'flip') {
  const input = text.split(' ').slice(1).join(' ');
  const map = {a:'ɐ',b:'q',c:'ɔ',d:'p',e:'ǝ',f:'ɟ',g:'ƃ',h:'ɥ',i:'ᴉ',j:'ɾ',k:'ʞ',l:'l',m:'ɯ',n:'u',o:'o',p:'d',q:'b',r:'ɹ',s:'s',t:'ʇ',u:'n',v:'ʌ',w:'ʍ',x:'x',y:'ʎ',z:'z'};
  const out = input.toLowerCase().split('').reverse().map(c => map[c] || c).join('');
  await sock.sendMessage(sender, { text: out || 'Usage: flip <text>' });
  return;
}

if (word === 'qr' || word === 'qrgen') {
  const input = text.split(' ').slice(1).join(' ');
  if (!input) { await sock.sendMessage(sender, { text: 'Usage: qr <text>' }); return; }
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(input)}`;
  await sock.sendMessage(sender, { image: { url }, caption: 'Here is your QR code' });
  return;
}

if (word === 'short') {
  const input = text.split(' ').slice(1).join(' ');
  if (!input) { await sock.sendMessage(sender, { text: 'Usage: short <url>' }); return; }
  try {
    const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(input)}`);
    const short = await res.text();
    await sock.sendMessage(sender, { text: short });
  } catch (e) {
    await sock.sendMessage(sender, { text: 'Could not shorten that link.' });
  }
  return;
}

if (word === 'define') {
  const input = text.split(' ').slice(1).join(' ');
  if (!input) { await sock.sendMessage(sender, { text: 'Usage: define <word>' }); return; }
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(input)}`);
    const data = await res.json();
    const def = data[0]?.meanings[0]?.definitions[0]?.definition;
    await sock.sendMessage(sender, { text: def || 'No definition found.' });
  } catch (e) {
    await sock.sendMessage(sender, { text: 'No definition found.' });
  }
  return;
}

if (word === 'weather') {
  const input = text.split(' ').slice(1).join(' ');
  if (!input) { await sock.sendMessage(sender, { text: 'Usage: weather <city>' }); return; }
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(input)}?format=3`);
    const w = await res.text();
    await sock.sendMessage(sender, { text: w.trim() });
  } catch (e) {
    await sock.sendMessage(sender, { text: 'Could not get weather.' });
  }
  return;
}

if (word === 'lovequote' || word === 'romantic') {
  try {
    const res = await fetch('https://api.quotable.io/random?tags=love');
    const data = await res.json();
    await sock.sendMessage(sender, { text: `${data.content} — ${data.author}` });
  } catch (e) {
    await sock.sendMessage(sender, { text: 'Could not fetch a quote right now.' });
  }
  return;
}

if (word === 'advice') {
  try {
    const res = await fetch('https://api.adviceslip.com/advice');
    const data = await res.json();
    await sock.sendMessage(sender, { text: data.slip.advice });
  } catch (e) {
    await sock.sendMessage(sender, { text: 'Could not fetch advice right now.' });
  }
  return;
}

if (word === 'bible' || word === 'verse') {
  const ref = text.split(' ').slice(1).join(' ') || 'john 3:16';
  try {
    const res = await fetch(`https://bible-api.com/${encodeURIComponent(ref)}`);
    const data = await res.json();
    await sock.sendMessage(sender, { text: data.text ? `${data.text}\n— ${data.reference}` : 'Verse not found.' });
  } catch (e) {
    await sock.sendMessage(sender, { text: 'Verse not found.' });
  }
  return;
}
