require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const token = process.env.TELEGRAM_TOKEN;
const ownerId = process.env.OWNER_ID;
const bot = new TelegramBot(token, { polling: true });

let premium = fs.existsSync('./premium.json') ? JSON.parse(fs.readFileSync('./premium.json')) : [];

function savePremium() {
  fs.writeFileSync('./premium.json', JSON.stringify(premium, null, 2));
}

bot.onText(/\/addpremium (.+)/, (msg, match) => {
  if (String(msg.from.id) !== ownerId) return;
  const id = match[1].trim();
  if (!premium.includes(id)) premium.push(id);
  savePremium();
  bot.sendMessage(msg.chat.id, `Added ${id} to premium.`);
});

bot.onText(/\/removepremium (.+)/, (msg, match) => {
  if (String(msg.from.id) !== ownerId) return;
  const id = match[1].trim();
  premium = premium.filter(p => p !== id);
  savePremium();
  bot.sendMessage(msg.chat.id, `Removed ${id} from premium.`);
});

bot.onText(/\/premiumlist/, (msg) => {
  if (String(msg.from.id) !== ownerId) return;
  bot.sendMessage(msg.chat.id, premium.length ? premium.join('\n') : 'No premium users yet.');
});

function loadWhatsAppBot() {
  return require('./bot.js');
}
let waBot = null;

bot.onText(/\/startwa/, (msg) => {
  if (String(msg.from.id) !== ownerId) return;
  if (waBot) return bot.sendMessage(msg.chat.id, 'Already running.');
  delete require.cache[require.resolve('./bot.js')];
  waBot = loadWhatsAppBot();
  bot.sendMessage(msg.chat.id, 'WhatsApp bot started.');
});

bot.onText(/\/stopwa/, (msg) => {
  if (String(msg.from.id) !== ownerId) return;
  bot.sendMessage(msg.chat.id, 'Stop only works if bot.js exposes a stop function.');
});

bot.onText(/\/sendwa (.+)/, (msg, match) => {
  if (String(msg.from.id) !== ownerId) return;
  const [jid, ...rest] = match[1].split('|');
  const text = rest.join('|').trim();
  if (!waBot || !waBot.sendMessage) return bot.sendMessage(msg.chat.id, 'WA bot not ready or no sendMessage export.');
  waBot.sendMessage(jid.trim(), text);
  bot.sendMessage(msg.chat.id, 'Sent.');
});

module.exports = { bot, premium };
