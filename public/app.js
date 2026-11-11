const $ = selector => document.querySelector(selector);
const app = $('#app'), modal = $('#modal');
const money = value => new Intl.NumberFormat('ko-KR').format(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = { calendar:'M4 7h16M8 3v6m8-6v6M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z M8 12h2m4 0h2m-8 4h2m4 0h2', chart:'M4 20h16M7 16v-5m5 5V5m5 11V8', list:'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', repeat:'m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3', plus:'M12 5v14M5 12h14', arrowUp:'m6 12 6-6 6 6m-6-6v14', arrowDown:'m6 12 6 6 6-6m-6 6V4', wallet:'M20 8H5a2 2 0 0 1 0-4h13v4m2 0v12H5a2 2 0 0 1-2-2V6m17 6h-5v4h5', bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12h4', left:'m14 6-6 6 6 6', right:'m10 6 6 6-6 6', logout:'M9 4H4v16h5m6-12 4 4-4 4m-6-4h10', shield:'m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6', coffee:'M4 8h12v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Zm12 1h2a3 3 0 1 1 0 6h-2M7 3v2m5-2v2', user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2', check:'m5 12 4 4L19 6', bag:'M5 7h14l1 14H4L5 7Zm3 0V5a4 4 0 0 1 8 0v2' };
const icon = name => `<span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${paths[name] || paths.wallet}"/></svg></span>`;
let state = { page:'calendar', selected:'', month:'', filter:'all', search:'', data:null, status:null, authMode:'login' };
let toastTimer;
function toast(message) { $('#toast').textContent=message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500); }
async function api(path, method='GET', data) {
  const res = await fetch('/api/'+path,{method, headers:method==='GET'?{}:{'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(data||{})});
  const result = await res.json(); if (!res.ok) throw new Error(result.error || '요청을 완료하지 못했습니다.'); return result;
}
function localDate() { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function dateLabel(d) { return new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'long',timeZone:'UTC'}).format(new Date(d+'T00:00:00Z')); }
function monthLabel() { const [y,m]=state.month.split('-'); return `${y}년 ${Number(m)}월`; }
function addMonth(value,offset) { const [y,m]=value.split('-').map(Number); return new Date(Date.UTC(y,m-1+offset,1)).toISOString().slice(0,7); }
function billingDate(month,day) { const [y,m]=month.split('-').map(Number); return day>new Date(Date.UTC(y,m,0)).getUTCDate()?addMonth(month,1)+'-01':`${month}-${String(day).padStart(2,'0')}`; }
function brand(extra='') { return `<div class="brand ${extra}"><img src="/favicon.svg" alt="">머니체크</div>`; }
function authView(mode = state.authMode) {
  state.authMode=mode;
  const setup=state.status?.setup, reset=new URLSearchParams(location.search).get('reset');
  if (reset) mode='reset'; else if (setup && mode==='login') mode='register';
  const titles={login:'다시 만나 반가워요',register:setup?'나의 첫 머니체크':'계정 만들기',forgot:'비밀번호 찾기',reset:'새 비밀번호 설정'};
  const descriptions={login:'오늘의 돈 흐름을 확인해 볼까요?',register:setup?'첫 계정은 JE.KIM 관리자 계정으로 만들어집니다.':'나만의 수입과 지출을 차분하게 관리하세요.',forgot:'가입한 이메일로 재설정 링크를 보내 드립니다.',reset:'안전하게 사용할 새 비밀번호를 입력해 주세요.'};
  app.innerHTML=`<main class="onboard"><section class="onboard-art">${brand()}<div class="eyebrow">매일 조금씩, 더 나은 돈 관리</div><h1>내 돈의 흐름을<br>한눈에, 머니체크.</h1><p>매일의 수입과 지출, 잊기 쉬운 구독까지.<br>달력 한 장으로 가볍게 시작하세요.</p><div class="illustration"><div class="month-control"><h2>나의 한 달</h2><span class="badge">차곡차곡 기록 중</span></div><div class="mini-days">${Array.from({length:21},(_,i)=>`<span class="${[3,8,14].includes(i)?'marked':''}">${i+1}</span>`).join('')}</div><div class="summary-foot">작은 기록이 만드는 좋은 습관</div></div></section><section class="onboard-form"><div class="auth-card"><h2>${titles[mode]}</h2><p class="subtitle">${descriptions[mode]}</p><form id="auth-form" data-mode="${mode}">${mode==='register'&&!setup?'<label class="form-field">이름<input name="name" required maxlength="40" autocomplete="name" placeholder="이름을 입력해 주세요"></label>':''}${mode!=='reset'?'<label class="form-field">이메일<input type="email" name="email" required maxlength="254" autocomplete="email" placeholder="name@example.com"></label>':''}${mode!=='forgot'?`<label class="form-field">비밀번호<input type="password" name="password" required minlength="10" maxlength="128" autocomplete="${mode==='login'?'current-password':'new-password'}" placeholder="10자 이상 입력해 주세요"></label>`:''}${['register','reset'].includes(mode)?'<label class="form-field">비밀번호 확인<input type="password" name="confirm" required minlength="10" maxlength="128" autocomplete="new-password" placeholder="한 번 더 입력해 주세요"></label>':''}<div class="error" id="auth-error" role="alert"></div><button type="submit" class="primary">${{login:'로그인',register:'계정 만들고 시작하기',forgot:'재설정 링크 보내기',reset:'비밀번호 변경'}[mode]}${icon('right')}</button></form><div class="auth-links">${mode==='login'?'<button data-auth="forgot">비밀번호를 잊으셨나요?</button><button data-auth="register">계정 만들기</button>':!setup?'<button data-auth="login">로그인으로 돌아가기</button>':''}</div><div class="auth-note">${icon('shield')} 내 금융 내역은 나만 확인할 수 있어요.<br>${mode==='forgot'&&!state.status?.emailConfigured?'이메일 발송 서비스가 아직 연결되지 않았습니다.':'한 기기에서 하나의 계정으로 안전하게 사용하세요.'}</div></div></section></main>`;
}
async function load() {
  state.data=await api('data');
  if(!state.month.startsWith(state.data.year+'-'))state.month=state.data.today.slice(0,7);
  if(!state.selected.startsWith(state.data.year+'-'))state.selected=state.data.today;
  render();
}
function exportModal() {
  openModal('연도별 장부 저장',`<form id="export-form"><label class="form-field">저장할 연도<input name="year" type="number" min="2000" max="${state.data.year}" value="${state.data.year}" required></label><p class="subtitle">매년 1월 1일에 새 장부가 시작됩니다. 이전 연도의 수입·지출 내역도 CSV 파일로 저장할 수 있습니다.</p><div class="error" role="alert"></div><div class="modal-actions"><span></span><button type="submit" class="primary">CSV 파일 저장</button></div></form>`);
}
function monthly() { return state.data.transactions.filter(t=>t.date.startsWith(state.month)); }
function totals() { const rows=monthly(); return {income:rows.filter(t=>t.type==='income').reduce((a,t)=>a+t.amount,0),expense:rows.filter(t=>t.type==='expense').reduce((a,t)=>a+t.amount,0),subscription:rows.filter(t=>t.subscription_id).reduce((a,t)=>a+t.amount,0)}; }
function summary() { const t=totals(); const period = state.month===state.data.today.slice(0,7) ? '이번 달' : monthLabel(); return `<div class="summary-grid">${[{label:period+' 수입',value:t.income,icon:'arrowDown',class:'income-text',foot:period+' 들어온 금액'},{label:period+' 지출',value:t.expense,icon:'arrowUp',class:'expense-text',foot:'구독료가 포함된 실제 지출'},{label:'남은 금액',value:t.income-t.expense,icon:'wallet',highlight:true,foot:'수입에서 지출을 뺀 금액'},{label:period+' 구독료',value:t.subscription,icon:'repeat',foot:`이용 중인 구독 ${state.data.subscriptions.length}개 · 실제 기록 기준`}].map(c=>`<section class="summary-card ${c.highlight?'highlight':''}"><div class="summary-label">${c.label}${icon(c.icon)}</div><div class="summary-value ${c.highlight?'':c.class||''}">${money(c.value)}<small>원</small></div><div class="summary-foot">${c.foot}</div></section>`).join('')}</div>`; }
function monthControl() { return `<div class="month-control"><h2>${monthLabel()}</h2><button data-month="-1" ${state.month.endsWith("-01")?"disabled":""} aria-label="이전 달">${icon('left')}</button><button data-month="1" ${state.month.endsWith("-12")?"disabled":""} aria-label="다음 달">${icon('right')}</button></div>`; }
function empty(title,desc='',action='') { return `<div class="empty">${icon('wallet')}<strong>${title}</strong>${desc}${action}</div>`; }
function alerts() {
  const now=state.data.today, end=new Date(new Date(now+'T00:00:00Z').getTime()+2*86400000).toISOString().slice(0,10);
  const due=state.data.subscriptions.filter(s=>s.next_date>=now&&s.next_date<=end);
  return `${state.data.warnings.map(w=>`<div class="notice warning">${icon('bell')}${esc(w)}</div>`).join('')}${due.length?`<div class="notice">${icon('bell')}<span>${due.map(s=>`${esc(s.name)} · ${dateLabel(s.next_date)} 결제 예정`).join(' / ')}</span></div>`:''}`;
}
function projectedFor(day) {
  const out=[];
  for(const s of state.data.subscriptions) {
    for(const m of [addMonth(day.slice(0,7),-1),day.slice(0,7)]) {
      if(m>=s.start_month && billingDate(m,s.original_day)===day && !state.data.transactions.some(t=>t.subscription_id===s.id&&t.billing_month===m) && day>=s.next_date) out.push(s);
    }
  }
  return out;
}
function calendar() {
  const [y,m]=state.month.split('-').map(Number), first=new Date(Date.UTC(y,m-1,1)), offset=first.getUTCDay();
  const weeks=Math.ceil((offset+new Date(Date.UTC(y,m,0)).getUTCDate())/7), rows=state.data.transactions;
  const days=Array.from({length:weeks*7},(_,i)=>{
    const d=new Date(Date.UTC(y,m-1,1-offset+i)).toISOString().slice(0,10), tx=rows.filter(t=>t.date===d), inc=tx.filter(t=>t.type==='income').reduce((a,t)=>a+t.amount,0), exp=tx.filter(t=>t.type==='expense').reduce((a,t)=>a+t.amount,0), planned=projectedFor(d), subs=tx.filter(t=>t.subscription_id);
    return `<button class="day ${d.slice(0,7)!==state.month?'outside':''} ${d===state.data.today?'today':''} ${d===state.selected?'selected':''} ${i%7===0?'sunday':i%7===6?'saturday':''}" data-day="${d}" aria-label="${dateLabel(d)}, 수입 ${money(inc)}원, 지출 ${money(exp)}원${planned.length?', 예정 구독 '+planned.length+'건':''}" aria-pressed="${d===state.selected}"><span class="number">${Number(d.slice(-2))}</span>${inc?`<span class="sum income-text">+${money(inc)}</span>`:''}${exp?`<span class="sum expense-text">−${money(exp)}</span>`:''}${[...subs.map(s=>({name:s.memo,planned:false})),...planned.map(s=>({...s,planned:true}))].slice(0,2).map(s=>`<span class="sub-pill">${s.planned?'예정 · ':''}${esc(s.name)}</span>`).join('')}</button>`;
  }).join('');
  return `<div class="content-grid"><section class="panel"><div class="calendar-top">${monthControl()}<div class="calendar-tools"><div class="legend"><span><i class="dot income"></i>수입</span><span><i class="dot expense"></i>지출</span><span><i class="dot"></i>구독</span></div><button class="secondary" data-action="today">오늘</button></div></div><div class="weekdays">${['일','월','화','수','목','금','토'].map(w=>`<span>${w}</span>`).join('')}</div><div class="calendar-grid">${days}</div><div class="calendar-foot"><span>날짜를 눌러 상세 내역을 확인하세요</span><span>단위: 원</span></div></section><aside class="rail">${dayDetail()}${upcomingPanel()}${breakdownPanel()}</aside></div>`;
}
function entry(t) { return `<button class="entry" data-edit-tx="${t.id}"><span class="entry-icon ${t.type==='income'?'income':t.subscription_id?'subscription':''}">${icon(t.type==='income'?'arrowDown':t.subscription_id?'repeat':'bag')}</span><span class="entry-main"><strong>${esc(t.memo||t.category)}</strong><small>${esc(t.category)}${t.subscription_id?' · 자동 기록':''}</small></span><span class="entry-amount ${t.type==='income'?'income-text':'expense-text'}">${t.type==='income'?'+':'−'}${money(t.amount)}원</span></button>`; }
function dayDetail() {
  const rows=state.data.transactions.filter(t=>t.date===state.selected), planned=projectedFor(state.selected);
  return `<section class="panel"><div class="panel-title"><h2>하루의 기록</h2><button class="small-link" data-action="add-tx" aria-label="선택 날짜에 내역 추가">${icon('plus')}</button></div><div class="day-detail"><p class="date-caption">${dateLabel(state.selected)}</p>${rows.length?rows.map(entry).join(''):empty('아직 기록이 없어요','오늘의 작은 소비도 남겨 보세요.','<br><button data-action="add-tx">첫 내역 기록하기 +</button>')}${planned.map(s=>`<div class="entry"><span class="entry-icon subscription">${icon('repeat')}</span><span class="entry-main"><strong>${esc(s.name)}</strong><small>결제 예정 · ${s.currency==='USD'?'결제일 환율 적용':money(s.amount)+'원'}</small></span><span class="badge">예정</span></div>`).join('')}</div></section>`;
}
function upcomingPanel() {
  const subs=[...state.data.subscriptions].sort((a,b)=>a.next_date.localeCompare(b.next_date)).slice(0,3);
  return `<section class="panel"><div class="panel-title"><h2>다가오는 구독</h2><button class="small-link" data-page="subscriptions">전체 보기</button></div>${subs.length?subs.map(s=>`<div class="sub-item"><span class="service-icon">${esc(s.name.slice(0,1))}</span><span class="entry-main"><strong>${esc(s.name)}</strong><small>${s.next_date.slice(5).replace('-','월 ')}일 · ${s.currency==='USD'?'$'+money(s.amount):money(s.amount)+'원'}</small></span><span class="badge">${s.next_date<state.data.today?'확인 필요':s.next_date===state.data.today?'오늘':Math.ceil((new Date(s.next_date+'T00:00:00Z')-new Date(state.data.today+'T00:00:00Z'))/86400000)+'일 후'}</span></div>`).join(''):empty('등록한 구독이 없어요','자주 쓰는 서비스를 추가해 보세요.','<br><button data-action="add-sub">구독 추가하기 +</button>')}</section>`;
}
function breakdown() {
  const rows=monthly().filter(t=>t.type==='expense'), total=rows.reduce((a,t)=>a+t.amount,0), groups={};
  rows.forEach(t=>groups[t.category]=(groups[t.category]||0)+t.amount);
  return total?Object.entries(groups).sort((a,b)=>b[1]-a[1]).map(([c,v],i)=>`<div class="category-row"><div class="category-label"><span><i class="dot"></i>${esc(c)}</span><b>${money(v)}원</b></div><div class="track"><div class="fill" data-width="${Math.round(v/total*100)}" data-tone="${i%5}"></div></div></div>`).join(''):empty('이번 달 지출이 없어요','기록을 추가하면 비중을 보여 드려요.');
}
function breakdownPanel() { return `<section class="panel"><div class="panel-title"><h2>카테고리별 지출</h2><small>이번 달</small></div><div class="breakdown">${breakdown()}</div></section>`; }
function txTable(rows) { return rows.length?`<div class="table-scroll"><table class="table"><thead><tr><th>날짜</th><th>구분</th><th>카테고리</th><th>메모</th><th>금액</th><th>관리</th></tr></thead><tbody>${rows.map(t=>`<tr><td>${t.date}</td><td>${t.type==='income'?'수입':'지출'}${t.subscription_id?' <span class="tag">구독</span>':''}</td><td>${esc(t.category)}</td><td>${esc(t.memo||'—')}</td><td><span class="${t.type==='income'?'income-text':'expense-text'}">${t.type==='income'?'+':'−'}${money(t.amount)}원</span></td><td><button data-edit-tx="${t.id}">수정</button></td></tr>`).join('')}</tbody></table></div>`:empty('조건에 맞는 내역이 없어요','다른 달을 확인하거나 새 내역을 기록해 주세요.'); }
function transactions() {
  const rows=monthly().filter(t=>(state.filter==='all'||state.filter==='subscription'&&t.subscription_id||t.type===state.filter)&&`${t.memo} ${t.category}`.includes(state.search));
  return `<div class="month-toolbar">${monthControl()}<button class="secondary" data-action="today">이번 달</button></div><div class="filters">${[['all','전체'],['income','수입'],['expense','지출'],['subscription','구독']].map(([k,n])=>`<button data-filter="${k}" class="${state.filter===k?'active':''}">${n}</button>`).join('')}<label class="sr-only" for="search">메모 또는 카테고리 검색</label><input id="search" type="search" placeholder="메모, 카테고리 검색" value="${esc(state.search)}"></div><section class="panel"><div class="panel-title"><h2>선택한 달 전체 내역</h2><small>${rows.length}건</small></div><div class="section-full">${txTable(rows)}</div></section>`;
}
function subscriptions() {
  return `<div class="notice">${icon('repeat')}<span>결제일에 지출로 자동 기록돼요. 해당 날짜가 없는 달에는 다음 달 1일로 넘어가요.</span></div>${state.data.subscriptions.length?`<div class="subscriptions-grid">${state.data.subscriptions.map(s=>`<article class="panel subscription-card"><div class="service-icon">${esc(s.name.slice(0,1))}</div><h2>${esc(s.name)}</h2><span class="badge">매월 ${s.original_day}일</span><div class="price">${s.currency==='USD'?'$':''}${money(s.amount)}${s.currency==='KRW'?'원':''} <small>/ 월</small></div><div class="subscription-meta">다음 결제일 · ${s.next_date}<br>${s.currency==='USD'?'결제일의 기준 환율로 원화 환산':'원화로 자동 기록'}<br>이미 기록한 지출 금액은 내역에서 직접 수정해 주세요.</div><div class="card-actions"><button data-edit-sub="${s.id}">구독 수정</button><button class="danger" data-stop-sub="${s.id}">구독 해지</button></div></article>`).join('')}</div>`:`<section class="panel empty-large">${empty('놓치기 쉬운 정기 결제, 한곳에','첫 구독을 등록하면 결제일에 맞춰 지출을 기록해 드려요.','<br><button data-action="add-sub">첫 구독 등록하기 +</button>')}</section>`}`;
}
function dashboard() { const rows=monthly();return `<div class="month-toolbar">${monthControl()}<button class="secondary" data-action="today">이번 달</button></div><div class="dashboard-grid">${breakdownPanel()}${upcomingPanel()}<section class="panel"><div class="panel-title"><h2>최근 기록</h2><button class="small-link" data-page="transactions">전체 보기</button></div><div class="section-full">${rows.length?rows.slice(0,5).map(entry).join(''):empty('아직 기록이 없어요','수입과 지출을 기록하고 한 달을 돌아보세요.')}</div></section><section class="panel"><div class="panel-title"><h2>이번 달 돌아보기</h2><small>${monthLabel()}</small></div><div class="section-full"><div class="notice">${icon('check')}<span>이번 달 ${rows.length}건의 기록을 남겼어요.<br>작은 기록부터 꾸준히 쌓아 보세요.</span></div><p class="subtitle">구독료는 총지출에 포함돼요.<br>결제 예정 금액은 실제 지출로 기록되기 전까지 합계에서 제외됩니다.</p></div></section></div>`; }
async function adminContent() {
  try { const result=await api('admin/users'); const target=$('#admin-content'); if(!target)return;
    target.innerHTML=`<div class="notice">${icon('shield')}계정의 이용 상태만 관리할 수 있습니다. 다른 사람의 금융 내역에는 접근할 수 없습니다.</div><section class="panel"><div class="panel-title"><h2>계정 목록</h2><small>${result.users.length}명</small></div><div class="section-full table-scroll"><table class="table"><thead><tr><th>이름</th><th>이메일</th><th>권한</th><th>상태</th><th>관리</th></tr></thead><tbody>${result.users.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${u.role==='admin'?'관리자':'사용자'}</td><td>${u.disabled?'이용 정지':'이용 중'}</td><td>${u.role==='admin'?'—':`<button data-account="${u.id}" data-disabled="${!u.disabled}">${u.disabled?'이용 재개':'이용 정지'}</button>`}</td></tr>`).join('')}</tbody></table></div></section>`;
  } catch(e) { toast(e.message); }
}
function render() {
  const d=state.data, page=state.page, names={calendar:'나의 달력',transactions:'수입·지출 내역',subscriptions:'구독 관리',dashboard:'대시보드',admin:'계정 관리'}, descriptions={calendar:'하루하루 쌓이는 기록, 한눈에 확인하세요.',transactions:'작은 수입과 지출도 빠짐없이 기록하세요.',subscriptions:'매달 나가는 구독료, 이제 놓치지 마세요.',dashboard:'이번 달 나의 돈 흐름을 차분하게 돌아보세요.',admin:'JE.KIM 관리자 · 계정 이용 상태 관리'};
  app.innerHTML=`<div class="layout"><aside class="sidebar">${brand()}<div class="brand-sub">나의 돈을 한눈에</div><div class="nav-label">나의 공간</div><nav class="nav" aria-label="주요 메뉴">${[['calendar','calendar'],['transactions','list'],['subscriptions','repeat'],['dashboard','chart'],...(d.user.role==='admin'?[['admin','user']]:[])].map(([k,i])=>`<button data-page="${k}" class="${page===k?'active':''}" ${page===k?'aria-current="page"':''}>${icon(i)}${names[k]}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="mini-note"><strong>기록이 만드는 좋은 변화</strong>오늘의 작은 기록이<br>내일의 여유가 될 거예요.</div><div class="profile"><span class="avatar">${esc(d.user.name.slice(0,2).toUpperCase())}</span><div><strong>${esc(d.user.name)}</strong><small>${d.user.role==='admin'?'관리자 계정':'나의 계정'}</small></div><button class="logout" data-action="logout" aria-label="로그아웃">${icon('logout')}</button></div></div></aside><main class="main"><header class="topbar">${brand('mobile-brand')}<div class="breadcrumbs">나의 공간 <b>› &nbsp; ${names[page]}</b></div><div class="top-right"><button class="secondary" data-action="export">장부 저장</button><span>${dateLabel(d.today)}</span><button data-action="notifications" aria-label="결제 알림 확인">${icon('bell')}</button><button class="mobile-logout" data-action="logout" aria-label="로그아웃" hidden>${icon('logout')}</button></div></header><div class="heading"><div><div class="eyebrow">나만의 가계부</div><h1>${names[page]}</h1><p class="subtitle">${descriptions[page]}</p></div>${page!=='admin'?`<button class="primary" data-action="${page==='subscriptions'?'add-sub':'add-tx'}">${icon('plus')}${page==='subscriptions'?'구독 추가':'내역 추가'}</button>`:''}</div>${alerts()}${page!=='admin'?summary():''}${page==='calendar'?calendar():page==='transactions'?transactions():page==='subscriptions'?subscriptions():page==='dashboard'?dashboard():'<div id="admin-content"><div class="empty">계정 목록을 불러오는 중입니다.</div></div>'}<footer class="footer"><span>머니체크 · 매일의 작은 기록</span><span>모든 금액은 실제 기록 기준입니다</span></footer></main></div>`;
  // 퍼센트는 계산한 숫자만 사용하며, 사용자 문자열은 스타일에 넣지 않는다.
  document.querySelectorAll('[data-width]').forEach(el=>{ el.style.setProperty('--width',el.dataset.width+'%'); el.style.background=['#a596e4','#b8acdF','#c3b9e5','#d1c9ed','#e0daf3'][Number(el.dataset.tone)]; });
  if(page==='admin')adminContent();
}
function openModal(title,content) { modal.innerHTML=`<div class="modal-head"><h2>${title}</h2><button class="close" data-close aria-label="닫기">×</button></div>${content}`;if(!modal.open)modal.showModal(); }
function categories(t) { return state.data.categories.filter(c=>c.type===t).map(c=>c.name); }
let editingTx=null, txType='expense', txDraft=null;
function transactionModal(row=null, kind=row?.type||'expense', draft=null) {
  editingTx=row;txType=kind;txDraft=draft;
  const v=draft||row||{}, opts=categories(kind);
  openModal(row?'내역 수정':'새로운 기록',`<div class="segmented"><button data-tx-type="expense" class="${kind==='expense'?'active':''}" ${row?.subscription_id?'disabled':''}>지출</button><button data-tx-type="income" class="${kind==='income'?'active':''}" ${row?.subscription_id?'disabled':''}>수입</button></div><form id="tx-form"><label class="form-field">금액 (원)<input name="amount" type="number" required min="1" max="1000000000000" step="1" inputmode="numeric" placeholder="0" value="${v.amount||''}"></label><div class="form-row"><label class="form-field">날짜<input type="date" name="date" required min="${state.data.year}-01-01" max="${state.data.year}-12-31" value="${esc(v.date||state.selected)}"></label><label class="form-field">카테고리<select name="category">${opts.map(c=>`<option ${v.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label></div><button type="button" class="form-add-category" data-action="add-category">+ 카테고리 직접 추가</button><label class="form-field">메모<textarea name="memo" maxlength="500" placeholder="어떤 기록인가요?">${esc(v.memo||'')}</textarea></label>${row?.subscription_id?`<div class="notice">${icon('repeat')}<span>자동 기록된 구독 지출입니다. 금액 수정은 이 내역에만 적용됩니다.${row.currency==='USD'?`<br>원래 금액 $${money(row.original_amount)} · 적용 환율 ${money(row.rate)}원<br>환율 기준일 ${row.rate_date}`:''}</span></div>`:''}<div class="error" role="alert" id="form-error"></div><div class="modal-actions">${row?`<button type="button" class="danger" data-delete-tx="${row.id}">내역 삭제</button>`:'<span></span>'}<button type="submit" class="primary">${icon('check')}기록 저장</button></div></form>`);
}
let editingSub=null;
function subscriptionModal(row=null) {
  editingSub=row;
  openModal(row?'구독 수정':'새 구독 등록',`<form id="sub-form"><label class="form-field">서비스명<input name="name" required maxlength="100" placeholder="예: 넷플릭스" value="${esc(row?.name||'')}"></label><div class="form-row"><label class="form-field">요금<input type="number" name="amount" required min="1" max="1000000000000" step="1" value="${row?.amount||''}" placeholder="0"></label><label class="form-field">통화<select name="currency"><option value="KRW">원화 (KRW)</option><option value="USD" ${row?.currency==='USD'?'selected':''}>미국 달러 (USD)</option></select></label></div>${!row?`<div class="form-row"><label class="form-field">다음 결제일<input type="date" name="next_date" required min="2000-01-01" max="2100-12-31" value="${state.data.today}"></label><label class="form-field">원래 결제일<input type="number" name="original_day" required min="1" max="31" step="1" value="${Number(state.data.today.slice(-2))}"></label></div><div class="notice"><span>예: 31일 구독의 4월분을 등록하려면 다음 결제일은 5월 1일, 원래 결제일은 31일로 입력하세요. 과거 결제일을 지정하면 미기록 청구분을 자동으로 기록합니다.</span></div>`:`<div class="notice"><span>매월 ${row.original_day}일 결제 · 다음 결제일 ${row.next_date}<br>변경한 요금은 이후 자동 기록부터 적용됩니다. 과거 지출은 수입·지출 내역에서 수정하세요.</span></div>`}<p class="subtitle">달러 요금은 결제일의 기준 환율로 환산합니다. 휴일은 최근 공시 환율을 사용하며, 조회 실패 시 기록을 보류합니다.</p><div class="error" id="form-error" role="alert"></div><div class="modal-actions"><span></span><button type="submit" class="primary">${icon('check')}구독 저장</button></div></form>`);
  updateCurrency();
}
function updateCurrency() { const f=$('#sub-form');if(!f)return; const usd=f.elements.currency.value==='USD';f.elements.amount.step=usd?'0.01':'1';f.elements.amount.min=usd?'0.01':'1'; }
function confirmModal(title,description,action,id) { openModal(title,`<div class="delete-confirm">${description}</div><div class="error" id="form-error" role="alert"></div><div class="modal-actions"><button class="secondary" data-close>취소</button><button class="primary" data-confirm="${action}" data-id="${id}">확인</button></div>`); }
document.addEventListener('click',async e=>{
  const el=e.target.closest('button');if(!el)return;
  try {
    if(el.hasAttribute('data-close')){modal.close();return;}
    if(el.dataset.auth){authView(el.dataset.auth);return;}
    if(el.dataset.page){state.page=el.dataset.page;render();window.scrollTo(0,0);return;}
    if(el.dataset.month){const month=addMonth(state.month,Number(el.dataset.month));if(!month.startsWith(state.data.year+'-'))return;state.month=month;state.selected=month+'-01';render();return;}
    if(el.dataset.day){if(!el.dataset.day.startsWith(state.data.year+'-'))return;state.selected=el.dataset.day;state.month=state.selected.slice(0,7);render();return;}
    if(el.dataset.filter){state.filter=el.dataset.filter;render();return;}
    if(el.dataset.txType){const f=$('#tx-form');transactionModal(editingTx,el.dataset.txType,Object.fromEntries(new FormData(f)));return;}
    if(el.dataset.editTx){transactionModal(state.data.transactions.find(t=>t.id===el.dataset.editTx));return;}
    if(el.dataset.editSub){subscriptionModal(state.data.subscriptions.find(s=>s.id===el.dataset.editSub));return;}
    if(el.dataset.deleteTx){confirmModal('내역을 삭제할까요?','삭제한 내역은 합계에서 제외됩니다. 구독 자동 기록을 삭제해도 같은 청구분이 다시 생성되지 않습니다.','delete-tx',el.dataset.deleteTx);return;}
    if(el.dataset.stopSub){confirmModal('구독 기록을 중단할까요?','이미 기록한 지출은 유지하고 이후 자동 기록과 알림을 중단합니다. 실제 서비스의 결제 해지는 해당 서비스에서 진행해 주세요.','stop-sub',el.dataset.stopSub);return;}
    if(el.dataset.account){el.disabled=true;await api('admin/users/'+el.dataset.account,'PATCH',{disabled:el.dataset.disabled==='true'});await adminContent();toast('계정 상태를 변경했습니다.');return;}
    if(el.dataset.confirm){el.disabled=true;await api((el.dataset.confirm==='delete-tx'?'transactions/':'subscriptions/')+el.dataset.id,'DELETE');modal.close();await load();toast('변경 사항을 저장했습니다.');return;}
    switch(el.dataset.action){
      case 'export':exportModal();break;
      case 'add-tx':transactionModal();break;
      case 'add-sub':subscriptionModal();break;
      case 'today':state.selected=state.data.today;state.month=state.data.today.slice(0,7);render();break;
      case 'logout':await api('logout','POST');state.data=null;state.month='';state.selected='';state.status=await api('status');authView('login');break;
      case 'notifications':{const due=state.data.subscriptions.filter(s=>s.next_date<=new Date(new Date(state.data.today+'T00:00:00Z').getTime()+2*86400000).toISOString().slice(0,10));openModal('결제 알림',due.length?due.map(s=>`<div class="entry"><span class="entry-icon subscription">${icon('bell')}</span><span class="entry-main"><strong>${esc(s.name)}</strong><small>${s.next_date} 결제${s.next_date<state.data.today?' · 기록 확인 필요':' 예정'}</small></span></div>`).join(''):empty('가까운 결제 일정이 없어요','결제 이틀 전부터 이곳에서 알려 드려요.'));break;}
      case 'add-category':{const draft=Object.fromEntries(new FormData($('#tx-form')));txDraft=draft;openModal('카테고리 추가',`<form id="category-form"><label class="form-field">새 ${txType==='income'?'수입':'지출'} 카테고리<input name="name" required maxlength="30" placeholder="예: 교육"></label><div class="error" id="form-error" role="alert"></div><div class="modal-actions"><button type="button" class="secondary" data-action="back-tx">돌아가기</button><button class="primary" type="submit">카테고리 추가</button></div></form>`);break;}
      case 'back-tx':transactionModal(editingTx,txType,txDraft);break;
    }
  } catch(error){const target=modal.open?$('#form-error'):null;if(target)target.textContent=error.message;else toast(error.message);el.disabled=false;}
});
document.addEventListener('submit',async e=>{
  e.preventDefault(); const form=e.target, b=Object.fromEntries(new FormData(form)), btn=form.querySelector('[type="submit"]'); if(!btn)return;
  btn.disabled=true;const err=form.querySelector('.error');if(err)err.textContent='';
  try {
    if(form.id==='export-form'){
      const response=await fetch('/api/export?year='+encodeURIComponent(b.year));
      if(!response.ok)throw new Error((await response.json()).error || '장부를 저장하지 못했습니다.');
      const url=URL.createObjectURL(await response.blob());
      const link=document.createElement('a');
      link.href=url;
      link.download='moneycheck-'+b.year+'.csv';
      link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      modal.close();
      toast('장부 파일 다운로드를 시작했습니다.');
    } else if(form.id==='auth-form'){
      if(b.confirm!==undefined&&b.password!==b.confirm)throw new Error('비밀번호가 서로 다릅니다.');
      const mode=form.dataset.mode;
      if(mode==='reset')b.token=new URLSearchParams(location.search).get('reset');
      const result=await api({login:'login',register:'register',forgot:'forgot',reset:'reset'}[mode],'POST',b);
      if(mode==='forgot'){err.className='success';err.textContent=result.message;return;}
      if(mode==='reset'){history.replaceState({},'', '/');authView('login');toast('비밀번호를 변경했습니다. 다시 로그인해 주세요.');return;}
      state.status=await api('status');await load();toast('머니체크에 오신 것을 환영합니다.');
    } else if(form.id==='tx-form') { b.amount=Number(b.amount); b.type=txType;await api(editingTx?'transactions/'+editingTx.id:'transactions',editingTx?'PATCH':'POST',b);modal.close();await load();toast('기록을 저장했습니다.'); }
    else if(form.id==='sub-form'){ b.amount=Number(b.amount);if(b.original_day)b.original_day=Number(b.original_day);await api(editingSub?'subscriptions/'+editingSub.id:'subscriptions',editingSub?'PATCH':'POST',b);modal.close();await load();toast('구독을 저장했습니다.'); }
    else if(form.id==='category-form'){await api('categories','POST',{type:txType,name:b.name});state.data=await api('data');transactionModal(editingTx,txType,{...txDraft,category:b.name.trim()});toast('카테고리를 추가했습니다.');}
  } catch(error){if(err)err.textContent=error.message;else toast(error.message);}
  finally{btn.disabled=false;}
});
document.addEventListener('change',e=>{
  if(e.target.name==='currency')updateCurrency();
  if(e.target.name==='next_date'){const field=$('#sub-form')?.elements.original_day;if(field&&e.target.value)field.value=Number(e.target.value.slice(-2));}
});
document.addEventListener('input',e=>{if(e.target.id==='search'){const cursor=e.target.selectionStart;state.search=e.target.value;render();$('#search').focus();$('#search').setSelectionRange(cursor,cursor);}});
modal.addEventListener('click',e=>{if(e.target===modal){const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)modal.close();}});
async function init(){app.innerHTML='<div class="loading">머니체크를 준비하고 있어요…</div>';try{state.status=await api('status');if(new URLSearchParams(location.search).has('reset')){authView('reset');return;}try{await load();}catch(e){if(e.message==='로그인이 필요합니다.')authView();else throw e;}}catch(e){app.innerHTML=`<div class="loading"><div>${esc(e.message)}<br><button class="secondary" data-action="retry">다시 시도</button></div></div>`;}}
document.addEventListener('click',e=>{if(e.target.closest('[data-action="retry"]'))init();});
init();
