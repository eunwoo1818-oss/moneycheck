import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { sqlRepository } from './lib/sql-repository.mjs';
import { defaults } from './lib/categories.mjs';
import { parseCardSms } from './lib/card-sms.mjs';
import { today, validDate, billDate, nextMonth, occurrences } from './lib/billing.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
// 저장소 초기화 실패가 정적 화면까지 종료시키지 않도록 API 요청 시 연다.
let db, storePromise;
async function ensureStore() {
  if (db) return;
  if (!storePromise) storePromise = (async () => {
    const connection = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (process.env.FIREBASE_PROJECT_ID) {
      const { openFirebaseStore } = await import('./lib/firebase-store.mjs');
      db = openFirebaseStore();
    } else if (connection) {
      const { openPostgresStore } = await import('./lib/postgres-store.mjs');
      db = sqlRepository(await openPostgresStore(connection));
    } else {
      if (process.env.VERCEL) fail('서비스 준비 중입니다. 영구 데이터 저장소 연결이 필요합니다.', 503);
      const { openStore } = await import('./lib/store.mjs');
      db = sqlRepository(openStore(process.env.DATABASE_PATH || resolve(root, 'data/moneycheck.sqlite')));
    }
  })();
  try { await storePromise; } catch (error) { storePromise = null; throw error; }
}
const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || '127.0.0.1';
const appUrl = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : `http://localhost:${port}`);
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
function ledgerDate(value) {
  const day = date(value);
  if (day.slice(0,4)!==today().slice(0,4)) fail('올해 장부의 날짜만 입력할 수 있습니다.');
  return day;
}
const type = value => ['income', 'expense'].includes(value) ? value : fail('수입 또는 지출을 선택해 주세요.');
async function rateLimit(req, key, max = 20) {
  const now = Date.now();
  const ip = process.env.VERCEL ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0] : req.socket.remoteAddress;
  const k = hash(`${ip}:${key}`);
  if (await db.rateLimit(k,now) > max) fail('요청이 많습니다. 15분 후 다시 시도해 주세요.', 429);
}
async function body(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) fail('지원하지 않는 요청 형식입니다.', 415);
  if (req.body !== undefined) {
    try {
      const parsed = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || JSON.stringify(parsed).length > 16384) fail('잘못된 요청입니다.');
      return parsed;
    } catch { fail('잘못된 요청입니다.'); }
  }
  let value = '';
  for await (const chunk of req) { value += chunk; if (value.length > 16384) fail('입력 내용이 너무 큽니다.', 413); }
  try { const b = JSON.parse(value || '{}'); if (!b || typeof b !== 'object' || Array.isArray(b)) fail('잘못된 요청입니다.'); return b; } catch { fail('잘못된 요청입니다.'); }
}
async function auth(req) {
  const token = /(?:^|;\s*)moneycheck=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  if (!token) return null;
  return (await db.sessionUser(hash(token),Date.now()));
}
async function session(res, id) {
  const token = randomBytes(32).toString('hex');
  await db.createSession(id,hash(token),Date.now()+7*86400000,Date.now());
  res.setHeader('Set-Cookie', `moneycheck=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.COOKIE_SECURE === '1' || process.env.VERCEL ? '; Secure' : ''}`);
}
async function getRate(day) {
  const cached = (await db.exchangeRate(day));
  if (cached) return cached;
  const response = await fetch(`https://api.frankfurter.dev/v2/rate/USD/KRW?date=${day}`, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error('환율 조회 실패');
  const r = await response.json();
  if (!r || r.base !== 'USD' || r.quote !== 'KRW' || !(r.rate > 0) || !validDate(r.date) || r.date > day) throw new Error('환율 데이터 오류');
  (await db.saveExchangeRate(day,r.rate,r.date));
  return { rate: r.rate, rate_date: r.date };
}
async function sync(userId) {
  const warnings = [];
  for (const s of (await db.subscriptions(userId))) {
    const recorded = new Set((await db.billingMonths(userId,s.id)).map(t=>t.billing_month));
    for (const bill of occurrences(s, today())) {
      if (bill.date.slice(0,4)!==today().slice(0,4) || recorded.has(bill.month)) continue;
      let fx = { rate: 1, rate_date: bill.date };
      if (s.currency === 'USD') {
        try { fx = await getRate(bill.date); } catch { warnings.push(`${s.name}: ${bill.date} 환율을 확인할 수 없어 자동 기록을 보류했습니다.`); break; }
      }
      (await db.createTransaction({id:randomUUID(),user_id:userId,type:'expense',amount:Math.max(1,Math.round(s.amount*fx.rate)),date:bill.date,category:'고정지출',memo:s.name,subscription_id:s.id,billing_month:bill.month,original_amount:s.amount,currency:s.currency,rate:fx.rate,rate_date:fx.rate_date},true));
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
async function upcoming(s) {
  const recorded = new Set((await db.billingMonths(s.user_id,s.id)).map(t=>t.billing_month));
  let month = s.start_month;
  for (let i=0;i<1300;i++) {
    const d = billDate(month, s.original_day);
    if (d.slice(0,4)>=today().slice(0,4) && !recorded.has(month)) return { ...s, next_date: d, next_month: month };
    month = nextMonth(month);
  }
  return s;
}
async function api(req, res, url) {
  if (url.pathname === '/api/cron' && req.method === 'GET') {
    const secret = process.env.CRON_SECRET;
    if (!secret || !timingSafeEqual(Buffer.from(hash(req.headers.authorization || ''),'hex'),Buffer.from(hash(`Bearer ${secret}`),'hex'))) fail('권한이 없습니다.',401);
    await ensureStore();
    const users = await db.activeUsers();
    let processed = 0, pending = 0;
    for (const u of users) { pending += (await sync(u.id)).length; processed++; }
    return {ok:true,processed,pending};
  }
  await ensureStore();
  const path = url.pathname, method = req.method;
  if (!['GET','HEAD'].includes(method)) {
    const origin = req.headers.origin;
    if (origin && origin !== appUrl && origin !== `http://127.0.0.1:${port}`) fail('허용되지 않은 요청입니다.', 403);
    if (req.headers['sec-fetch-site'] === 'cross-site') fail('허용되지 않은 요청입니다.', 403);
  }
  if (path === '/api/status' && method === 'GET') {
    const setup = !await db.hasUsers();
    return { setup, setupCodeRequired: setup && !!process.env.VERCEL, emailConfigured: !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM) };
  }
  if (path === '/api/register' && method === 'POST') {
    await rateLimit(req, 'register', 10);
    const b = await body(req), mail = email(b.email), pass = password(b.password);
    const first = !(await db.hasUsers());
    const name = first ? 'JE.KIM' : text(b.name, 40), id = randomUUID();
    if ((await db.findUserByEmail(mail))) fail('이 이메일로 계정을 만들 수 없습니다.');
    if (first && process.env.VERCEL) {
      const setupCode = process.env.ADMIN_SETUP_CODE;
      if (!process.env.ADMIN_EMAIL || !setupCode) fail('관리자 계정 설정이 필요합니다.', 503);
      if (mail !== process.env.ADMIN_EMAIL.trim().toLowerCase()) fail('첫 계정은 지정된 관리자 이메일로 만들어 주세요.',403);
      if (typeof b.setupCode!=='string' || !timingSafeEqual(Buffer.from(hash(b.setupCode.trim()),'hex'),Buffer.from(hash(setupCode),'hex'))) fail('관리자 설정 코드를 확인해 주세요.',403);
    }
    const categories = Object.entries(defaults).flatMap(([type,names])=>names.map(name=>({type,name})));
    categories.push({type:'expense',name:'고정지출'});
    try { await db.createUser({id,email:mail,name,password:digest(pass),role:first?'admin':'user'},categories); } catch(error) {
      if (['23505','ERR_SQLITE_ERROR'].includes(error.code)) fail('계정을 만들 수 없습니다. 이미 등록되었는지 확인해 주세요.',409);
      throw error;
    }
    await session(res,id); return { ok: true };
  }
  if (path === '/api/login' && method === 'POST') {
    await rateLimit(req,'login');
    const b = await body(req), mail = email(b.email), pass = password(b.password);
    const u = (await db.findUserByEmail(mail));
    const matches = verify(pass, u?.password || dummyPassword);
    if (!u || !matches || u.disabled) fail('이메일 또는 비밀번호를 확인해 주세요.',401);
    await session(res,u.id); return { ok: true };
  }
  if (path === '/api/forgot' && method === 'POST') {
    await rateLimit(req,'forgot',5);
    const b = await body(req), mail = email(b.email);
    if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) fail('이메일 발송 서비스가 아직 연결되지 않았습니다. 서버 설정이 필요합니다.',503);
    const u = (await db.findUserByEmail(mail));
    if (u && !u.disabled) {
      const token = randomBytes(32).toString('hex');
      await db.createReset(hash(token),u.id,Date.now()+30*60000,Date.now());
      try {
        const r = await fetch('https://api.resend.com/emails',{ method:'POST', signal:AbortSignal.timeout(10000), headers:{ Authorization:`Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type':'application/json' }, body:JSON.stringify({from:process.env.MAIL_FROM,to:[mail],subject:'머니체크 비밀번호 재설정',text:`다음 링크에서 30분 이내에 비밀번호를 재설정하세요.\n${appUrl}/?reset=${token}\n요청하지 않았다면 이 이메일을 무시하세요.`}) });
        if (!r.ok) throw new Error('mail');
      } catch { (await db.deleteReset(hash(token))); fail('이메일 전송을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',503); }
    }
    return { message:'가입된 이메일이라면 재설정 링크를 보냈습니다.' };
  }
  if (path === '/api/reset' && method === 'POST') {
    await rateLimit(req,'reset'); const b = await body(req), pass = password(b.password);
    if (typeof b.token !== 'string') fail('유효하지 않은 링크입니다.');
    if (!await db.consumeReset(hash(b.token),Date.now(),digest(pass))) fail('만료되었거나 이미 사용한 링크입니다.');
    return { ok:true };
  }
  if (path === '/api/sms/receive' && method === 'POST') {
    const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1];
    const device = token && await db.smsUser(hash(token),Date.now());
    if (!device) fail('문자 연결이 만료되었거나 해제되었습니다.',401);
    if (await db.rateLimit(hash('sms:'+device.id),Date.now()) > 300) fail('잠시 후 다시 시도해 주세요.',429);
    const parsed = parseCardSms(await body(req));
    if (!parsed) return {ok:true,recorded:false,message:'지원하지 않는 문자입니다. 직접 확인해 주세요.'};
    const {event,...t} = parsed;
    const result = await db.createTransaction({...t,id:'sms-'+hash(device.id+':'+event),user_id:device.id},true);
    return {ok:true,recorded:!!result.changes,message:result.changes?'장부에 기록했습니다.':'이미 처리한 문자입니다.'};
  }
  const user = await auth(req);
  if (!user) fail('로그인이 필요합니다.',401);
  if (path === '/api/sms/device') {
    if (method === 'GET') {const d=await db.smsDevice(user.id);return {connected:!!d&&d.expires>Date.now()};}
    if (method === 'DELETE') {await body(req);await db.deleteSmsDevice(user.id);return {ok:true};}
    if (method === 'POST') {
      await body(req);const token=randomBytes(32).toString('hex');
      await db.setSmsDevice(user.id,hash(token),Date.now()+365*86400000);
      return {token};
    }
  }
  if (path === '/api/export' && method === 'GET') {
    const year = url.searchParams.get('year') || today().slice(0,4);
    if (!/^\d{4}$/.test(year) || Number(year)<2000 || year>today().slice(0,4)) fail('저장할 연도를 확인해 주세요.');
    if (year===today().slice(0,4)) await sync(user.id);
    const rows = await db.transactions(user.id,year);
    const columns = ['날짜','구분','카테고리','금액(원)','메모','청구 월','원래 금액','통화','적용 환율','환율 기준일'];
    const cell = value => {
      let text = String(value ?? '');
      if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"','""') + '"';
    };
    const lines = [columns,...rows.map(t=>[t.date,t.type==='income'?'수입':'지출',t.category==='구독'?'고정지출':t.category,t.amount,t.memo,t.billing_month,t.original_amount,t.currency,t.rate,t.rate_date])];
    res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="moneycheck-${year}.csv"`});
    res.end('\uFEFF'+lines.map(line=>line.map(cell).join(',')).join('\r\n')+'\r\n');
    return;
  }
  if (path === '/api/logout' && method === 'POST') {
    await body(req); (await db.deleteSessions(user.id));
    res.setHeader('Set-Cookie','moneycheck=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return { ok:true };
  }
  if (path === '/api/data' && method === 'GET') {
    const year = today().slice(0,4);
    const warnings = await sync(user.id);
    return { user, year, today:today(), warnings, transactions:(await db.transactions(user.id,year)).map(t=>({...t,category:t.category==='구독'?'고정지출':t.category})), subscriptions:await Promise.all((await db.subscriptions(user.id)).map(upcoming)), categories:(await db.categories(user.id)).map(c=>({...c,name:c.name==='구독'?'고정지출':c.name})).filter((c,i,a)=>a.findIndex(v=>v.type===c.type&&v.name===c.name)===i) };
  }
  if (path === '/api/categories' && method === 'POST') {
    const b = await body(req); (await db.addCategory(user.id,type(b.type),text(b.name,30))); return { ok:true };
  }
  if (path === '/api/transactions' && method === 'POST') {
    const b = await body(req), t = type(b.type), c = text(b.category,30);
    if (!(await db.hasCategory(user.id,t,c)) && !(c==='고정지출' && await db.hasCategory(user.id,t,'구독'))) fail('카테고리를 먼저 추가해 주세요.');
    (await db.createTransaction({id:randomUUID(),user_id:user.id,type:t,amount:amount(b.amount),date:ledgerDate(b.date),category:c,memo:typeof b.memo==='string'&&b.memo.length<=500?b.memo:''})); return { ok:true };
  }
  const tx = /^\/api\/transactions\/([\w-]+)$/.exec(path);
  if (tx && ['PATCH','DELETE'].includes(method)) {
    const row = (await db.transaction(user.id,tx[1]));
    if (!row || row.date.slice(0,4)!==today().slice(0,4)) fail('내역을 찾을 수 없습니다.',404);
    if (method === 'DELETE') { await body(req); (await db.deleteTransaction(user.id,row.id)); }
    else {
      const b = await body(req), t = row.subscription_id ? 'expense' : type(b.type), c = text(b.category,30);
      if (!(await db.hasCategory(user.id,t,c)) && !(c==='고정지출' && await db.hasCategory(user.id,t,'구독'))) fail('카테고리를 확인해 주세요.');
      (await db.updateTransaction(user.id,row.id,{type:t,amount:amount(b.amount),date:ledgerDate(b.date),category:c,memo:typeof b.memo==='string'&&b.memo.length<=500?b.memo:''}));
    }
    return { ok:true };
  }
  if (path === '/api/subscriptions' && method === 'POST') {
    const b = await body(req), [name,amount,currency,original_day,start_month] = subscriptionData(b);
    (await db.createSubscription({id:randomUUID(),user_id:user.id,name,amount,currency,original_day,start_month})); return { ok:true };
  }
  const sub = /^\/api\/subscriptions\/([\w-]+)$/.exec(path);
  if (sub && ['PATCH','DELETE'].includes(method)) {
    const row = (await db.subscription(user.id,sub[1]));
    if (!row) fail('고정지출을 찾을 수 없습니다.',404);
    const b = await body(req);
    if (method === 'DELETE') (await db.stopSubscription(user.id,row.id));
    else {
      // 이미 기록된 청구분은 유지하고, 이후 청구에만 서비스명/요금을 적용한다.
      const currency = ['USD','KRW'].includes(b.currency) ? b.currency : fail('통화를 확인해 주세요.');
      (await db.updateSubscription(user.id,row.id,{name:text(b.name),amount:amount(b.amount,currency),currency}));
    }
    return { ok:true };
  }
  if (path === '/api/admin/users' && method === 'GET') {
    if (user.role !== 'admin') fail('권한이 없습니다.',403);
    return { users:(await db.accountProfiles()) };
  }
  const account = /^\/api\/admin\/users\/([\w-]+)$/.exec(path);
  if (account && method === 'PATCH') {
    if (user.role !== 'admin') fail('권한이 없습니다.',403);
    if (account[1] === user.id) fail('본인 관리자 계정은 정지할 수 없습니다.');
    const b = await body(req);
    if (typeof b.disabled !== 'boolean') fail('계정 상태를 확인해 주세요.');
    if (!await db.setDisabled(account[1],b.disabled)) fail('계정을 찾을 수 없습니다.',404);
    await db.deleteSessions(account[1]); return { ok:true };
  }
  fail('요청을 찾을 수 없습니다.',404);
}
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.apk':'application/vnd.android.package-archive'};
export async function handleRequest(req,res) {
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const url = new URL(req.url,appUrl);
    if (url.pathname.startsWith('/api/')) { res.setHeader('Cache-Control','no-store'); const result = await api(req,res,url); if (res.writableEnded) return; res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(result)); return; }
    if (!['GET','HEAD'].includes(req.method)) fail('지원하지 않는 요청입니다.',405);
    const files = {'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg','/downloads/moneycheck-sms.apk':'downloads/moneycheck-sms.apk'};
    const name = files[url.pathname]; if (!name) fail('페이지를 찾을 수 없습니다.',404);
    const content = await readFile(resolve(root,'public',name)); res.writeHead(200,{'Content-Type':mime[extname(name)],'Cache-Control':'no-cache'}); res.end(req.method === 'HEAD' ? undefined : content);
  } catch (e) {
    const databaseUnavailable = ['42P01','ECONNREFUSED','ENOTFOUND','ETIMEDOUT','28P01',7,8,14,16].includes(e.code);
    res.setHeader('Cache-Control','no-store');
    res.writeHead(e.status || (databaseUnavailable ? 503 : 500),{'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({error:e.status?e.message:databaseUnavailable?'데이터 저장소에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.':'처리를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'}));
    if (!e.status) console.error('요청 처리 실패',e.code || e.name);
  }
}
export default handleRequest;
const server = process.env.VERCEL ? null : http.createServer(handleRequest);
server?.listen(port,host,()=>console.log(`머니체크 실행: http://localhost:${port}`));
let running = false;
const timer = process.env.VERCEL ? null : setInterval(async()=>{ if(running)return; running=true; try { await ensureStore(); for(const u of (await db.activeUsers())) await sync(u.id); } catch(e){ console.error('자동 기록 처리 실패:',e.message); } finally { running=false; } },60000);
timer?.unref();
if (!process.env.VERCEL) for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{ clearInterval(timer);server.close(()=>{Promise.resolve(db?.close()).finally(()=>process.exit(0));}); });
