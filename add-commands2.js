if (word === 'npm') {
  const pkg = text.split(' ').slice(1).join(' ');
  if (!pkg) { await sock.sendMessage(sender, { text: 'Usage: npm <package>' }); return; }
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`);
    const data = await res.json();
    if (data.error) { await sock.sendMessage(sender, { text: 'Package not found.' }); return; }
    const latest = data['dist-tags']?.latest;
    await sock.sendMessage(sender, { text: `${data.name}\nLatest: ${latest}\n${data.description || ''}` });
  } catch (e) {
    await sock.sendMessage(sender, { text: 'Package not found.' });
  }
  return;
}

if (word === 'translate' || word === 'translate2') {
  const parts = text.split(' ');
  const lang = parts[1];
  const input = parts.slice(2).join(' ');
  if (!lang || !input) { await sock.sendMessage(sender, { text: 'Usage: translate <langcode> <text>  e.g. translate fr hello' }); return; }
  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(input)}&langpair=en|${lang}`);
    const data = await res.json();
    await sock.sendMessage(sender, { text: data.responseData?.translatedText || 'Translation failed.' });
  } catch (e) {
    await sock.sendMessage(sender, { text: 'Translation failed.' });
  }
  return;
}

if (['waifu','neko','shinobu','megumin'].includes(word)) {
  try {
    const res = await fetch(`https://api.waifu.pics/sfw/${word}`);
    const data = await res.json();
    await sock.sendMessage(sender, { image: { url: data.url } });
  } catch (e) {
    await sock.sendMessage(sender, { text: 'Could not fetch image right now.' });
  }
  return;
}

if (word === 'zodiac' || word === 'zodiak') {
  const sign = text.split(' ').slice(1).join(' ').toLowerCase();
  const signs = ['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'];
  if (!signs.includes(sign)) { await sock.sendMessage(sender, { text: 'Usage: zodiac <sign>  e.g. zodiac leo' }); return; }
  const lines = {
    aries: 'Bold and driven today — channel that energy into one clear goal.',
    taurus: 'Steady progress beats a rushed leap. Stick to your plan.',
    gemini: 'A conversation today could open an unexpected door.',
    cancer: 'Trust your gut feeling about someone close to you.',
    leo: 'Your confidence is magnetic right now — use it wisely.',
    virgo: 'Small details matter more than usual today.',
    libra: 'Balance is the theme — don\'t overcommit.',
    scorpio: 'A truth you\'ve been avoiding wants attention.',
    sagittarius: 'Adventure calls, but check the map first.',
    capricorn: 'Discipline pays off — keep at it.',
    aquarius: 'An original idea deserves a second look.',
    pisces: 'Your intuition is sharper than usual today.'
  };
  await sock.sendMessage(sender, { text: lines[sign] });
  return;
}

if (word === 'shio') {
  const year = parseInt(text.split(' ')[1]);
  if (!year) { await sock.sendMessage(sender, { text: 'Usage: shio <birth year>  e.g. shio 1998' }); return; }
  const animals = ['Rat','Ox','Tiger','Rabbit','Dragon','Snake','Horse','Goat','Monkey','Rooster','Dog','Pig'];
  const animal = animals[(year - 4) % 12 < 0 ? (year - 4) % 12 + 12 : (year - 4) % 12];
  await sock.sendMessage(sender, { text: `Your Chinese zodiac: ${animal}` });
  return;
}

if (word === 'tempmail') {
  try {
    const res = await fetch('https://www.1secmail.com/api/v1/?action=genRandomMailbox&count=1');
    const data = await res.json();
    await sock.sendMessage(sender, { text: `Temp email: ${data[0]}\nCheck inbox with: tempinbox ${data[0]}` });
  } catch (e) {
    await sock.sendMessage(sender, { text: 'Could not generate temp mail.' });
  }
  return;
}

if (word === 'tempinbox') {
  const email = text.split(' ')[1];
  if (!email || !email.includes('@')) { await sock.sendMessage(sender, { text: 'Usage: tempinbox <email>' }); return; }
  const [login, domain] = email.split('@');
  try {
    const res = await fetch(`https://www.1secmail.com/api/v1/?action=getMessages&login=${login}&domain=${domain}`);
    const data = await res.json();
    if (!data.length) { await sock.sendMessage(sender, { text: 'Inbox is empty.' }); return; }
    const list = data.map(m => `From: ${m.from}\nSubject: ${m.subject}`).join('\n\n');
    await sock.sendMessage(sender, { text: list });
  } catch (e) {
    await sock.sendMessage(sender, { text: 'Could not check inbox.' });
  }
  return;
}

const loveLines = {
  pickup: ['Are you a magnet? Because I\'m attracted to you.', 'Do you have a name, or can I call you mine?'],
  missyou: ['I miss you more than words can say.', 'Every moment apart feels too long.'],
  kiss: ['Sending you a big virtual kiss! 😘'],
  hug: ['Sending you the warmest virtual hug! 🤗'],
  cuddle: ['Wrapping you up in a cozy virtual cuddle 🥰'],
  propose: ['Will you make me the happiest person alive? 💍'],
  wedding: ['Wishing you a lifetime of love and happiness! 👰🤵'],
  soulmate: ['Some connections are just written in the stars.'],
  breakup: ['Sometimes letting go is the hardest kind of love.'],
  roast: ['You bring everyone so much joy... when you leave the room.'],
  hate: ['I don\'t have hate in me — try love instead 💛'],
  insult: ['I\'d rather lift you up than put you down.'],
  trash: ['That\'s not really my style — got something kinder?'],
  clown: ['🤡'],
  fake: ['Keeping it real is always better.'],
  stupid: ['Nobody\'s stupid — just still learning.'],
  idiot: ['Let\'s keep it kind here 🙂'],
  loser: ['Everyone\'s a winner at something.']
};
if (loveLines[word]) {
  const lines = loveLines[word];
  await sock.sendMessage(sender, { text: lines[Math.floor(Math.random() * lines.length)] });
  return;
}

if (word === 'ship' || word === 'match') {
  const percent = Math.floor(Math.random() * 101);
  await sock.sendMessage(sender, { text: `Match compatibility: ${percent}% 💕` });
  return;
}
