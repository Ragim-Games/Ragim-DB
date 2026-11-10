import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const patterns = [
  /(?:rg_admin_|rg_live_)[A-Za-z0-9_-]{40,}/,
  /[A-Za-z0-9_-]{23,30}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/,
  /discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9_-]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
let failed = false;
for (const file of files) {
  const forbiddenPath = file.startsWith('.private/') || (file.startsWith('.env') && file !== '.env.example');
  const content = readFileSync(file, 'utf8');
  if (forbiddenPath || patterns.some(p => p.test(content))) { console.error(`Secret check failed: ${file} (value redacted)`); failed = true; }
}
if (failed) process.exit(1);
console.log(`Secret scan passed for ${files.length} tracked files.`);
