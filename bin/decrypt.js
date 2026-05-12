const crypto = require('crypto');
const fs = require('fs');

const ALG = 'aes-256-gcm';
const SALT_LEN = 32, IV_LEN = 12, TAG_LEN = 16, KEY_LEN = 32, ITER = 100000;

async function main() {
  const keyFile = process.argv[2];
  if (!keyFile) { process.stderr.write('Usage: node decrypt.js <keyfile>\n'); process.exit(1); }

  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const pass = Buffer.concat(chunks).toString('utf8').trim();

  const data = fs.readFileSync(keyFile);
  const salt = data.subarray(0, SALT_LEN);
  const iv   = data.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag  = data.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const enc  = data.subarray(SALT_LEN + IV_LEN + TAG_LEN);

  const dk = crypto.pbkdf2Sync(pass, salt, ITER, KEY_LEN, 'sha256');
  try {
    const d = crypto.createDecipheriv(ALG, dk, iv);
    d.setAuthTag(tag);
    process.stdout.write(Buffer.concat([d.update(enc), d.final()]).toString('utf8'));
  } catch {
    process.stderr.write('Falsches Passwort.\n');
    process.exit(1);
  }
}

main().catch(e => { process.stderr.write(e.message + '\n'); process.exit(1); });