const crypto = require('crypto');
const fs = require('fs');
const readline = require('readline');

const ALG = 'aes-256-gcm';
const SALT_LEN = 32, IV_LEN = 12, TAG_LEN = 16, KEY_LEN = 32, ITER = 100000;

function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(prompt, a => { rl.close(); r(a.trim()); }));
}

async function main() {
  const keyFile = process.argv[2] || '.key';
  const apiKey  = await ask('API-Key eingeben: ');
  const pass    = await ask('Passwort setzen: ');
  const pass2   = await ask('Passwort wiederholen: ');
  if (pass !== pass2) { console.error('Passwoerter stimmen nicht ueberein.'); process.exit(1); }

  const salt   = crypto.randomBytes(SALT_LEN);
  const iv     = crypto.randomBytes(IV_LEN);
  const dk     = crypto.pbkdf2Sync(pass, salt, ITER, KEY_LEN, 'sha256');
  const cipher = crypto.createCipheriv(ALG, dk, iv);
  const enc    = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();

  fs.writeFileSync(keyFile, Buffer.concat([salt, iv, tag, enc]));
  console.log(`Gespeichert: ${keyFile}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });