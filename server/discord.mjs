export class AppError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export class SerialQueue {
  tail = Promise.resolve(); pending = 0;
  run(fn) {
    if (this.pending >= 100) return Promise.reject(new AppError(503, 'BUSY', '요청이 많습니다. 잠시 후 다시 시도하세요.'));
    this.pending++;
    const result = this.tail.then(fn).finally(() => { this.pending--; });
    this.tail = result.catch(() => {});
    return result;
  }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export class DiscordClient {
  constructor(token, fetcher = fetch, wait = sleep) { this.token = token; this.fetcher = fetcher; this.wait = wait; this.queue = new SerialQueue(); this.nextRequest = 0; }
  request(method, path, body, webhook = false) {
    return this.queue.run(async () => {
      if (!this.token) throw new AppError(503, 'BOT_NOT_CONFIGURED', 'Render에 DISCORD_BOT_TOKEN을 설정하세요.');
      for (let attempt = 0; attempt < 4; attempt++) {
        await this.wait(Math.max(0, this.nextRequest - Date.now()));
        let response;
        try {
          response = await this.fetcher(`https://discord.com/api/v10${path}`, {
            method, redirect: 'error', signal: AbortSignal.timeout(20000),
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (https://github.com/Ragim-Games/Ragim-DB, 1.0)', ...(!webhook ? { Authorization: `Bot ${this.token}` } : {}) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        } catch {
          // Never include URLs, webhook tokens, request bodies or raw upstream errors in logs.
          throw new AppError(502, 'DISCORD_UNREACHABLE', 'Discord 응답을 확인하지 못했습니다. 쓰기 요청은 재시도 전에 저장 여부를 확인하세요.');
        }
        this.nextRequest = Date.now() + 50;
        if (response.headers.get('x-ratelimit-remaining') === '0') {
          const reset = Number(response.headers.get('x-ratelimit-reset-after'));
          if (Number.isFinite(reset)) this.nextRequest = Date.now() + Math.max(50, Math.min(reset * 1000, 60000));
        }
        const data = await response.json().catch(() => null);
        if (response.status === 429) {
          const delay = Number(data?.retry_after);
          if (!Number.isFinite(delay) || delay > 60) break;
          this.nextRequest = Date.now() + Math.max(1000, delay * 1000 + 100);
          continue;
        }
        if (!response.ok) {
          const status = response.status === 404 ? 404 : 502;
          throw new AppError(status, `DISCORD_${response.status}`, response.status === 403
            ? '봇의 채널 보기·메시지 기록·채널 관리·웹훅 관리 권한을 확인하세요.'
            : response.status === 401 ? '봇 토큰이 유효하지 않습니다. Render 환경 변수를 확인하세요.'
            : response.status === 404 ? 'Discord 채널, 웹훅 또는 메시지가 없습니다.'
            : 'Discord 요청에 실패했습니다. 쓰기 요청은 재시도 전에 저장 여부를 확인하세요.');
        }
        return data;
      }
      throw new AppError(503, 'DISCORD_RATE_LIMIT', 'Discord 요청 제한입니다. 잠시 후 다시 시도하세요.');
    });
  }
}
