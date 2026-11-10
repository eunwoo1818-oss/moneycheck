import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { openStore, defaults } from './lib/store.mjs';
import { today, validDate, billDate, nextMonth, occurrences } from './lib/billing.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const db = openStore(process.env.DATABASE_PATH || resolve(root, 'data/moneycheck.sqlite'));
const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || '127.0.0.1';
const appUrl = process.env.APP_URL || `http://localhost:${port}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = (password, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
const verify = (password, stored) => { const [salt, value] = stored.split(':'); return timingSafeEqual(Buffer.from(digest(password, salt).split(':')[1], 'hex'), Buffer.from(value, 'hex')); };
const dummyPassword = digest(randomBytes(32).toString('hex'));
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (value, max = 100) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : fail('입력 내용을 확인해 주세요.');
const password = value => typeof value === 'string' && value.length >= 10 && value.length <= 128 ? value : fail('비밀번호는 10~128자로 입력해 주세요.');
const email = value => { const v = text(value, 254).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : fail('이메일 주소를 확인해 주세요.'); };
const amount = (value, currency = 'KRW') => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e12 && (currency !== 'KRW' || Number.isInteger(value)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.001 ? value : fail('금액을 확인해 주세요. 원화는 정수로 입력하세요.');
const date = value => validDate(value) ? value : fail('날짜를 확인해 주세요.');
const type = value => ['income', 'expense'].includes(value) ? value : fail('수입 또는 지출을 선택해 주세요.');
const limits = new Map();
function rateLimit(req, key, max = 20) {
  const now = Date.now();
  if (limits.size > 5000) for (const [k,v] of limits) if (v.until < now) limits.delete(k);
  const k = `${req.socket.remoteAddress}:${key}`;
  let entry = limits.get(k);
  if (!entry || entry.until < now) { entry = { count: 0, until: now + 15 * 60000 }; limits.set(k, entry); }
  if (++entry.count > max) fail('요청이 많습니다. 15분 후 다시 시도해 주세요.', 429);
}
async function body(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) fail('지원하지 않는 요청 형식입니다.', 415);
  let value = '';
  for await (const chunk of req) { value += chunk; if (value.length > 16384) fail('입력 내용이 너무 큽니다.', 413); }
  try { const b = JSON.parse(value || '{}'); if (!b || typeof b !== 'object' || Array.isArray(b)) fail('잘못된 요청입니다.'); return b; } catch { fail('잘못된 요청입니다.'); }
}
function auth(req) {
  const token = /(?:^|;\s*)moneycheck=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  if (!token) return null;
  return db.prepare('SELECT u.id,u.email,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.disabled=0').get(hash(token), Date.now());
}
function session(res, id) {
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE user_id=? OR expires<?').run(id, Date.now());
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token), id, Date.now() + 7 * 86400000);
  res.setHeader('Set-Cookie', `moneycheck=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`);
}
async function getRate(day) {
  const cached = db.prepare('SELECT rate,rate_date FROM exchange_rates WHERE date=?').get(day);
  if (cached) return cached;
  const response = await fetch(`https://api.frankfurter.dev/v2/rate/USD/KRW?date=${day}`, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error('환율 조회 실패');
  const r = await response.json();
  if (!r || r.base !== 'USD' || r.quote !== 'KRW' || !(r.rate > 0) || !validDate(r.date) || r.date > day) throw new Error('환율 데이터 오류');
  db.prepare('INSERT OR IGNORE INTO exchange_rates VALUES (?,?,?)').run(day, r.rate, r.date);
  return { rate: r.rate, rate_date: r.date };
}
async function sync(userId) {
  const warnings = [];
  for (const s of db.prepare('SELECT * FROM subscriptions WHERE user_id=? AND active=1').all(userId)) {
    for (const bill of occurrences(s, today())) {
      if (db.prepare('SELECT id FROM transactions WHERE subscription_id=? AND billing_month=?').get(s.id, bill.month)) continue;
      let fx = { rate: 1, rate_date: bill.date };
      if (s.currency === 'USD') {
        try { fx = await getRate(bill.date); } catch { warnings.push(`${s.name}: ${bill.date} 환율을 확인할 수 없어 자동 기록을 보류했습니다.`); break; }
      }
      db.prepare(`INSERT OR IGNORE INTO transactions (id,user_id,type,amount,date,category,memo,subscription_id,billing_month,original_amount,currency,rate,rate_date) VALUES (?,?,'expense',?,?,'구독',?,?,?,?,?,?,?)`)
        .run(randomUUID(), userId, Math.max(1, Math.round(s.amount * fx.rate)), bill.date, s.name, s.id, bill.month, s.amount, s.currency, fx.rate, fx.rate_date);
    }
  }
  return warnings;
}
function subscriptionData(b) {
  const currency = ['KRW','USD'].includes(b.currency) ? b.currency : fail('통화를 확인해 주세요.');
  const first = date(b.next_date);
  const day = Number(b.original_day || Number(first.slice(-2)));
  if (!Number.isInteger(day) || day < 1 || day > 31) fail('원래 결제일은 1~31일입니다.');
  let month = first.slice(0,7);
  if (billDate(month, day) !== first) {
    const [y,m] = month.split('-').map(Number);
    month = `${m === 1 ? y-1 : y}-${String(m === 1 ? 12 : m-1).padStart(2,'0')}`;
    if (billDate(month, day) !== first) fail('다음 결제일과 원래 결제일이 일치하지 않습니다.');
  }
  return [text(b.name), amount(b.amount, currency), currency, day, month];
}
function upcoming(s) {
  let month = s.start_month;
  for (let i=0;i<1300;i++) {
    const d = billDate(month, s.original_day);
    if (!db.prepare('SELECT id FROM transactions WHERE subscription_id=? AND billing_month=?').get(s.id,month)) return { ...s, next_date: d, next_month: month };
    month = nextMonth(month);
  }
  return s;
}
async function api(req, res, url) {
  const path = url.pathname, method = req.method;
  if (!['GET','HEAD'].includes(method)) {
    const origin = req.headers.origin;
    if (origin && origin !== appUrl && origin !== `http://127.0.0.1:${port}`) fail('허용되지 않은 요청입니다.', 403);
    if (req.headers['sec-fetch-site'] === 'cross-site') fail('허용되지 않은 요청입니다.', 403);
  }
  if (path === '/api/status' && method === 'GET') return { setup: !db.prepare('SELECT id FROM users LIMIT 1').get(), emailConfigured: !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM) };
  if (path === '/api/register' && method === 'POST') {
    rateLimit(req, 'register', 10);
    const b = await body(req), mail = email(b.email), pass = password(b.password);
    const first = !db.prepare('SELECT id FROM users LIMIT 1').get();
    const name = first ? 'JE.KIM' : text(b.name, 40), id = randomUUID();
    if (db.prepare('SELECT id FROM users WHERE email=?').get(mail)) fail('이 이메일로 계정을 만들 수 없습니다.');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO users(id,email,name,password,role) VALUES (?,?,?,?,?)').run(id,mail,name,digest(pass),first?'admin':'user');
      for (const [t,names] of Object.entries(defaults)) for (const n of names) db.prepare('INSERT INTO categories VALUES (?,?,?)').run(id,t,n);
      db.prepare("INSERT INTO categories VALUES (?,'expense','구독')").run(id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    session(res,id); return { ok: true };
  }
  if (path === '/api/login' && method === 'POST') {
    rateLimit(req,'login');
    const b = await body(req), mail = email(b.email), pass = password(b.password);
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(mail);
    const matches = verify(pass, u?.password || dummyPassword);
    if (!u || !matches || u.disabled) fail('이메일 또는 비밀번호를 확인해 주세요.',401);
    session(res,u.id); return { ok: true };
  }
  if (path === '/api/forgot' && method === 'POST') {
    rateLimit(req,'forgot',5);
    const b = await body(req), mail = email(b.email);
    if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) fail('이메일 발송 서비스가 아직 연결되지 않았습니다. 서버 설정이 필요합니다.',503);
    const u = db.prepare('SELECT id FROM users WHERE email=? AND disabled=0').get(mail);
    if (u) {
      const token = randomBytes(32).toString('hex');
      db.prepare('DELETE FROM resets WHERE user_id=? OR expires<?').run(u.id,Date.now());
      db.prepare('INSERT INTO resets VALUES (?,?,?)').run(hash(token),u.id,Date.now()+30*60000);
      try {
        const r = await fetch('https://api.resend.com/emails',{ method:'POST', signal:AbortSignal.timeout(10000), headers:{ Authorization:`Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type':'application/json' }, body:JSON.stringify({from:process.env.MAIL_FROM,to:[mail],subject:'머니체크 비밀번호 재설정',text:`다음 링크에서 30분 이내에 비밀번호를 재설정하세요.\n${appUrl}/?reset=${token}\n요청하지 않았다면 이 이메일을 무시하세요.`}) });
        if (!r.ok) throw new Error('mail');
      } catch { db.prepare('DELETE FROM resets WHERE token=?').run(hash(token)); fail('이메일 전송을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',503); }
    }
    return { message:'가입된 이메일이라면 재설정 링크를 보냈습니다.' };
  }
  if (path === '/api/reset' && method === 'POST') {
    rateLimit(req,'reset'); const b = await body(req), pass = password(b.password);
    if (typeof b.token !== 'string') fail('유효하지 않은 링크입니다.');
    const r = db.prepare('SELECT * FROM resets WHERE token=? AND expires>?').get(hash(b.token),Date.now());
    if (!r) fail('만료되었거나 이미 사용한 링크입니다.');
    db.exec('BEGIN');
    try { db.prepare('UPDATE users SET password=? WHERE id=?').run(digest(pass),r.user_id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(r.user_id); db.prepare('DELETE FROM resets WHERE user_id=?').run(r.user_id); db.exec('COMMIT'); } catch(e) { db.exec('ROLLBACK'); throw e; }
    return { ok:true };
  }
  const user = auth(req);
  if (!user) fail('로그인이 필요합니다.',401);
  if (path === '/api/logout' && method === 'POST') {
    await body(req); db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    res.setHeader('Set-Cookie','moneycheck=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return { ok:true };
  }
  if (path === '/api/data' && method === 'GET') {
    const warnings = await sync(user.id);
    return { user, today:today(), warnings, transactions:db.prepare('SELECT * FROM transactions WHERE user_id=? AND deleted=0 ORDER BY date DESC,id').all(user.id), subscriptions:db.prepare('SELECT * FROM subscriptions WHERE user_id=? AND active=1').all(user.id).map(upcoming), categories:db.prepare('SELECT type,name FROM categories WHERE user_id=? ORDER BY rowid').all(user.id) };
  }
  if (path === '/api/categories' && method === 'POST') {
    const b = await body(req); db.prepare('INSERT OR IGNORE INTO categories VALUES (?,?,?)').run(user.id,type(b.type),text(b.name,30)); return { ok:true };
  }
  if (path === '/api/transactions' && method === 'POST') {
    const b = await body(req), t = type(b.type), c = text(b.category,30);
    if (!db.prepare('SELECT name FROM categories WHERE user_id=? AND type=? AND name=?').get(user.id,t,c)) fail('카테고리를 먼저 추가해 주세요.');
    db.prepare('INSERT INTO transactions(id,user_id,type,amount,date,category,memo) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),user.id,t,amount(b.amount),date(b.date),c,typeof b.memo === 'string' && b.memo.length<=500 ? b.memo : ''); return { ok:true };
  }
  const tx = /^\/api\/transactions\/([\w-]+)$/.exec(path);
  if (tx && ['PATCH','DELETE'].includes(method)) {
    const row = db.prepare('SELECT * FROM transactions WHERE id=? AND user_id=? AND deleted=0').get(tx[1],user.id);
    if (!row) fail('내역을 찾을 수 없습니다.',404);
    if (method === 'DELETE') { await body(req); db.prepare('UPDATE transactions SET deleted=1 WHERE id=? AND user_id=?').run(row.id,user.id); }
    else {
      const b = await body(req), t = row.subscription_id ? 'expense' : type(b.type), c = text(b.category,30);
      if (!db.prepare('SELECT name FROM categories WHERE user_id=? AND type=? AND name=?').get(user.id,t,c)) fail('카테고리를 확인해 주세요.');
      db.prepare('UPDATE transactions SET type=?,amount=?,date=?,category=?,memo=? WHERE id=? AND user_id=?').run(t,amount(b.amount),date(b.date),c,typeof b.memo==='string' && b.memo.length<=500?b.memo:'',row.id,user.id);
    }
    return { ok:true };
  }
  if (path === '/api/subscriptions' && method === 'POST') {
    const b = await body(req), values = subscriptionData(b);
    db.prepare('INSERT INTO subscriptions(id,user_id,name,amount,currency,original_day,start_month) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),user.id,...values); return { ok:true };
  }
  const sub = /^\/api\/subscriptions\/([\w-]+)$/.exec(path);
  if (sub && ['PATCH','DELETE'].includes(method)) {
    const row = db.prepare('SELECT * FROM subscriptions WHERE id=? AND user_id=? AND active=1').get(sub[1],user.id);
    if (!row) fail('구독을 찾을 수 없습니다.',404);
    const b = await body(req);
    if (method === 'DELETE') db.prepare('UPDATE subscriptions SET active=0 WHERE id=? AND user_id=?').run(row.id,user.id);
    else {
      // 이미 기록된 청구분은 유지하고, 이후 청구에만 서비스명/요금을 적용한다.
      const currency = ['USD','KRW'].includes(b.currency) ? b.currency : fail('통화를 확인해 주세요.');
      db.prepare('UPDATE subscriptions SET name=?,amount=?,currency=? WHERE id=? AND user_id=?').run(text(b.name),amount(b.amount,currency),currency,row.id,user.id);
    }
    return { ok:true };
  }
  if (path === '/api/admin/users' && method === 'GET') {
    if (user.role !== 'admin') fail('권한이 없습니다.',403);
    return { users:db.prepare('SELECT id,email,name,role,disabled,created_at FROM users ORDER BY created_at').all() };
  }
  const account = /^\/api\/admin\/users\/([\w-]+)$/.exec(path);
  if (account && method === 'PATCH') {
    if (user.role !== 'admin') fail('권한이 없습니다.',403);
    if (account[1] === user.id) fail('본인 관리자 계정은 정지할 수 없습니다.');
    const b = await body(req);
    if (typeof b.disabled !== 'boolean') fail('계정 상태를 확인해 주세요.');
    const r = db.prepare("UPDATE users SET disabled=? WHERE id=? AND role!='admin'").run(Number(b.disabled),account[1]);
    if (!r.changes) fail('계정을 찾을 수 없습니다.',404);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(account[1]); return { ok:true };
  }
  fail('요청을 찾을 수 없습니다.',404);
}
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const server = http.createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const url = new URL(req.url,appUrl);
    if (url.pathname.startsWith('/api/')) { res.setHeader('Cache-Control','no-store'); const result = await api(req,res,url); res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(result)); return; }
    if (!['GET','HEAD'].includes(req.method)) fail('지원하지 않는 요청입니다.',405);
    const files = {'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg'};
    const name = files[url.pathname]; if (!name) fail('페이지를 찾을 수 없습니다.',404);
    const content = await readFile(resolve(root,'public',name)); res.writeHead(200,{'Content-Type':mime[extname(name)],'Cache-Control':'no-cache'}); res.end(req.method === 'HEAD' ? undefined : content);
  } catch (e) { res.writeHead(e.status || 500,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({error:e.status?e.message:'처리를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'})); if (!e.status) console.error(e.message); }
});
server.listen(port,host,()=>console.log(`머니체크 실행: http://localhost:${port}`));
let running = false;
const timer = setInterval(async()=>{ if(running)return; running=true; try { for(const u of db.prepare('SELECT id FROM users WHERE disabled=0').all()) await sync(u.id); } catch(e){ console.error('자동 기록 처리 실패:',e.message); } finally { running=false; } },60000);
timer.unref();
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{ clearInterval(timer);server.close(()=>{db.close();process.exit(0);}); });
