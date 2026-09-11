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
let pairingRequestPromise = null;
let socketGeneration = 0;
let socketStartedAt = 0;
const temporaryMailboxes = new Map();

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

function closeSocket(currentSock) {
  if (!currentSock) return;
  try {
    currentSock.ev.removeAllListeners();
  } catch (error) {}
  try {
    currentSock.end(new Error('Replacing closed WhatsApp socket'));
  } catch (error) {}
}

function scheduleReconnect() {
  if (reconnectTimer || connectionStatus === 'logged_out') return;
  const oldSocket = sock;
  sock = null;
  pairingReady = false;
  closeSocket(oldSocket);
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
    // Pairing sockets may remain in "connecting" until the phone links, but
    // calling requestPairingCode immediately can throw 428. Give the transport
    // a short warm-up period, then allow the retry loop to replace it if needed.
    const warmedUp = socketStartedAt && Date.now() - socketStartedAt >= 3000;
    if (sock && (connectionStatus === 'open' || (connectionStatus === 'connecting' && warmedUp))) {
      return sock;
    }
    if (!sock && !startPromise && !reconnectTimer && connectionStatus !== 'logged_out') {
      startBot().catch(error => console.error('Pairing start failed:', error.message));
    }
    await delay(250);
  }
  throw new Error(publicConnectionError());
}

const FREE_FEATURE_UNAVAILABLE = 'Feature unavailable: no free API found.';
const PAID_FEATURE_UNAVAILABLE = 'Feature needs a paid API key, not yet available.';

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}) {
  return (await fetchWithTimeout(url, options)).json();
}

async function fetchText(url, options = {}) {
  return (await fetchWithTimeout(url, options)).text();
}

async function fetchBuffer(url, options = {}) {
  return Buffer.from(await (await fetchWithTimeout(url, options)).arrayBuffer());
}

function commandArgs(text) {
  return text.trim().split(/\s+/).slice(1);
}

function argumentText(text) {
  return commandArgs(text).join(' ').trim();
}

function withQuery(url, query) {
  return `${url}${url.includes('?') ? '&' : '?'}${new URLSearchParams(query).toString()}`;
}

function reverseText(value) {
  return Array.from(value).reverse().join('');
}

function fancyText(value) {
  const normal = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bold = '𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵';
  return Array.from(value).map(char => {
    const index = normal.indexOf(char);
    return index === -1 ? char : bold[index];
  }).join('');
}

function safeCalculate(expression) {
  const tokens = expression.match(/\d+(?:\.\d+)?|[()+\-*/%^]/g);
  if (!tokens || tokens.join('') !== expression.replace(/\s+/g, '')) {
    throw new Error('Invalid calculation');
  }
  let position = 0;
  const peek = () => tokens[position];
  const consume = token => {
    if (token && peek() !== token) throw new Error('Invalid calculation');
    return tokens[position++];
  };
  const primary = () => {
    if (peek() === '(') {
      consume('(');
      const value = addSub();
      consume(')');
      return value;
    }
    const value = Number(consume());
    if (!Number.isFinite(value)) throw new Error('Invalid calculation');
    return value;
  };
  const unary = () => {
    if (peek() === '+') {
      consume('+');
      return unary();
    }
    if (peek() === '-') {
      consume('-');
      return -unary();
    }
    return primary();
  };
  const power = () => {
    const left = unary();
    if (peek() === '^') {
      consume('^');
      return left ** power();
    }
    return left;
  };
  const mulDiv = () => {
    let value = power();
    while (['*', '/', '%'].includes(peek())) {
      const operator = consume();
      const right = power();
      if (operator === '*') value *= right;
      if (operator === '/') value /= right;
      if (operator === '%') value %= right;
    }
    return value;
  };
  const addSub = () => {
    let value = mulDiv();
    while (['+', '-'].includes(peek())) {
      const operator = consume();
      const right = mulDiv();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };
  const result = addSub();
  if (position !== tokens.length || !Number.isFinite(result)) throw new Error('Invalid calculation');
  return result;
}

async function sendRemoteImage(currentSock, recipient, url, caption) {
  const image = await fetchBuffer(url);
  await currentSock.sendMessage(recipient, { image, ...(caption ? { caption } : {}) });
}

function localReply(word, args) {
  const joined = args.join(' ');
  const replies = {
    pickup: 'You are the kind of person someone writes a pickup line about.',
    lovequote: 'Love grows where people choose patience, honesty, and small acts of care.',
    romantic: 'I like the way you make ordinary moments feel worth remembering.',
    flirt: 'Are you a notification? Because I keep hoping you show up.',
    missyou: 'Missing someone is proof that a moment mattered.',
    kiss: 'Sending a warm, respectful virtual kiss 💋',
    hug: 'Sending you a big virtual hug 🤗',
    cuddle: 'Cuddle mode: activated 🧸',
    propose: 'My proposal: more laughter, fewer mixed signals. 💍',
    wedding: 'A good wedding starts with two people who keep choosing each other.',
    ship: 'The compatibility forecast is looking promising 🚢',
    match: 'Match score: 87%. The rest depends on communication.',
    soulmate: 'A soulmate is built through mutual effort, not just discovered.',
    roast: 'You bring a lot to the table. Mostly questions, but still.',
    breakup: 'Protect your peace, be honest, and do not turn closure into another argument.',
    hate: 'Take a breath before turning a hard feeling into a permanent message.',
    insult: 'I only serve playful banter here—no cruelty.',
    trash: 'That belongs in the bin: the bad idea, not the person.',
    clown: 'The circus called; it wants its confidence back. 🤡',
    fake: 'If it needs a performance to survive, it probably needs the truth instead.',
    stupid: 'No insults needed. Ask a clearer question and try again.',
    idiot: 'Everyone has an off day. This one can end here.',
    loser: 'A setback is an event, not an identity.',
    finance: 'Track income, fixed costs, variable costs, and savings before making a money decision.',
    invest: 'Diversify, understand the downside, and never invest money you need soon.',
    'money-tip': 'Automate a small savings transfer on payday before spending the rest.',
    advice: 'Choose the option that keeps tomorrow easier, not just today faster.',
    motivation: 'Make the next step small enough that you can do it now.',
    friendship: 'Good friendship is consistent care without keeping score.',
    dating: 'Be direct about intentions and kind about boundaries.',
    marriage: 'Strong marriages are built in ordinary conversations, not only grand gestures.',
    meditate: 'Try five slow breaths: inhale for four, exhale for six.',
    nature: 'Look away from the screen and notice five things around you.',
    darkquote: 'Even a difficult chapter can end without becoming the whole story.',
    gita: 'Focus on the work in front of you, while releasing the need to control every result.',
  };
  return replies[word] || `Here is a small prompt for ${word}: ${joined || 'take one useful step today.'}`;
}

async function getTemporaryInbox(sender, create = false) {
  if (!temporaryMailboxes.has(sender) && create) {
    const login = `kiuby${Date.now()}${Math.floor(Math.random() * 1000)}`;
    temporaryMailboxes.set(sender, { login, domain: '1secmail.com' });
  }
  return temporaryMailboxes.get(sender);
}

async function startBot() {
  if (startPromise) return startPromise;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
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
    const generation = ++socketGeneration;
    sock = currentSock;
    socketStartedAt = Date.now();
    connectionStatus = 'connecting';
    currentSock.ev.on('creds.update', async creds => {
      await saveCreds(creds);
      authRegistered = Boolean(state.creds.registered);
    });
    currentSock.ev.on('connection.update', update => {
      if (currentSock !== sock || generation !== socketGeneration) return;
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
        if (code === DisconnectReason.loggedOut) {
          connectionStatus = 'logged_out';
          sock = null;
        } else {
          connectionStatus = 'reconnecting';
          scheduleReconnect();
        }
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
    const word = (text.toLowerCase().split(/\s+/)[0] || '').replace(/^[/!.]/, '');

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

◆ *FREE COMMANDS* ◆
${requestedCommandList.join(' • ')}

📢 Channel: https://whatsapp.com/channel/0029Vb7Qi89C1Fu9Bxitnr3m
👥 Group: https://chat.whatsapp.com/JG77YmPyjON5zZY2n2bPJC?s=cl&p=a&mlu=4&ilr=4` });
      return;
    }

    if (aiCommands.has(word)) {
      await currentSock.sendMessage(sender, { text: FREE_FEATURE_UNAVAILABLE });
      return;
    }

    if (paidCommands.has(word)) {
      await currentSock.sendMessage(sender, { text: PAID_FEATURE_UNAVAILABLE });
      return;
    }

    if (word === 'ssweb') {
      const target = argumentText(text);
      if (!/^https?:\/\//i.test(target)) {
        await currentSock.sendMessage(sender, { text: 'Usage: ssweb https://example.com' });
        return;
      }
      try {
        await sendRemoteImage(currentSock, sender, `https://image.thum.io/get/fullpage/${encodeURIComponent(target)}`, 'Screenshot');
      } catch (error) {
        await currentSock.sendMessage(sender, { text: `${FREE_FEATURE_UNAVAILABLE} Screenshot service is unavailable right now.` });
      }
      return;
    }

    if (word === 'short') {
      const target = argumentText(text);
      if (!/^https?:\/\//i.test(target)) {
        await currentSock.sendMessage(sender, { text: 'Usage: short https://example.com' });
        return;
      }
      try {
        const shortened = await fetchText(withQuery('https://tinyurl.com/api-create.php', { url: target }));
        await currentSock.sendMessage(sender, { text: `Short URL: ${shortened.trim()}` });
      } catch (error) {
        await currentSock.sendMessage(sender, { text: `${FREE_FEATURE_UNAVAILABLE} URL shortener is unavailable right now.` });
      }
      return;
    }

    if (word === 'qrgen' || word === 'qr') {
      const value = argumentText(text);
      if (!value) {
        await currentSock.sendMessage(sender, { text: `Usage: ${word} text-or-url` });
        return;
      }
      try {
        await sendRemoteImage(currentSock, sender, withQuery('https://api.qrserver.com/v1/create-qr-code/', {
          size: '300x300',
          data: value,
        }), 'QR code');
      } catch (error) {
        await currentSock.sendMessage(sender, { text: `${FREE_FEATURE_UNAVAILABLE} QR service is unavailable right now.` });
      }
      return;
    }

    if (word === 'google' || word === 'gimage') {
      const query = argumentText(text);
      if (!query) {
        await currentSock.sendMessage(sender, { text: `Usage: ${word} search terms` });
        return;
      }
      const base = word === 'gimage' ? 'https://www.google.com/search?tbm=isch&q=' : 'https://www.google.com/search?q=';
      await currentSock.sendMessage(sender, { text: `${word === 'gimage' ? 'Google Images' : 'Google'}: ${base}${encodeURIComponent(query)}` });
      return;
    }

    if (word === 'npm') {
      const packageName = commandArgs(text)[0];
      if (!packageName) {
        await currentSock.sendMessage(sender, { text: 'Usage: npm package-name' });
        return;
      }
      try {
        const info = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`);
        await currentSock.sendMessage(sender, { text: `${info.name}@${info.version}\n${info.description || 'No description'}\n${info.homepage || `https://www.npmjs.com/package/${info.name}`}` });
      } catch (error) {
        await currentSock.sendMessage(sender, { text: 'NPM package not found or the free registry is unavailable.' });
      }
      return;
    }

    if (word === 'weather') {
      const city = argumentText(text);
      if (!city) {
        await currentSock.sendMessage(sender, { text: 'Usage: weather city' });
        return;
      }
      try {
        const weather = await fetchJson(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
        const now = weather.current_condition?.[0];
        const description = now?.weatherDesc?.[0]?.value || 'Unknown';
        await currentSock.sendMessage(sender, { text: `Weather for ${city}: ${description}, ${now?.temp_C ?? '?'}°C, feels like ${now?.FeelsLikeC ?? '?'}°C. Humidity: ${now?.humidity ?? '?'}%.` });
      } catch (error) {
        await currentSock.sendMessage(sender, { text: 'Weather is temporarily unavailable. Try a city name such as weather Kampala.' });
      }
      return;
    }

    if (word === 'define') {
      const term = commandArgs(text)[0];
      if (!term) {
        await currentSock.sendMessage(sender, { text: 'Usage: define word' });
        return;
      }
      try {
        const definitions = await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`);
        const meaning = definitions[0]?.meanings?.[0];
        const definition = meaning?.definitions?.[0]?.definition || 'No definition found.';
        await currentSock.sendMessage(sender, { text: `${term}: ${definition}` });
      } catch (error) {
        await currentSock.sendMessage(sender, { text: 'No definition found.' });
      }
      return;
    }

    if (word === 'movie') {
      await currentSock.sendMessage(sender, { text: 'Movie lookup needs a paid API key, not yet available.' });
      return;
    }

    if (word === 'translate') {
      const args = commandArgs(text);
      const targetLanguage = /^[a-z]{2}$/i.test(args[0] || '') ? args.shift() : 'sw';
      const phrase = args.join(' ');
      if (!phrase) {
        await currentSock.sendMessage(sender, { text: 'Usage: translate [language] text' });
        return;
      }
      try {
        const result = await fetchJson(withQuery('https://api.mymemory.translated.net/get', {
          q: phrase,
          langpair: `en|${targetLanguage}`,
        }));
        await currentSock.sendMessage(sender, { text: result.responseData?.translatedText || 'Translation unavailable.' });
      } catch (error) {
        await currentSock.sendMessage(sender, { text: `${FREE_FEATURE_UNAVAILABLE} Translation is unavailable right now.` });
      }
      return;
    }

    if (['waifu', 'neko', 'shinobu', 'megumin'].includes(word)) {
      try {
        const endpoint = word === 'neko' || word === 'shinobu'
          ? `https://nekos.best/api/v2/${word}`
          : `https://api.waifu.pics/sfw/${word}`;
        const result = await fetchJson(endpoint);
        const imageUrl = result.url || result.results?.[0]?.url;
        if (!imageUrl) throw new Error('No image');
        await sendRemoteImage(currentSock, sender, imageUrl, word);
      } catch (error) {
        await currentSock.sendMessage(sender, { text: `${FREE_FEATURE_UNAVAILABLE} Image service is unavailable right now.` });
      }
      return;
    }

    if (word === 'fancy' || word === 'styletext') {
      const value = argumentText(text);
      await currentSock.sendMessage(sender, { text: value ? fancyText(value) : `Usage: ${word} your text` });
      return;
    }

    if (word === 'flip') {
      const value = argumentText(text);
      await currentSock.sendMessage(sender, { text: value ? reverseText(value) : 'Usage: flip your text' });
      return;
    }

    if (word === 'calc') {
      try {
        await currentSock.sendMessage(sender, { text: `Result: ${safeCalculate(argumentText(text))}` });
      } catch (error) {
        await currentSock.sendMessage(sender, { text: 'Invalid calculation. Example: calc (12 + 3) * 2' });
      }
      return;
    }

    if (word === 'ping' || word === 'alive' || word === 'runtime') {
      const uptime = Math.floor(process.uptime());
      await currentSock.sendMessage(sender, { text: word === 'ping' ? 'Pong 🏓' : `Bot is online. Runtime: ${uptime}s. Status: ${connectionStatus}.` });
      return;
    }

    if (word === 'creator' || word === 'owner') {
      await currentSock.sendMessage(sender, { text: 'Creator: Kiuby\nOwner contact: 256731696709' });
      return;
    }

    if (word === 'repo') {
      await currentSock.sendMessage(sender, { text: 'Repository: https://github.com/alelephillips-cmyk/mywebsite' });
      return;
    }

    if (word === 'help') {
      await currentSock.sendMessage(sender, { text: 'Send menu to see the command list. Most commands accept their argument after the command name, for example: weather Kampala or define resilience.' });
      return;
    }

    if (['sticker', 'takesticker', 'smeme', 'toimg', 'tomp3', 'togif', 'tovideo', 'tourl', 'telegraph', 'catbox', 'stickertomp4'].includes(word)) {
      await currentSock.sendMessage(sender, { text: 'This media command needs a quoted media file and a conversion/upload service; it is not enabled without adding a paid API or media runtime.' });
      return;
    }

    if (word === 'tempmail') {
      const mailbox = await getTemporaryInbox(sender, true);
      await currentSock.sendMessage(sender, { text: `Temporary email: ${mailbox.login}@${mailbox.domain}\nUse tempinbox to check messages. This mailbox is kept only in this bot process.` });
      return;
    }

    if (word === 'tempinbox') {
      const mailbox = await getTemporaryInbox(sender);
      if (!mailbox) {
        await currentSock.sendMessage(sender, { text: 'No temporary mailbox yet. Send tempmail first.' });
        return;
      }
      try {
        const messages = await fetchJson(withQuery('https://www.1secmail.com/api/v1/', {
          action: 'getMessages',
          login: mailbox.login,
          domain: mailbox.domain,
        }));
        if (!messages.length) {
          await currentSock.sendMessage(sender, { text: `${mailbox.login}@${mailbox.domain}\nInbox is empty.` });
          return;
        }
        const lines = messages.slice(0, 10).map(message => `${message.id}: ${message.from} — ${message.subject}`);
        await currentSock.sendMessage(sender, { text: `${mailbox.login}@${mailbox.domain}\n${lines.join('\n')}` });
      } catch (error) {
        await currentSock.sendMessage(sender, { text: `${FREE_FEATURE_UNAVAILABLE} Temporary inbox is unavailable right now.` });
      }
      return;
    }

    if (word === 'technews' || word === 'tech' || word === 'tnews') {
      try {
        const ids = (await fetchJson('https://hacker-news.firebaseio.com/v0/topstories.json')).slice(0, 5);
        const stories = await Promise.all(ids.map(id => fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)));
        await currentSock.sendMessage(sender, { text: stories.map((story, index) => `${index + 1}. ${story.title}\n${story.url || `https://news.ycombinator.com/item?id=${story.id}`}`).join('\n\n') });
      } catch (error) {
        await currentSock.sendMessage(sender, { text: `${FREE_FEATURE_UNAVAILABLE} Tech news is unavailable right now.` });
      }
      return;
    }

    if (['bible', 'verse', 'kjv', 'bbe'].includes(word)) {
      const reference = argumentText(text) || 'John 3:16';
      try {
        const verse = await fetchJson(`https://bible-api.com/${encodeURIComponent(reference)}`);
        await currentSock.sendMessage(sender, { text: `${verse.reference || reference}\n${verse.text || 'Verse unavailable.'}` });
      } catch (error) {
        await currentSock.sendMessage(sender, { text: 'Verse not found. Try: bible John 3:16' });
      }
      return;
    }

    if (word === 'quran' || word === 'surah') {
      const surah = Number(commandArgs(text)[0] || 1);
      try {
        const result = await fetchJson(`https://api.alquran.cloud/v1/surah/${Math.min(114, Math.max(1, surah))}/en.asad`);
        const ayahs = result.data?.ayahs?.slice(0, 3).map(ayah => `${ayah.numberInSurah}. ${ayah.text}`).join('\n');
        await currentSock.sendMessage(sender, { text: `${result.data?.englishName || 'Surah'}\n${ayahs || 'Surah unavailable.'}` });
      } catch (error) {
        await currentSock.sendMessage(sender, { text: `${FREE_FEATURE_UNAVAILABLE} Quran service is unavailable right now.` });
      }
      return;
    }

    if (['hadith', 'darkquote', 'gita', 'artinama', 'artimimpi', 'ramalanjodoh', 'jodoh', 'zodiak', 'zodiac', 'shio', 'weton', 'pekerjaan', 'karir', 'rejeki', 'rezeki', 'pernikahan', 'nikah', 'sifat', 'karakter', 'keberuntungan', 'hoki', 'lucky'].includes(word)) {
      await currentSock.sendMessage(sender, { text: localReply(word, commandArgs(text)) });
      return;
    }

    if (romanceCommands.has(word) || adviceCommands.has(word)) {
      await currentSock.sendMessage(sender, { text: localReply(word, commandArgs(text)) });
      return;
    }

    if (word === 'pair') {
      await currentSock.sendMessage(sender, { text: 'Use the pairing page to connect a number. The bot will reject duplicate pairing requests while a session is active.' });
      return;
    }

    if (word === 'listpaired') {
      await currentSock.sendMessage(sender, { text: `Session status: ${connectionStatus}\nRegistered: ${authRegistered ? 'yes' : 'no'}\nConnected: ${pairingReady ? 'yes' : 'no'}` });
      return;
    }

    if (word === 'check-ban-status') {
      await currentSock.sendMessage(sender, { text: 'Ban status cannot be checked reliably without an official WhatsApp account endpoint. Contact WhatsApp Support if the app shows a ban.' });
      return;
    }

    if (word === 'unban-num') {
      await currentSock.sendMessage(sender, { text: 'This bot cannot remove WhatsApp bans or submit appeals on someone else’s behalf. Use the official in-app appeal flow.' });
      return;
    }

    if (word === 'support') {
      await currentSock.sendMessage(sender, { text: 'For WhatsApp account support, use https://www.whatsapp.com/contact/ . For bot support, contact the owner listed in the menu.' });
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
        const result = safeCalculate(argumentText(text));
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
  }).catch(() => {});
  return currentStart;
}
let premium = fs.existsSync('./premium.json') ? JSON.parse(fs.readFileSync('./premium.json')) : [];

function isPremium(jid) {
  const num = jid.split('@')[0];
  return premium.includes(num);
}

const ownerOnlyCommands = ["setmenuvideo","trackip","hostip","device","disk","vcc","vcf","statusdelay","statussettings","readreceipts"];
const OWNER_NUMBER = '256731696709';
const requestedCommandList = [
  'chatgpt', 'deepseek', 'gemini', 'llama', 'grok',
  'ocr', 'removebg', 'upscale',
  'ssweb', 'short', 'qrgen', 'google', 'gimage', 'npm', 'weather', 'define', 'movie', 'translate',
  'waifu', 'neko', 'shinobu', 'megumin',
  'fancy', 'styletext', 'flip',
  'sticker', 'takesticker', 'smeme', 'toimg', 'tomp3', 'togif', 'tovideo', 'qr', 'calc', 'ping', 'runtime', 'alive', 'creator', 'repo', 'owner', 'help',
  'tourl', 'telegraph', 'catbox', 'stickertomp4',
  'tempmail', 'tempinbox',
  'technews', 'tech', 'tnews',
  'artinama', 'artimimpi', 'ramalanjodoh', 'jodoh', 'zodiak', 'zodiac', 'shio', 'weton', 'pekerjaan', 'karir', 'rejeki', 'rezeki', 'pernikahan', 'nikah', 'sifat', 'karakter', 'keberuntungan', 'hoki', 'lucky',
  'pickup', 'lovequote', 'romantic', 'flirt', 'missyou', 'kiss', 'hug', 'cuddle', 'propose', 'wedding', 'ship', 'match', 'soulmate', 'roast', 'breakup', 'hate', 'insult', 'trash', 'clown', 'fake', 'stupid', 'idiot', 'loser',
  'finance', 'invest', 'money-tip', 'advice', 'motivation', 'friendship', 'dating', 'marriage', 'meditate', 'nature',
  'bible', 'verse', 'kjv', 'bbe', 'quran', 'surah', 'hadith', 'darkquote', 'gita',
  'pair', 'listpaired',
  'check-ban-status', 'unban-num', 'support',
];
const aiCommands = new Set(['chatgpt', 'deepseek', 'gemini', 'llama', 'grok']);
const paidCommands = new Set(['ocr', 'removebg', 'upscale']);
const romanceCommands = new Set(['pickup', 'lovequote', 'romantic', 'flirt', 'missyou', 'kiss', 'hug', 'cuddle', 'propose', 'wedding', 'ship', 'match', 'soulmate', 'roast', 'breakup', 'hate', 'insult', 'trash', 'clown', 'fake', 'stupid', 'idiot', 'loser']);
const adviceCommands = new Set(['finance', 'invest', 'money-tip', 'advice', 'motivation', 'friendship', 'dating', 'marriage', 'meditate', 'nature']);
const requestedCommandSet = new Set(requestedCommandList);
const existingCommands = ["setmenuvideo","testanticallmsg","testgoodbye","testwelcome","unmute","warn","welcome","blmatches","blscorers","blstandings","blupcoming","clmatches","clscorers","clstandings","clupcoming","eflmatches","eflscorers","eflstandings","eflupcoming","elmatches","elscorers","elstandings","elupcoming","eplmatches","eplscorers","eplstandings","eplupcoming","l1matches","l1scorers","l1standings","l1upcoming","llmatches","llscorers","llstandings","llupcoming","matches","samatches","sascorers","sastandings","saupcoming","scorers","standings","upcoming","wcmatches","wcscorers","wcstandings","wcupcoming","wrestlingevents","wwenews","wweschedule","feedback","helpers","analyze","browse","calculate","code","device","disk","emojimix","fancy","forward","gitclone","gsmarena","hostip","itunes","mediatag","memes","obfuscate","open","opentime","qrcode","quotes","react","readmore","readreceipts","recipe","remini","removebg","reverse","savestatus","say","sendasviewonce","smeme","ssweb","sswebpc","sswebtab","statusdelay","statussettings","story","summarize","summerbeach","take","telesticker","tinyurl","toimage","tostatus","tourl","tovideo","toviewonce","trackip","translate","twaudio","userid","vcc","vcf","videodoc","volaudio","volvideo","vv2","wallpaper","translate2","trivia","webp2mp4"];
const commands = [...new Set([...existingCommands, ...requestedCommandList])];



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
  if (pairingRequestPromise) {
    return res.status(409).json({ error: 'A pairing request is already in progress. Wait for it to finish before trying again.' });
  }
  let lastError = null;
  pairingRequestPromise = (async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const activeSocket = await waitForPairingSocket(20000);
        const code = await activeSocket.requestPairingCode(number);
        return code;
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
    return null;
  })();
  try {
    const code = await pairingRequestPromise;
    if (code) return res.json({ code, status: 'pairing_code_ready' });
  } finally {
    pairingRequestPromise = null;
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

startBot().catch(error => {
  connectionError = error.message || 'WhatsApp startup failed';
  console.error('Initial WhatsApp startup failed:', error);
  scheduleReconnect();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
