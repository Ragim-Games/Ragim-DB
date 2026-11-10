const $ = id => document.getElementById(id);
let key = '', base = '', databases = [], selected = null, records = [], cursor = null, editing = null, nameMode = 'create';
let busy = false;
function notice(message = '', success = false) { $('notice').textContent = message; $('notice').hidden = !message; $('notice').classList.toggle('success', success); }
function controls() {
  $('create-db').disabled = !key;
  $('refresh').disabled = !key;
  $('save-record').disabled = !selected || !validText();
}
async function task(fn) {
  if (busy) return;
  busy = true;
  const buttons = [...document.querySelectorAll('button')].map(b => [b, b.disabled]);
  buttons.forEach(([b]) => { b.disabled = true; });
  document.body.setAttribute('aria-busy', 'true');
  try { await fn(); } catch (error) { notice(error.message || '작업에 실패했습니다.'); }
  finally { buttons.forEach(([b, old]) => { if (b.isConnected) b.disabled = old; }); busy = false; document.body.removeAttribute('aria-busy'); controls(); }
}
function checkedBase(value) {
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('HTTPS API 서버의 기본 주소만 입력하세요.');
  return url.origin;
}
async function api(path, method = 'GET', data) {
  let response;
  try {
    response = await fetch(`${base}${path}`, { method, redirect: 'error', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(120000), headers: { Authorization: `Bearer ${key}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  } catch {
    throw new Error('API 서버에 연결하지 못했습니다. 서버 주소·CORS 설정을 확인하세요. Render 절전 상태라면 약 1분 후 다시 연결하세요. 저장 요청이었다면 목록에서 저장 여부를 먼저 확인하세요.');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) lock();
    throw new Error(result?.error?.message || `요청 실패 (${response.status})`);
  }
  if (!result) throw new Error('JSON API 응답을 받지 못했습니다. API 서버 주소를 확인하세요.');
  return result;
}
function renderDatabases() {
  $('nav-count').textContent = databases.length;
  $('list-count').textContent = databases.length;
  $('stat-count').replaceChildren(document.createTextNode(String(databases.length)));
  const suffix = document.createElement('small'); suffix.textContent = ' databases'; $('stat-count').append(suffix);
  $('db-list').replaceChildren();
  if (!databases.length) {
    const box = document.createElement('div'); box.className = 'empty';
    const title = document.createElement('h3'); title.textContent = '첫 데이터베이스를 만들어보세요.';
    const description = document.createElement('p'); description.textContent = '새 데이터베이스를 누르면 Discord 채널과 웹훅이 생성됩니다.';
    box.append(title, description); $('db-list').append(box);
  }
  for (const db of databases) {
    const row = document.createElement('button'); row.type = 'button'; row.className = `db-row${selected?.id === db.id ? ' selected' : ''}`;
    const name = document.createElement('div'), title = document.createElement('strong'), id = document.createElement('code');
    title.textContent = `#  ${db.name}`; id.textContent = db.id; name.append(title, id);
    const format = document.createElement('span'); format.textContent = 'Text / JSON';
    const access = document.createElement('span'); access.textContent = 'Owner  ↗';
    row.append(name, format, access); row.addEventListener('click', () => task(() => openDatabase(db))); $('db-list').append(row);
  }
}
async function refresh() {
  const status = await api('/v1/admin/status');
  if (!status.configured) {
    $('stat-status').textContent = '설정 필요'; $('stat-description').textContent = 'Render에 봇 토큰을 등록하세요';
    throw new Error('관리자 인증 성공. Render 환경 변수 DISCORD_BOT_TOKEN을 등록하면 DB를 사용할 수 있습니다.');
  }
  const result = await api('/v1/databases'); databases = result.databases;
  $('stat-status').textContent = 'Connected'; $('status-dot').classList.add('online');
  $('stat-description').textContent = status.counter.synced ? 'Discord 연결 · 카운터 동기화 완료' : 'Discord 연결 · 카운터 동기화 대기';
  if (selected) {
    selected = databases.find(d => d.id === selected.id) || null;
    if (!selected) { $('records-panel').hidden = true; resetEditor(); }
  }
  renderDatabases();
}
async function openDatabase(db) {
  const result = await api(`/v1/databases/${db.id}/records`);
  selected = db; records = result.records; cursor = result.nextBefore; resetEditor();
  $('record-heading').textContent = `# ${db.name}`; $('db-id').textContent = db.id; $('records-panel').hidden = false;
  renderDatabases(); renderRecords(); $('records-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderRecords() {
  $('records-list').replaceChildren(); $('load-more').hidden = !cursor;
  if (!records.length) { const p = document.createElement('p'); p.textContent = cursor ? '이 페이지에는 레코드가 없습니다. 이전 기록을 불러오세요.' : '아직 저장된 레코드가 없습니다.'; p.className = 'text-link'; $('records-list').append(p); }
  for (const record of records) {
    const article = document.createElement('article'); article.className = 'record';
    const header = document.createElement('header'), id = document.createElement('span'), date = document.createElement('span');
    id.textContent = record.id; date.textContent = new Date(record.updatedAt || record.createdAt).toLocaleString('ko-KR'); header.append(id, date);
    const text = document.createElement('pre'); text.textContent = record.text;
    const actions = document.createElement('div'); actions.className = 'actions';
    const edit = document.createElement('button'); edit.className = 'button subtle'; edit.textContent = '수정';
    edit.addEventListener('click', () => { if (busy) return; editing = record.id; $('record-text').value = record.text; $('editor-label').textContent = '텍스트 레코드 수정'; $('save-record').textContent = '수정 저장'; $('cancel-edit').hidden = false; updateLength(); $('record-text').focus(); });
    const remove = document.createElement('button'); remove.className = 'button danger'; remove.textContent = '삭제';
    remove.addEventListener('click', () => task(async () => {
      if (!confirm('이 레코드를 영구 삭제할까요?')) return;
      await api(`/v1/databases/${selected.id}/records/${record.id}`, 'DELETE');
      records = records.filter(r => r.id !== record.id); if (editing === record.id) resetEditor(); renderRecords(); notice('레코드를 삭제했습니다.', true);
    }));
    actions.append(edit, remove); article.append(header, text, actions); $('records-list').append(article);
  }
}
function validText() { return $('record-text').value.length > 0 && JSON.stringify({ ragim: 1, text: $('record-text').value }).length <= 2000; }
function updateLength() {
  const length = JSON.stringify({ ragim: 1, text: $('record-text').value }).length;
  $('text-length').textContent = `포장 포함 ${length.toLocaleString()} / 2,000`;
  $('save-record').disabled = busy || !validText();
}
function resetEditor() { editing = null; $('record-text').value = ''; $('cancel-edit').hidden = true; $('editor-label').textContent = '새 텍스트 레코드'; $('save-record').textContent = '레코드 저장 ↗'; updateLength(); }
function lock() {
  key = ''; selected = null; databases = []; records = []; cursor = null;
  $('admin-key').value = ''; $('connection-panel').hidden = false; $('records-panel').hidden = true;
  $('stat-status').textContent = '연결 전'; $('stat-description').textContent = '관리자 키로 연결하세요'; $('status-dot').classList.remove('online');
  renderDatabases(); $('db-list').replaceChildren(); resetEditor(); controls();
}
function openName(mode) {
  if (busy) return; nameMode = mode;
  $('name-title').textContent = mode === 'create' ? '새 데이터베이스' : mode === 'rename' ? 'DB 이름 변경' : '데이터베이스 영구 삭제';
  $('name-description').textContent = mode === 'delete' ? `채널과 모든 기록이 삭제됩니다. 계속하려면 “${selected.name}”을 입력하세요.` : '소문자·숫자·한글·밑줄·하이픈으로 1~50자 이름을 입력하세요.';
  $('db-name').value = mode === 'rename' ? selected.name : '';
  $('name-dialog').showModal(); $('db-name').focus();
}
$('connect-form').addEventListener('submit', event => { event.preventDefault(); task(async () => {
  base = checkedBase($('api-url').value.trim()); key = $('admin-key').value.trim(); $('admin-key').value = '';
  try { await api('/v1/admin/status'); } catch (error) { lock(); throw error; }
  $('connection-panel').hidden = true; notice('연결 중입니다. Render 절전 상태라면 잠시 기다려주세요.');
  await refresh(); notice('관리자 콘솔에 연결했습니다.', true);
}); });
$('logout').addEventListener('click', () => { if (!busy) { lock(); notice('관리자 세션을 잠갔습니다.', true); } });
$('refresh').addEventListener('click', () => task(async () => { await refresh(); if (selected) await openDatabase(selected); notice('목록을 새로고침했습니다.', true); }));
$('create-db').addEventListener('click', () => openName('create'));
$('rename-db').addEventListener('click', () => openName('rename'));
$('delete-db').addEventListener('click', () => openName('delete'));
$('cancel-name').addEventListener('click', () => $('name-dialog').close());
$('name-form').addEventListener('submit', event => { event.preventDefault(); task(async () => {
  const name = $('db-name').value; $('name-dialog').close();
  let result;
  if (nameMode === 'create') result = await api('/v1/databases', 'POST', { name });
  if (nameMode === 'rename') result = await api(`/v1/databases/${selected.id}`, 'PATCH', { name });
  if (nameMode === 'delete') { result = await api(`/v1/databases/${selected.id}`, 'DELETE', { confirmName: name }); selected = null; $('records-panel').hidden = true; resetEditor(); }
  await refresh();
  if (result.database) await openDatabase(result.database);
  notice(result.counter?.synced === false ? 'DB 변경은 완료했습니다. 카운터는 자동 재동기화 대기 중입니다.' : 'DB 변경을 완료했습니다.', result.counter?.synced !== false);
}); });
$('record-text').addEventListener('input', updateLength);
$('cancel-edit').addEventListener('click', resetEditor);
$('record-form').addEventListener('submit', event => { event.preventDefault(); task(async () => {
  const result = await api(`/v1/databases/${selected.id}/records${editing ? `/${editing}` : ''}`, editing ? 'PATCH' : 'POST', { text: $('record-text').value });
  if (editing) records = records.map(r => r.id === editing ? result.record : r); else records.unshift(result.record);
  resetEditor(); renderRecords(); notice('텍스트를 Discord에 저장했습니다.', true);
}); });
$('load-more').addEventListener('click', () => task(async () => {
  const result = await api(`/v1/databases/${selected.id}/records?before=${cursor}`);
  const seen = new Set(records.map(r => r.id)); records.push(...result.records.filter(r => !seen.has(r.id))); cursor = result.nextBefore; renderRecords();
}));
$('export-db').addEventListener('click', () => task(async () => {
  const all = []; let before = null;
  do { const result = await api(`/v1/databases/${selected.id}/records${before ? `?before=${before}` : ''}`); all.push(...result.records); before = result.nextBefore; } while (before);
  const blob = new Blob([all.map(r => JSON.stringify(r)).join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `${selected.name}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  notice(`${all.length}개 레코드를 텍스트로 내보냈습니다.`, true);
}));
$('nav-api').addEventListener('click', () => $('api-section').scrollIntoView({ behavior: 'smooth' }));
$('nav-databases').addEventListener('click', () => $('db-section').scrollIntoView({ behavior: 'smooth' }));
const configured = window.RAGIM_CONFIG?.apiBase;
$('api-url').value = configured || (['localhost', '127.0.0.1'].includes(location.hostname) ? location.origin : '');
updateLength(); controls();
