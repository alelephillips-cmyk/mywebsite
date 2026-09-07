const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

let sock;
let premium = fs.existsSync('./premium.json') ? JSON.parse(fs.readFileSync('./premium.json')) : [];

function isPremium(jid) {
  const num = jid.split('@')[0];
  return premium.includes(num);
}

const commands = ["setmenuvideo","testanticallmsg","testgoodbye","testwelcome","unmute","warn","welcome","blmatches","blscorers","blstandings","blupcoming","clmatches","clscorers","clstandings","clupcoming","eflmatches","eflscorers","eflstandings","eflupcoming","elmatches","elscorers","elstandings","elupcoming","eplmatches","eplscorers","eplstandings","eplupcoming","l1matches","l1scorers","l1standings","l1upcoming","llmatches","llscorers","llstandings","llupcoming","matches","samatches","sascorers","sastandings","saupcoming","scorers","standings","upcoming","wcmatches","wcscorers","wcstandings","wcupcoming","wrestlingevents","wwenews","wweschedule","feedback","helpers","analyze","browse","calculate","code","device","disk","emojimix","fancy","forward","gitclone","gsmarena","hostip","itunes","mediatag","memes","obfuscate","open","opentime","qrcode","quotes","react","readmore","readreceipts","recipe","remini","removebg","reverse","savestatus","say","sendasviewonce","smeme","ssweb","sswebpc","sswebtab","statusdelay","statussettings","story","summarize","summerbeach","take","telesticker","tinyurl","toimage","tostatus","tourl","tovideo","toviewonce","trackip","translate","twaudio","userid","vcc","vcf","videodoc","volaudio","volvideo","vv2","wallpaper","translate2","trivia","webp2mp4"];

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

    if (msg.key.fromMe) return;
    const sender = msg.key.remoteJid;
    const text = (msg.message.conversation || (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) || '').trim();
    const word = text.toLowerCase().split(' ')[0];

    if (word === 'menu') {
      await sock.sendMessage(sender, { image: { url: '/data/data/com.termux/files/home/botpanel/menu.png' }, caption: commands.join('\n') });
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

    if (commands.includes(word)) {
      await sock.sendMessage(sender, { text: 'My developer is kiuby the greatest developer ever he will come soon, ♥️' });
      return;
    }
  });
}

startBot();

module.exports = {
  sendMessage: (jid, text) => sock ? sock.sendMessage(jid, { text }) : null
};
