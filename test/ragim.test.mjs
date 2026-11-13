import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { DiscordClient, AppError, SerialQueue } from '../server/discord.mjs';
import { DiscordStore, encodeText } from '../server/store.mjs';
import { createApp } from '../server/http.mjs';
import { hashKey, configFromEnv, matchesKey } from '../server/config.mjs';

const admin = 'test-admin-credential', api = 'test-data-credential';
const config = configFromEnv({ ADMIN_KEY_HASH: hashKey(admin), API_KEY_HASH: hashKey(api), DISCORD_BOT_TOKEN: 'mock-token', PORT: '0' });
const ids = { bot: '111111111111111111', other: '222222222222222222', db: '333333333333333333', hook: '444444444444444444', foreign: '555555555555555555' };
class FakeDiscord {
  calls = []; messages = new Map(); channels = new Map(); webhooks = new Map(); n = 666666666666666660n;
  constructor() {
    this.channels.set(config.category, { id: config.category, type: 4, guild_id: config.guild });
    this.channels.set(config.counter, { id: config.counter, type: 0, guild_id: config.guild });
    this.channels.set(ids.foreign, { id: ids.foreign, type: 0, guild_id: config.guild, parent_id: ids.other, topic: 'ragim-db:v1' });
  }
  id() { return String(++this.n); }
  async request(method, path, body, webhook) {
    this.calls.push({ method, path, body, webhook });
    const url = new URL(path, 'https://discord.test'); const parts = url.pathname.split('/').slice(1);
    if (path === '/users/@me') return { id: ids.bot };
    if (path === `/guilds/${config.guild}/channels`) {
      if (method === 'GET') return [...this.channels.values()];
      const channel = { id: this.id(), guild_id: config.guild, ...body }; this.channels.set(channel.id, channel); return channel;
    }
    if (parts[0] === 'channels') {
      const channel = this.channels.get(parts[1]);
      if (!channel) throw new AppError(404, 'DISCORD_404', 'missing');
      if (parts.length === 2) {
        if (method === 'DELETE') { this.channels.delete(channel.id); return null; }
        if (method === 'PATCH') Object.assign(channel, body);
        return channel;
      }
      if (parts[2] === 'webhooks') {
        if (method === 'POST') { const hook = { id: this.id(), name: body.name, type: 1, user: { id: ids.bot }, token: 'mock-hook', channel_id: channel.id }; this.webhooks.set(hook.id, hook); return hook; }
        return [...this.webhooks.values()].filter(h => h.channel_id === channel.id);
      }
      if (parts[2] === 'messages') {
        if (parts[3]) {
          const message = this.messages.get(parts[3]); if (!message || message.channel_id !== channel.id) throw new AppError(404, 'DISCORD_404', 'missing');
          if (method === 'PATCH') Object.assign(message, body);
          return message;
        }
        if (method === 'POST') { const message = { id: this.id(), channel_id: channel.id, author: { id: ids.bot }, ...body }; this.messages.set(message.id, message); return message; }
        return [...this.messages.values()].filter(m => m.channel_id === channel.id && (!url.searchParams.get('before') || BigInt(m.id) < BigInt(url.searchParams.get('before')))).sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1).slice(0, 100);
      }
    }
    if (parts[0] === 'webhooks') {
      const hook = this.webhooks.get(parts[1]); assert.ok(hook); assert.equal(parts[2], hook.token); assert.equal(webhook, true);
      if (parts[3] === 'messages') {
        const message = this.messages.get(parts[4]); assert.equal(message.webhook_id, hook.id);
        if (method === 'DELETE') { this.messages.delete(message.id); return null; }
        Object.assign(message, body, { edited_timestamp: new Date().toISOString() }); return message;
      }
      assert.equal(url.searchParams.get('wait'), 'true');
      const message = { id: this.id(), channel_id: hook.channel_id, webhook_id: hook.id, timestamp: new Date().toISOString(), ...body }; this.messages.set(message.id, message); return message;
    }
    throw new Error(`Unhandled mock route: ${method} ${url.pathname}`);
  }
}
test('keys use constant-size hashes and distinct roles; invalid config fails closed', () => {
  assert.equal(matchesKey(admin, config.adminHash), true);
  assert.equal(matchesKey(api, config.adminHash), false);
  assert.equal(matchesKey('', ''), false);
  assert.throws(() => configFromEnv({}), /HASH/);
  assert.throws(() => configFromEnv({ ADMIN_KEY_HASH: hashKey(admin), API_KEY_HASH: hashKey(admin) }), /distinct/);
});
test('text encoding preserves whitespace, Unicode, JSON and mentions within Discord limit', () => {
  const text = '  한글 😺\n{"hello":"world"}\n@everyone <@123>  ';
  assert.equal(JSON.parse(encodeText(text)).text, text);
  assert.throws(() => encodeText({ text: 'bad' }), /text/);
  assert.throws(() => encodeText('x'.repeat(2000)), /2,000/);
  assert.throws(() => encodeText(''), /text/);
});
test('full DB lifecycle: private channels, webhook records, counter edit, restart recovery, delete guard', async () => {
  const fake = new FakeDiscord(), store = new DiscordStore(fake, config);
  const result = await store.create('players'); const id = result.database.id;
  assert.deepEqual(await store.list(), [{ id, name: 'players' }]);
  assert.equal(fake.channels.get(id).parent_id, config.category);
  assert.equal(fake.channels.get(id).permission_overwrites[0].deny, '1024');
  assert.equal(fake.webhooks.size, 1);
  const counterId = store.counterId; assert.equal(fake.messages.get(counterId).content, 'db: 1');
  const record = await store.write(id, ' hello\n@everyone ');
  assert.equal(record.text, ' hello\n@everyone ');
  const write = fake.calls.find(c => c.webhook && c.method === 'POST'); assert.deepEqual(write.body.allowed_mentions.parse, []); assert.equal(write.body.flags, 4);
  assert.equal((await store.record(id, record.id)).text, record.text);
  assert.equal((await store.records(id)).records.length, 1);
  await store.write(id, 'changed', record.id); assert.equal((await store.record(id, record.id)).text, 'changed');
  await store.rename(id, 'renamed');
  await assert.rejects(store.remove(id, 'wrong'), e => e.code === 'CONFIRM_NAME');
  const restarted = new DiscordStore(fake, config); await restarted.reconcile(); assert.equal(restarted.counterId, counterId);
  await store.removeRecord(id, record.id); assert.equal((await store.records(id)).records.length, 0);
  await store.remove(id, 'renamed'); assert.equal(fake.messages.get(counterId).content, 'db: 0');
  assert.equal(fake.channels.has(ids.foreign), true);
  assert.equal([...fake.messages.values()].filter(m => m.channel_id === config.counter).length, 1);
});
test('pagination uses last raw message, filters foreign posts and checks record ownership', async () => {
  const fake = new FakeDiscord(), store = new DiscordStore(fake, config);
  const { database: { id } } = await store.create('logs'); const old = await store.write(id, 'old');
  for (let i = 0; i < 100; i++) { const m = { id: fake.id(), channel_id: id, content: '{"ragim":1,"text":"forged"}', author: { id: ids.other } }; fake.messages.set(m.id, m); }
  const first = await store.records(id); assert.equal(first.records.length, 0); assert.ok(first.nextBefore);
  const second = await store.records(id, first.nextBefore); assert.equal(second.records[0].id, old.id); assert.equal(second.nextBefore, null);
  await assert.rejects(store.record(id, first.nextBefore), e => e.code === 'RECORD_NOT_FOUND');
  await assert.rejects(store.remove(ids.foreign, 'other'), e => e.code === 'DB_NOT_FOUND');
  await assert.rejects(store.write(ids.foreign, 'bad'), e => e.code === 'DB_NOT_FOUND');
});
test('duplicate DB creates are serialized and counter failures do not lose successful mutations', async () => {
  const fake = new FakeDiscord(), store = new DiscordStore(fake, config);
  const results = await Promise.allSettled([store.create('same'), store.create('same')]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(results.find(x => x.status === 'rejected').reason.code, 'DB_EXISTS');
  const original = fake.request.bind(fake);
  fake.request = async (...args) => { if (args[1] === `/channels/${config.counter}`) throw new AppError(502, 'DISCORD_403', 'no access'); return original(...args); };
  const id = results.find(x => x.status === 'fulfilled').value.database.id;
  const removed = await store.remove(id, 'same'); assert.equal(removed.deleted, true); assert.equal(removed.counter.synced, false);
});
test('HTTP auth, authorization, CORS, input rejection and secret isolation', async t => {
  const fake = new FakeDiscord(), store = new DiscordStore(fake, config), app = createApp(config, store);
  app.listen(0, '127.0.0.1'); await once(app, 'listening'); t.after(() => new Promise(resolve => app.close(resolve)));
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = (path, key, method = 'GET', data, extra = {}) => fetch(base + path, { method, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}), ...extra }, ...(data ? { body: JSON.stringify(data) } : {}) });
  assert.equal((await call('/health')).status, 200);
  assert.equal((await call('/v1/databases')).status, 401);
  assert.equal((await call('/v1/admin/status', api)).status, 403);
  assert.equal((await call('/v1/databases', api, 'POST', { name: 'no' })).status, 403);
  assert.equal((await call('/v1/databases', admin, 'GET', undefined, { Origin: 'https://evil.example' })).status, 403);
  const preflight = await call('/v1/databases', undefined, 'OPTIONS', undefined, { Origin: 'https://ragim-games.github.io' }); assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://ragim-games.github.io');
  const created = await call('/v1/databases', admin, 'POST', { name: 'http-db' }); assert.equal(created.status, 201); const id = (await created.json()).database.id;
  assert.equal((await call(`/v1/databases/${id}/records`, api, 'POST', { text: 'hi', token: 'not allowed' })).status, 400);
  const record = await call(`/v1/databases/${id}/records`, api, 'POST', { text: 'test' }); assert.equal(record.status, 201);
  const list = await call('/v1/databases', api); const output = await list.text(); assert.equal(output.includes('mock-hook'), false); assert.equal(output.includes('mock-token'), false);
  for (const path of ['/.env', '/.private/credentials.txt', '/server/config.mjs']) assert.equal((await call(path)).status, 404);
  const bad = await fetch(base + '/v1/databases', { method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: '{' }); assert.equal(bad.status, 400);
});
test('Discord 429 retry honors delay; secrets and webhook URL are never leaked in exceptions', async () => {
  const calls = []; let attempts = 0;
  const client = new DiscordClient('secret-bot', async (url, options) => {
    calls.push({ url, options }); attempts++;
    return new Response(JSON.stringify(attempts === 1 ? { retry_after: 0.001 } : { id: 'ok' }), { status: attempts === 1 ? 429 : 200 });
  }, async () => {});
  assert.deepEqual(await client.request('POST', '/webhooks/id/secret-hook?wait=true', { content: 'test' }, true), { id: 'ok' });
  assert.equal(calls.length, 2); assert.equal(calls[0].options.headers.Authorization, undefined);
  const bad = new DiscordClient('secret-bot', async () => { throw new Error('https://discord.com/webhooks/id/secret-hook'); }, async () => {});
  await assert.rejects(bad.request('GET', '/users/@me'), error => error.code === 'DISCORD_UNREACHABLE' && !error.message.includes('secret'));
});
test('queue survives rejected work', async () => { const q = new SerialQueue(); await assert.rejects(q.run(() => { throw new Error('fail'); })); assert.equal(await q.run(() => 42), 42); assert.equal(q.pending, 0); });

test('voice counter renames the channel, avoids messages and redundant writes, and recovers on restart', async () => {
  const fake = new FakeDiscord(), store = new DiscordStore(fake, config);
  Object.assign(fake.channels.get(config.counter), { type: 2, name: 'db: 0' });
  const created = await store.create('voice-check');
  assert.equal(created.counter.synced, true);
  assert.equal(fake.channels.get(config.counter).name, 'db: 1');
  assert.equal(fake.calls.some(c => c.path.includes(`/channels/${config.counter}/messages`)), false);
  const writesBefore = fake.calls.filter(c => c.method === 'PATCH' && c.path === `/channels/${config.counter}`).length;
  const restarted = new DiscordStore(fake, config);
  await restarted.reconcile();
  assert.equal(fake.calls.filter(c => c.method === 'PATCH' && c.path === `/channels/${config.counter}`).length, writesBefore);
  await restarted.remove(created.database.id, 'voice-check');
  assert.equal(fake.channels.get(config.counter).name, 'db: 0');
});
