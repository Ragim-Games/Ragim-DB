import { createHash, timingSafeEqual } from 'node:crypto';

export function hashKey(value) { return createHash('sha256').update(value).digest('hex'); }
export function matchesKey(value, hash) {
  if (typeof value !== 'string' || value.length > 256 || !/^[a-f0-9]{64}$/.test(hash || '')) return false;
  return timingSafeEqual(Buffer.from(hashKey(value), 'hex'), Buffer.from(hash, 'hex'));
}
export function configFromEnv(env = process.env) {
  const config = {
    token: env.DISCORD_BOT_TOKEN || '',
    adminHash: env.ADMIN_KEY_HASH || '', apiHash: env.API_KEY_HASH || '',
    guild: env.DISCORD_GUILD_ID || '1569731860035145809',
    category: env.DISCORD_CATEGORY_ID || '1569731862740607067',
    counter: env.DISCORD_COUNTER_CHANNEL_ID || '1569733571781075025',
    origins: (env.ALLOWED_ORIGINS || 'https://ragim-games.github.io').split(',').map(x => x.trim()),
    port: Number(env.PORT || 10000),
  };
  if (![config.adminHash, config.apiHash].every(x => /^[a-f0-9]{64}$/.test(x)) || config.adminHash === config.apiHash) {
    throw new Error('Set distinct ADMIN_KEY_HASH and API_KEY_HASH (run npm run keys).');
  }
  if (![config.guild, config.category, config.counter].every(x => /^\d{17,20}$/.test(x))) throw new Error('Invalid Discord IDs.');
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error('Invalid PORT.');
  for (const origin of config.origins) {
    const url = new URL(origin);
    if (url.origin !== origin || (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Invalid ALLOWED_ORIGINS.');
  }
  return config;
}
