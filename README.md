# Ragim DB

Discord 채널을 텍스트 DB로 사용하는 개인 관리 콘솔입니다. 화면은 **GitHub Pages**, 봇과 HTTP API는 **새 Render 무료 웹 서비스**에서 실행합니다. Node.js 24 내장 모듈만 사용합니다.

## 구조

```text
GitHub Pages 관리 화면 ── 관리자 키 ──┐
외부 애플리케이션 ────── API 키 ─────┤
                                    ▼
                             Render API + 봇
                                    ▼
                         Discord 채널 / 웹훅 / 메시지
```

| 용도 | Discord ID |
|---|---|
| 서버 | `1569731860035145809` |
| DB 카테고리 | `1569731862740607067` |
| DB 수 표시 채널 | `1569733571781075025` |

DB는 카테고리 안의 텍스트 채널이며 이름은 DB 이름, 주제는 `ragim-db:v1`입니다. 다른 채널은 건드리지 않습니다. DB를 만들면 봇이 소유한 `Ragim DB` 웹훅도 만듭니다. 레코드 ID는 Discord 메시지 ID이고, 모든 ID는 **문자열**입니다.

메시지에는 `{"ragim":1,"text":"내용"}` 형식의 JSON **텍스트만** 저장합니다. 포장으로 공백·줄바꿈·JSON 문자열을 보존하며, 파일·임베드·첨부는 받지 않습니다. 포장 및 이스케이프를 포함해 Discord의 2,000자 제한을 적용합니다. 멘션과 링크 미리보기도 비활성화합니다.

## 보안 및 키

- 봇 토큰은 **Render 환경 변수 `DISCORD_BOT_TOKEN`에만** 등록합니다. 채팅이나 다른 곳에 노출한 토큰은 Developer Portal에서 재발급하세요.
- `npm run keys`는 서로 다른 256비트 무작위 관리자 키·API 키를 발급합니다. 원문은 Git에서 제외된 `.private/credentials.txt`에 생성됩니다. 기존 키 파일은 덮어쓰지 않습니다.
- 서버는 키 원문 대신 `ADMIN_KEY_HASH`, `API_KEY_HASH`에 SHA-256 해시를 보관합니다. 키는 `Authorization: Bearer ...` 헤더로만 받습니다.
- **관리자 키**: DB 생성·이름 변경·삭제, 모든 레코드 읽기·쓰기·삭제, 상태·동기화.
- **일반 API 키**: 전체 DB 목록 및 모든 레코드 읽기·쓰기·삭제. 신뢰하는 서버 애플리케이션에만 사용하세요. 프런트엔드 번들에 포함하지 마세요.
- 키를 폐기/교체하려면 새 무작위 키를 생성하고 해당 해시 환경 변수를 교체해 재배포합니다. 재배포 완료 후 이전 키는 더 이상 인증되지 않습니다. 이 버전은 관리자 키 1개, 데이터 API 키 1개를 지원합니다.
- 관리 화면은 관리자 키를 현재 탭의 **메모리에만** 보관합니다. 새로고침·잠금 시 지워집니다. 브라우저 저장소·쿠키·URL에 저장하지 않습니다.
- Pages 화면은 공개 정적 파일이지만 데이터 API는 인증을 요구합니다. 봇 토큰·웹훅 URL·키 원문은 화면 파일/API 응답에 넣지 않습니다.
- DB 채널은 `@everyone`의 보기 권한을 차단하고 봇에만 필요한 권한을 부여합니다. Discord 서버 소유자 및 Administrator 권한 보유자는 여전히 볼 수 있습니다. Discord 관리자 접근까지 차단하는 암호화 저장소는 아닙니다.
- `.env`, `.private/`는 커밋하지 마세요. Pages 워크플로는 `public/` 폴더만 배포하고, 커밋된 파일의 시크릿 패턴을 검사합니다.

## Discord 준비

1. [Developer Portal](https://discord.com/developers/applications)에서 공식 봇을 만들거나 기존 앱을 사용합니다. 노출된 토큰은 **Reset Token**으로 교체합니다.
2. Bot 설정에서 **Message Content Intent**를 켭니다. 메시지 본문을 REST API로 읽을 때도 필요합니다.
3. 봇을 지정 서버에 초대합니다. 필요한 권한: View Channels, Send Messages, Read Message History, Manage Channels, Manage Webhooks. Administrator 전체 권한은 필요하지 않습니다.
4. 지정 카테고리와 카운터 채널에서 위 권한이 허용되는지 확인합니다. 카운터가 음성·스테이지 채널이면 채널 이름을, 텍스트·공지 채널이면 봇 메시지를 수정합니다. 현재 지정된 카운터는 음성 채널입니다.

이 앱은 Discord REST API를 사용합니다. Gateway 연결이나 슬래시 명령을 등록하지 않으므로 Discord에서 봇이 오프라인으로 표시될 수 있습니다. 봇의 온라인 표시와 API 작동 여부는 별개입니다.

## 실행 및 배포

### 로컬

```sh
npm run keys
# .env에 재발급한 DISCORD_BOT_TOKEN을 입력
npm start
```

`http://localhost:10000`에서 콘솔을 열고 `.private/credentials.txt`의 관리자 키를 입력합니다. `.env`를 이미 만들었다면 키 생성기가 기존 파일을 덮어쓰지 않으므로 해시 값을 직접 반영하세요.

### Render

새 **Web Service / Node / Free / Singapore**를 만들고 이 저장소의 `main`을 연결합니다.

- Build command: `npm test`
- Start command: `npm start`
- Node version: `24` (`NODE_VERSION` 환경 변수)
- 환경 변수: `DISCORD_BOT_TOKEN`, `ADMIN_KEY_HASH`, `API_KEY_HASH`, `ALLOWED_ORIGINS=https://ragim-games.github.io`
- 공개 설정 ID는 `.env.example` 참고. 기본값이 이미 설정되어 있습니다.
- `/health`는 프로세스 생존 확인용입니다. Discord 연결 여부는 관리자 인증 후 콘솔 또는 `/v1/admin/status`에서 확인합니다.

서비스 생성과 환경 변수는 Render Dashboard/MCP로 관리합니다. 별도 Blueprint를 동시에 적용하지 않습니다. 기존 Render 서비스는 수정하지 않습니다.

### GitHub Pages

1. 저장소 **Settings → Pages → Source: GitHub Actions**를 선택합니다.
2. `public/config.js`의 `apiBase`에 새 Render URL만 넣습니다. **시크릿을 넣지 마세요.**
3. `main`에 푸시하면 테스트·시크릿 검사를 거친 후 `public/`만 배포됩니다.
4. 사이트: `https://ragim-games.github.io/Ragim-DB/`

## API

기본 주소는 새 Render 서비스 URL입니다. 모든 `/v1/` 요청은 키가 필요합니다. 본문이 있는 요청은 `Content-Type: application/json`을 사용합니다. 알 수 없는 필드·파일 업로드는 거부됩니다.

| 메서드 | 경로 | 권한 / 본문 |
|---|---|---|
| GET | `/v1/databases` | 관리자 또는 API 키 |
| POST | `/v1/databases` | 관리자 / `{"name":"players"}` |
| PATCH | `/v1/databases/{dbId}` | 관리자 / `{"name":"new-name"}` |
| DELETE | `/v1/databases/{dbId}` | 관리자 / `{"confirmName":"players"}` |
| GET | `/v1/databases/{dbId}/records` | 관리자 또는 API 키 |
| GET | `/v1/databases/{dbId}/records?before={cursor}` | 이전 페이지 |
| POST | `/v1/databases/{dbId}/records` | 관리자 또는 API 키 / `{"text":"hello"}` |
| GET | `/v1/databases/{dbId}/records/{recordId}` | 관리자 또는 API 키 |
| PATCH | `/v1/databases/{dbId}/records/{recordId}` | 관리자 또는 API 키 / `{"text":"updated"}` |
| DELETE | `/v1/databases/{dbId}/records/{recordId}` | 관리자 또는 API 키 |
| GET | `/v1/admin/status` | 관리자 |
| POST | `/v1/admin/sync` | 관리자 / 카운터 재확인 |

Node.js 서버에서 사용하는 예시:

```js
const response = await fetch(`${process.env.RAGIM_API_URL}/v1/databases/${dbId}/records`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.RAGIM_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ text: JSON.stringify({ username: 'ragim', level: 1 }) }),
});
if (!response.ok) throw new Error(`Ragim DB request failed: ${response.status}`);
const { record } = await response.json();
// record: { id, text, createdAt, updatedAt }
```

목록은 최신순이며 Discord 메시지 100개 단위로 읽습니다. 응답 `nextBefore`가 `null`일 때 마지막입니다. 일반 사용자 메시지가 섞여 레코드 배열이 비어 있어도 커서가 있으면 다음 페이지가 존재합니다. 봇 소유 웹훅의 정상 Ragim 포장 메시지만 레코드로 취급합니다.

## 동기화와 한계

- DB 생성·삭제가 끝나면 지정된 음성·스테이지 채널의 이름을 `db: N`으로 수정합니다. 이름이 이미 맞으면 수정 요청을 보내지 않습니다. 텍스트·공지 채널을 지정한 경우에는 **봇이 작성한** `db: N` 메시지를 수정하고, 재시작 때 기존 메시지를 찾아 재사용합니다. 타인이 쓴 메시지는 수정할 수 없어 새 봇 메시지를 만듭니다.
- 실행 중 약 60초 간격으로 카운터를 재확인합니다. 카운터 실패 시 DB 작업 자체를 취소하지 않고 응답 `counter.synced: false`로 알린 후 재시도합니다.
- Render 무료 서버는 15분 동안 인바운드 트래픽이 없으면 절전하고, 다음 요청에 약 1분 후 깨어날 수 있습니다. **24시간 상시 봇이나 즉시 카운터 동기화를 보장하지 않습니다.** 절전 중 변경은 기동 후 반영합니다. 무료 사용 시간은 워크스페이스의 다른 무료 서비스와 공유됩니다.
- 운영 데이터는 Discord에, 인증 설정은 Render 환경 변수에 있으므로 임시 파일시스템을 데이터 저장소로 사용하지 않습니다.
- 단일 API 인스턴스용입니다. 프로세스 내부 쓰기를 직렬화하지만 다중 인스턴스·재배포 중 겹침·Discord에서의 직접 변경에 대해 트랜잭션/정확히 한 번 저장을 보장하지 않습니다.
- Discord 429는 제한 시간에 맞춰 재시도합니다. 타임아웃/5xx가 발생한 쓰기는 중복 생성을 피하기 위해 자동 재시도하지 않습니다. 목록에서 저장 여부를 먼저 확인하세요.
- DB 삭제는 채널과 모든 기록을 영구 삭제합니다. 콘솔의 내보내기로 텍스트 백업을 받을 수 있습니다. 내보내기는 페이지를 순회하므로 동시 수정에 대한 일관된 스냅샷은 아닙니다.
- 관계형 DB의 인덱스, SQL, 트랜잭션, 대용량 처리, 내구성 보장을 제공하지 않습니다. Discord의 채널 수·API 제한을 따릅니다.

## 검증

```sh
npm test
npm run check:secrets
```

테스트는 가짜 Discord 어댑터로 실제 HTTP 인증·권한 분리, CRUD, 커서, 멘션 차단, 카운터 복구, 429 처리와 오류 시 시크릿 비노출을 확인합니다. 실제 봇·서버 연결 검증은 별도로 수행합니다.

공식 문서: [Discord Webhooks](https://docs.discord.com/developers/resources/webhook), [Message Content Intent](https://docs.discord.com/developers/events/gateway#message-content-intent), [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [Render 무료 제한](https://render.com/docs/free).
