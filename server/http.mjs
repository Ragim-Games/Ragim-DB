import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { matchesKey } from './config.mjs';
import { AppError } from './discord.mjs';

const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/config.js', ['config.js', 'text/javascript; charset=utf-8']],
]);
async function body(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new AppError(415, 'JSON_REQUIRED', 'Content-Type: application/json이 필요합니다.');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new AppError(413, 'BODY_TOO_LARGE', '요청 본문이 너무 큽니다.');
    chunks.push(chunk);
  }
  let parsed;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError(400, 'INVALID_JSON', '올바른 JSON 객체가 필요합니다.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AppError(400, 'INVALID_JSON', 'JSON 객체가 필요합니다.');
  return parsed;
}
function onlyKeys(value, keys) {
  if (Object.keys(value).some(k => !keys.includes(k))) throw new AppError(400, 'UNKNOWN_FIELD', `허용된 필드: ${keys.join(', ')}`);
  return value;
}
export function createApp(config, store) {
  const buckets = new Map();
  function limit(key, max) {
    const now = Date.now();
    if (buckets.size > 10000) for (const [k, b] of buckets) if (b.until <= now) buckets.delete(k);
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) { bucket = { count: 0, until: now + 60000 }; buckets.set(key, bucket); }
    if (++bucket.count > max) throw new AppError(429, 'RATE_LIMIT', '요청이 많습니다. 1분 후 다시 시도하세요.');
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' https: http://127.0.0.1:10000 http://localhost:10000; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/health') return json(200, { service: 'ragim-db', ok: true });
      if (req.method === 'GET' && publicFiles.has(path)) {
        const [file, contentType] = publicFiles.get(path);
        res.setHeader('Content-Type', contentType);
        return res.end(await readFile(new URL(`../public/${file}`, import.meta.url)));
      }
      if (!path.startsWith('/v1/')) throw new AppError(404, 'NOT_FOUND', '경로를 찾을 수 없습니다.');
      const origin = req.headers.origin;
      if (origin && !config.origins.includes(origin)) throw new AppError(403, 'ORIGIN_DENIED', '허용되지 않은 웹사이트입니다.');
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' });
        return res.end();
      }
      limit(`ip:${req.socket.remoteAddress}`, 300);
      const authorization = req.headers.authorization || '';
      const key = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      const admin = matchesKey(key, config.adminHash);
      if (!admin && !matchesKey(key, config.apiHash)) throw new AppError(401, 'UNAUTHORIZED', 'API 키 또는 관리자 키가 올바르지 않습니다.');
      limit(admin ? 'admin' : 'api', 120);
      const needsAdmin = () => { if (!admin) throw new AppError(403, 'ADMIN_REQUIRED', '관리자 키가 필요합니다.'); };
      if (req.method === 'GET' && path === '/v1/admin/status') {
        needsAdmin();
        return json(200, { service: 'Ragim DB', configured: Boolean(config.token), guildId: config.guild, categoryId: config.category, counterChannelId: config.counter, counter: store.counterState });
      }
      if (req.method === 'POST' && path === '/v1/admin/sync') { needsAdmin(); return json(200, { counter: await store.reconcile() }); }
      if (path === '/v1/databases') {
        if (req.method === 'GET') return json(200, { databases: await store.list() });
        if (req.method === 'POST') { needsAdmin(); const data = onlyKeys(await body(req), ['name']); return json(201, await store.create(data.name)); }
      }
      const db = path.match(/^\/v1\/databases\/(\d{17,20})$/);
      if (db) {
        needsAdmin();
        if (req.method === 'PATCH') { const data = onlyKeys(await body(req), ['name']); return json(200, { database: await store.rename(db[1], data.name) }); }
        if (req.method === 'DELETE') { const data = onlyKeys(await body(req), ['confirmName']); return json(200, await store.remove(db[1], data.confirmName)); }
      }
      const records = path.match(/^\/v1\/databases\/(\d{17,20})\/records(?:\/(\d{17,20}))?$/);
      if (records) {
        const [, id, recordId] = records;
        if (req.method === 'GET') return json(200, recordId ? { record: await store.record(id, recordId) } : await store.records(id, url.searchParams.get('before')));
        if ((!recordId && req.method === 'POST') || (recordId && req.method === 'PATCH')) {
          const data = onlyKeys(await body(req), ['text']);
          return json(recordId ? 200 : 201, { record: await store.write(id, data.text, recordId) });
        }
        if (recordId && req.method === 'DELETE') return json(200, await store.removeRecord(id, recordId));
      }
      throw new AppError(404, 'NOT_FOUND', '경로 또는 메서드를 확인하세요.');
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      if (error.status === 429) res.setHeader('Retry-After', '60');
      // Unknown failures deliberately redact raw errors (which can contain secrets).
      json(error instanceof AppError ? error.status : 500, { error: { code: error instanceof AppError ? error.code : 'INTERNAL_ERROR', message: error instanceof AppError ? error.message : '서버 오류가 발생했습니다.' } });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return server;
}
