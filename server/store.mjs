import { AppError, SerialQueue } from './discord.mjs';
const TOPIC = 'ragim-db:v1';
const WEBHOOK = 'Ragim DB';
const noMentions = { parse: [], users: [], roles: [], replied_user: false };
export function validId(id) {
  if (!/^\d{17,20}$/.test(id || '')) throw new AppError(400, 'INVALID_ID', '올바른 Discord ID가 필요합니다.');
  return id;
}
export function validName(name) {
  if (typeof name !== 'string' || !/^[a-z0-9가-힣][a-z0-9가-힣_-]{0,49}$/.test(name)) throw new AppError(400, 'INVALID_NAME', 'DB 이름은 소문자·숫자·한글·밑줄·하이픈으로 1~50자입니다.');
  return name;
}
export function encodeText(text) {
  if (typeof text !== 'string' || text.length === 0) throw new AppError(400, 'TEXT_REQUIRED', '비어 있지 않은 text 문자열이 필요합니다.');
  const content = JSON.stringify({ ragim: 1, text });
  if (content.length > 2000) throw new AppError(400, 'TEXT_TOO_LONG', '텍스트와 JSON 포장을 합쳐 2,000자 이하여야 합니다.');
  return content;
}
function decode(message) {
  try {
    const value = JSON.parse(message.content);
    if (value.ragim !== 1 || typeof value.text !== 'string') return null;
    return { id: message.id, text: value.text, createdAt: message.timestamp, updatedAt: message.edited_timestamp || null };
  } catch { return null; }
}
function publicDb(channel) { return { id: channel.id, name: channel.name }; }

export class DiscordStore {
  constructor(client, config) {
    this.client = client; this.config = config; this.queue = new SerialQueue();
    this.bot = null; this.counterId = null; this.counterState = { synced: false, lastSyncedAt: null, error: null };
  }
  async identity() {
    if (!this.bot) this.bot = await this.client.request('GET', '/users/@me');
    return this.bot;
  }
  async validateSetup() {
    await this.identity();
    const category = await this.client.request('GET', `/channels/${this.config.category}`);
    const counter = await this.client.request('GET', `/channels/${this.config.counter}`);
    if (category.guild_id !== this.config.guild || category.type !== 4 || counter.guild_id !== this.config.guild || counter.type !== 0) {
      throw new AppError(503, 'INVALID_CHANNEL_SETUP', '카테고리와 카운터 채널이 지정 서버에 있는지 확인하세요.');
    }
  }
  async list() {
    const channels = await this.client.request('GET', `/guilds/${this.config.guild}/channels`);
    return channels.filter(c => c.type === 0 && c.parent_id === this.config.category && c.topic === TOPIC).map(publicDb);
  }
  async database(id) {
    validId(id);
    const c = await this.client.request('GET', `/channels/${id}`);
    if (c.guild_id !== this.config.guild || c.parent_id !== this.config.category || c.type !== 0 || c.topic !== TOPIC || c.id === this.config.counter) {
      throw new AppError(404, 'DB_NOT_FOUND', 'Ragim DB에서 관리하는 DB가 아닙니다.');
    }
    return c;
  }
  async hooks(id, create = false) {
    const bot = await this.identity();
    const all = await this.client.request('GET', `/channels/${id}/webhooks`);
    const own = all.filter(w => w.type === 1 && w.user?.id === bot.id && w.name === WEBHOOK && w.token);
    if (own.length || !create) return own;
    return [await this.client.request('POST', `/channels/${id}/webhooks`, { name: WEBHOOK })];
  }
  async create(name) {
    validName(name);
    return this.queue.run(async () => {
      await this.validateSetup();
      if ((await this.list()).some(c => c.name === name)) throw new AppError(409, 'DB_EXISTS', '같은 이름의 DB가 있습니다.');
      const bot = await this.identity();
      const channel = await this.client.request('POST', `/guilds/${this.config.guild}/channels`, {
        name, type: 0, parent_id: this.config.category, topic: TOPIC,
        // Explicitly private: server owner/administrators and this bot only.
        permission_overwrites: [
          { id: this.config.guild, type: 0, deny: '1024', allow: '0' },
          { id: bot.id, type: 1, allow: '536939536', deny: '0' },
        ],
      });
      try { await this.hooks(channel.id, true); }
      catch { await this.syncCounterSafe(); throw new AppError(502, 'DB_PARTIAL_CREATE', 'DB 채널은 생성되었지만 웹훅 생성에 실패했습니다. 목록을 새로고침하세요. 다음 기록 저장 시 복구를 시도합니다.'); }
      await this.syncCounterSafe();
      return { database: publicDb(channel), counter: this.counterState };
    });
  }
  async rename(id, name) {
    validName(name);
    return this.queue.run(async () => {
      await this.database(id);
      if ((await this.list()).some(c => c.id !== id && c.name === name)) throw new AppError(409, 'DB_EXISTS', '같은 이름의 DB가 있습니다.');
      return publicDb(await this.client.request('PATCH', `/channels/${id}`, { name }));
    });
  }
  async remove(id, confirmation) {
    return this.queue.run(async () => {
      const db = await this.database(id);
      if (confirmation !== db.name) throw new AppError(400, 'CONFIRM_NAME', '삭제할 DB 이름을 정확히 입력하세요.');
      await this.client.request('DELETE', `/channels/${id}`);
      await this.syncCounterSafe();
      return { deleted: true, counter: this.counterState };
    });
  }
  async records(id, before) {
    await this.database(id);
    if (before) validId(before);
    const hooks = await this.hooks(id);
    const messages = await this.client.request('GET', `/channels/${id}/messages?limit=100${before ? `&before=${before}` : ''}`);
    const own = messages.filter(m => hooks.some(w => w.id === m.webhook_id));
    if (own.some(m => m.content === '')) throw new AppError(503, 'MESSAGE_CONTENT_UNAVAILABLE', 'Discord Developer Portal에서 Message Content Intent를 켜세요.');
    return { records: own.map(decode).filter(Boolean), nextBefore: messages.length === 100 ? messages.at(-1).id : null };
  }
  async recordContext(id, recordId) {
    await this.database(id); validId(recordId);
    const message = await this.client.request('GET', `/channels/${id}/messages/${recordId}`);
    const hook = (await this.hooks(id)).find(w => w.id === message.webhook_id);
    const record = decode(message);
    if (!hook || !record) throw new AppError(404, 'RECORD_NOT_FOUND', 'Ragim DB 레코드가 아닙니다.');
    return { hook, record };
  }
  async record(id, recordId) { return (await this.recordContext(id, recordId)).record; }
  async write(id, text, recordId) {
    const content = encodeText(text);
    return this.queue.run(async () => {
      let hook;
      if (recordId) hook = (await this.recordContext(id, recordId)).hook;
      else { await this.database(id); [hook] = await this.hooks(id, true); }
      const path = `/webhooks/${hook.id}/${hook.token}${recordId ? `/messages/${recordId}` : '?wait=true'}`;
      const message = await this.client.request(recordId ? 'PATCH' : 'POST', path, { content, allowed_mentions: noMentions, flags: 4, ...(!recordId ? { username: WEBHOOK } : {}) }, true);
      const record = decode(message);
      if (!record) throw new AppError(502, 'INVALID_WRITE_RESPONSE', '저장 응답을 해석하지 못했습니다. 목록에서 저장 여부를 확인하세요.');
      return record;
    });
  }
  async removeRecord(id, recordId) {
    return this.queue.run(async () => {
      const { hook } = await this.recordContext(id, recordId);
      await this.client.request('DELETE', `/webhooks/${hook.id}/${hook.token}/messages/${recordId}`, undefined, true);
      return { deleted: true };
    });
  }
  async syncCounter() {
    const bot = await this.identity();
    const channel = await this.client.request('GET', `/channels/${this.config.counter}`);
    if (channel.guild_id !== this.config.guild || channel.type !== 0) throw new AppError(503, 'INVALID_COUNTER', '카운터 채널 설정을 확인하세요.');
    const content = `db: ${(await this.list()).length}`;
    let existing;
    if (this.counterId) {
      try { existing = await this.client.request('GET', `/channels/${this.config.counter}/messages/${this.counterId}`); }
      catch (error) { if (error.status !== 404) throw error; this.counterId = null; }
    }
    if (!existing) {
      let before;
      do {
        const page = await this.client.request('GET', `/channels/${this.config.counter}/messages?limit=100${before ? `&before=${before}` : ''}`);
        existing = page.find(m => m.author?.id === bot.id && !m.webhook_id && /^db: \d+$/.test(m.content));
        if (existing || page.length < 100) break;
        before = page.at(-1).id;
      } while (true);
    }
    if (existing && existing.author?.id === bot.id && !existing.webhook_id) {
      this.counterId = existing.id;
      if (existing.content !== content) await this.client.request('PATCH', `/channels/${this.config.counter}/messages/${existing.id}`, { content, allowed_mentions: noMentions });
    } else {
      const message = await this.client.request('POST', `/channels/${this.config.counter}/messages`, { content, allowed_mentions: noMentions });
      this.counterId = message.id;
    }
    this.counterState = { synced: true, lastSyncedAt: new Date().toISOString(), error: null };
    return this.counterState;
  }
  async syncCounterSafe() {
    try { return await this.syncCounter(); }
    catch (error) { this.counterState = { ...this.counterState, synced: false, error: error.code || 'SYNC_FAILED' }; return this.counterState; }
  }
  reconcile() { return this.queue.run(() => this.syncCounterSafe()); }
}
