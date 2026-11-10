import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { hashKey } from '../server/config.mjs';
// Private plaintext output is created exclusively; existing credentials are never overwritten.
const path = new URL('../.private/credentials.txt', import.meta.url);
await mkdir(new URL('../.private/', import.meta.url), { recursive: true, mode: 0o700 });
try { await access(path); console.error('Credentials already exist. Refusing to overwrite.'); process.exit(1); } catch {}
const admin = `rg_admin_${randomBytes(32).toString('base64url')}`;
const api = `rg_live_${randomBytes(32).toString('base64url')}`;
await writeFile(path, `Ragim DB — PRIVATE / DO NOT UPLOAD\n\nADMIN_KEY=${admin}\nAPI_KEY=${api}\n\nADMIN_KEY_HASH=${hashKey(admin)}\nAPI_KEY_HASH=${hashKey(api)}\n`, { flag: 'wx', mode: 0o600 });
try {
  await writeFile(new URL('../.env', import.meta.url), `DISCORD_BOT_TOKEN=\nADMIN_KEY_HASH=${hashKey(admin)}\nAPI_KEY_HASH=${hashKey(api)}\nALLOWED_ORIGINS=https://ragim-games.github.io,http://localhost:10000,http://127.0.0.1:10000\nPORT=10000\n`, { flag: 'wx', mode: 0o600 });
} catch (error) { if (error.code !== 'EEXIST') throw error; console.log('Existing .env preserved; copy the two HASH values manually.'); }
console.log('New keys saved to ignored .private/credentials.txt. Key values are not printed.');
