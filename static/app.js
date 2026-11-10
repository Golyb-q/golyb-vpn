'use strict';
const $ = id => document.getElementById(id);
const frontendConfig=window.GOLYB_VPN_CONFIG || {};
const apiBase=String(frontendConfig.apiBaseUrl || '').replace(/\/$/,'');
const apiUrl=path=>apiBase?`${apiBase}${path}`:path;
const adminMode = /^\/admin\/?$/.test(location.pathname) || new URLSearchParams(location.search).get('mode')==='admin';
if(apiBase){
  const publicUrl=new URL(location.href);publicUrl.searchParams.delete('mode');publicUrl.hash='';
  const adminUrl=new URL(publicUrl);adminUrl.searchParams.set('mode','admin');
  $('public-link').href=publicUrl.href;$('admin-link').href=adminUrl.href;document.querySelector('.brand').href=publicUrl.href;
}
const readBase = adminMode ? '/api' : '/api/public';
let isAdmin = false, suggestionOffset = 0, suggestionTotal = 0;
$('public-link').classList.toggle('active', !adminMode);
$('admin-link').classList.toggle('active', adminMode);
$('sources-description').textContent = adminMode ? 'Добавляй источники напрямую или одобряй предложения пользователей.' : 'Предложи источник: сбор начнётся после одобрения администратором.';
$('source-form').querySelector('button').textContent = adminMode ? 'Добавить источники +' : 'Предложить источник +';
if(adminMode){
  const textarea=document.createElement('textarea');textarea.id='source-url';textarea.rows=6;textarea.required=true;textarea.placeholder='https://example.org/subscription\nhttps://example.net/proxies';textarea.spellcheck=false;
  $('source-url').replaceWith(textarea);
  $('source-input-label').textContent='Публичные подписки';
  $('source-input-help').hidden=false;
  $('source-input-help').textContent='Одна строка — один HTTP(S) URL. Пустые строки и повторы пропускаются.';
}

let token = sessionStorage.getItem('golyb_vpn-admin') || sessionStorage.getItem('golyb-admin') || '', proxyRows = [], stats = null, settings = {}, offset = 0, total = 0;
const subscriptionStorageKey=`golyb_vpn-subscription:${new URL(apiUrl('/'),location.href).href}`;
let savedSubscriptionToken='';
try{savedSubscriptionToken=sessionStorage.getItem(subscriptionStorageKey)||'';}catch{}
$('sub-token').value=savedSubscriptionToken;
function rememberSubscriptionToken(value){
  const next=value.trim();
  if(next!==savedSubscriptionToken){$('subscription-url').value='';$('subscription-preview').textContent='';}
  savedSubscriptionToken=next;$('sub-token').value=next;
  try{if(next)sessionStorage.setItem(subscriptionStorageKey,next);else sessionStorage.removeItem(subscriptionStorageKey);}catch{}
}
function forgetSubscriptionToken(used){if(savedSubscriptionToken===used)rememberSubscriptionToken('');}
$('sub-token').addEventListener('input',()=>rememberSubscriptionToken($('sub-token').value));
let proxyStatus='alive', proxySort='stability', proxyOrder='desc';
let appliedProxyFilters=[], proxyRequestId=0, applyingProxyFilters=false, proxySearchTimer;
const esc = value => String(value ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = (value, digits=1) => value == null ? '—' : Number(value).toFixed(digits);
const flag = code => code && code !== 'ZZ' ? [...code].map(c => String.fromCodePoint(c.charCodeAt(0)+127397)).join('') : '🌐';
function notice(message, kind='info') {
  const toast=document.createElement('div');
  toast.className=`toast toast-${kind}`;
  if(kind==='error')toast.setAttribute('role','alert');
  const icon=document.createElement('span');icon.className='toast-icon';icon.textContent=kind==='success'?'✓':kind==='error'?'!':'i';icon.setAttribute('aria-hidden','true');
  const text=document.createElement('span');text.className='toast-message';text.textContent=String(message);
  const close=document.createElement('button');close.type='button';close.className='toast-close';close.setAttribute('aria-label','Закрыть уведомление');close.textContent='×';
  toast.append(icon,text,close);
  const root=$('notice');
  while(root.children.length>=3)root.firstElementChild.remove();
  root.append(toast);
  let timer;
  const dismiss=()=>{clearTimeout(timer);toast.remove();};
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(dismiss,kind==='error'?9000:kind==='success'?4500:6000);};
  close.onclick=dismiss;
  toast.addEventListener('pointerenter',()=>clearTimeout(timer));
  toast.addEventListener('pointerleave',schedule);
  toast.addEventListener('focusin',()=>clearTimeout(timer));
  toast.addEventListener('focusout',event=>{if(!toast.contains(event.relatedTarget))schedule();});
  schedule();
}
async function request(url, options={}) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Number(frontendConfig.requestTimeoutMs)||15000);
  try{const response=await fetch(url,{...options,signal:controller.signal});const body=[204,205,304].includes(response.status)?null:await response.arrayBuffer();return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});}
  catch(error){if(error.name==='AbortError')throw new Error('Сервер долго не отвечает. Попробуй позже.');throw new Error('Не удалось связаться с сервером.');}
  finally{clearTimeout(timer);}
}
async function api(path, options={}) {
  const response = await request(apiUrl(path), {...options, headers:{...(adminMode && token ? {Authorization:`Bearer ${token}`} : {}), ...(options.body?{'Content-Type':'application/json'}:{}), ...options.headers}});
  if (response.status === 401) { if (adminMode) logout(); throw new Error('Нужен действующий токен администратора'); }
  if (!response.ok) { let body = await response.json(); throw new Error(typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)); }
  return response.status === 204 ? null : response.json();
}
function showWorkspace(){
  isAdmin=adminMode && Boolean(token);
  document.querySelectorAll('[data-admin]').forEach(el=>{if(!el.classList.contains('page'))el.hidden=!isAdmin;});
  $('login').hidden=true;$('workspace').hidden=false;
}
function showLogin() { isAdmin=false; navigate('dashboard'); document.querySelectorAll('[data-admin]').forEach(el=>el.hidden=true); $('created-token').value=''; $('login').hidden=false; $('workspace').hidden=true; $('connection').textContent='Вход в панель'; }
function navigate(page) { if (['settings','moderation','tokens'].includes(page) && !isAdmin) return; if(page !== 'tokens') { $('created-token').value=''; $('created-token-panel').hidden=true; } document.querySelectorAll('.page').forEach(el => el.hidden = el.id !== page); document.querySelectorAll('nav button').forEach(el => el.classList.toggle('selected',el.dataset.page === page)); if(page==='proxies')loadProxies().catch(error=>notice(error.message,'error')); if(page==='statistics')loadStatistics().catch(error=>notice(error.message,'error')); if(page==='moderation')loadSuggestions(); if(page==='tokens')loadTokens(); }
document.querySelectorAll('[data-page]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.page)));
function chart(id, checks) {
  const root = $(id); root.replaceChildren();
  if (!checks.length) { root.innerHTML='<div class="empty">Проверок пока нет. Добавь первый источник.</div>'; return; }
  const max = Math.max(1,...checks.map(c => c.latency_ms || 0));
  [...checks].reverse().forEach(c => {const bar = document.createElement('div');bar.className=`bar ${c.success ? '' : 'failed'}`;bar.style.height=`${c.success ? Math.max(8,(c.latency_ms||0)/max*100) : 8}%`;bar.title=`${c.success ? 'Успех' : 'Неуспех'} · ${number(c.latency_ms,0)} ms · ${number(c.speed_mb_s)} MB/s`; root.append(bar);});
}
const manualProxyTests=new Set();
function serverAddress(row){const host=row.server_host;if(!host)return '—';return `${host.includes(':')?'['+host+']':host}:${row.server_port}`;}
function proxyTable(rows, manual=false) {
  if (!rows.length && !manual) return '<div class="empty">Подключений пока нет</div>';
  const columns=[['country','ЛОКАЦИЯ / АДРЕСА'],['protocol','ПРОТОКОЛ'],['speed','СКОРОСТЬ'],['latency','ЗАДЕРЖКА'],['stability','STABILITY'],['uptime100','UPTIME'],['lives','ЖИЗНИ']];
  const headers=columns.map(([key,label])=>{
    if(!manual)return `<th scope="col">${label}</th>`;
    const active=proxySort===key, direction=active?(proxyOrder==='asc'?'ascending':'descending'):'none';
    return `<th scope="col" aria-sort="${direction}"><button type="button" class="column-sort${active?' active':''}" data-proxy-sort="${key}" title="Сортировать; повторное нажатие меняет порядок">${label}<span aria-hidden="true">${active?(proxyOrder==='asc'?'↑':'↓'):'↕'}</span></button></th>`;
  }).join('');
  return `<table><thead><tr>${headers}<th scope="col"></th></tr></thead><tbody>${rows.map(r => `<tr><td><div class="country"><b>${esc(flag(r.countryCode))}</b><div>${esc(r.country)}<small>Сервер: ${esc(serverAddress(r))}</small><small>Выход: ${esc(r.exit_ip)}</small></div></div></td><td><span class="pill">${esc(r.protocol.toUpperCase())}</span></td><td>${number(r.speed)} <span class="muted">MB/s</span></td><td>${number(r.latency,0)} <span class="muted">ms</span></td><td>${esc(r.stability)}</td><td>${number(r.uptime100)}%</td><td class="${r.lives ? '' : 'dead'}">${'●'.repeat(r.lives)}${'○'.repeat(3-r.lives)}</td><td><div class="proxy-actions">${isAdmin&&manual?`<button data-proxy-test="${r.id}" ${manualProxyTests.has(r.id)?'disabled aria-busy="true"':''} aria-label="Тест URL и скорости прокси ${r.id}" title="Проверить URL и скорость; успешная проверка восстанавливает 3 жизни">${manualProxyTests.has(r.id)?'Проверяется…':'Тест'}</button>`:''}<button data-history="${r.id}">История ↗</button><button class="qr-button" data-proxy-qr="${r.id}" title="QR-код и строка подключения" aria-label="QR-код и конфигурация прокси ${r.id}">QR</button></div></td></tr>`).join('')}</tbody></table>${!rows.length?'<div class="empty">Совпадений нет. Проверь поиск, фильтры и выбранный статус прокси.</div>':''}`;
}
function drawProxies() {
  $('proxies-table').innerHTML=proxyTable(proxyRows,true);
  $('proxy-page').textContent=`${total ? offset+1 : 0}–${Math.min(offset+200,total)} из ${total}`;
  $('prev-proxies').disabled=offset===0; $('next-proxies').disabled=offset+200>=total;
  $('proxy-filter-status').textContent=appliedProxyFilters.length?`Применено условий: ${appliedProxyFilters.length}`:'Без дополнительных условий';
}
async function loadProxies({filters=appliedProxyFilters,pageOffset=offset,commit=false}={}) {
  const request=++proxyRequestId;
  const query=new URLSearchParams({offset:String(pageOffset),limit:'200',search:$('proxy-search').value,orderBy:proxySort,order:proxyOrder,includeDead:String(proxyStatus!=='alive')});
  filters.forEach(filter=>query.append('filter',filter));
  if(proxyStatus==='dead')query.append('filter','(lives==0)');
  const result=await api(`${readBase}/proxies?${query}`);
  if(request!==proxyRequestId)return;
  if(result.total && pageOffset>=result.total)return loadProxies({filters,pageOffset:Math.floor((result.total-1)/200)*200,commit});
  proxyRows=result.items;total=result.total;offset=total?pageOffset:0;
  if(commit)appliedProxyFilters=[...filters];
  drawProxies();
}
async function applyProxyFilters(filters) {
  if(applyingProxyFilters)return;
  clearTimeout(proxySearchTimer);applyingProxyFilters=true;
  const controls=[...document.querySelectorAll('#proxy-filter-form button, #proxy-filter-form textarea'),$('proxy-search'),...document.querySelectorAll('#proxies-table [data-proxy-sort]'),...document.querySelectorAll('[data-proxy-status]'),$('prev-proxies'),$('next-proxies')];
  controls.forEach(el=>el.disabled=true);
  try{await loadProxies({filters,pageOffset:0,commit:true});}
  catch(error){notice(error.message,'error');}
  finally{applyingProxyFilters=false;controls.forEach(el=>el.disabled=false);drawProxies();}
}
$('proxy-filter-form').onsubmit=event=>{event.preventDefault();applyProxyFilters($('proxy-filters').value.split('\n').map(value=>value.trim()).filter(Boolean));};
$('reset-proxy-filters').onclick=()=>{$('proxy-filters').value='';applyProxyFilters([]);};
let refreshInFlight=null, apiHadError=false;
function renderStats(s){
  stats=s;
    $('alive').textContent=s.alive; $('fast').textContent=s.fast;$('source-count').textContent=s.sources;$('source-total').textContent=`из ${s.total_sources} сохранённых`;$('pending').textContent=s.pending;
    $('alive-changes').textContent=`За час: +${s.added_last_hour||0} новых · −${s.died_last_hour||0} умерло`;
    chart('pulse',s.recent_checks);
    $('discovery-policy').textContent=`Цель Discovery: ${s.target_matching} / ${s.discovery_policy.target_count} · ${s.discovery_policy.filters.join(' AND ') || 'Все живые прокси'}`;
    if(isAdmin) document.querySelector('nav [data-page=moderation] span').textContent=`Предложения (${s.pending_suggestions})`;
    const reason={technical:'Техническая пауза',manual:'Ручная пауза',discovery_target:'Цель достигнута'};
    const healthError=s.diagnostics?.health_error || '';
    const healthReason=healthError.startsWith('ip_endpoints_unreachable') ? `Недоступны сервисы проверки IP (${healthError.split(': ').slice(1).join(': ')})` : healthError.startsWith('sing_box_') ? `Не отвечает sing-box (${healthError})` : 'Проверяем доступность';
    const stageNames={starting:'старт',dns:'DNS',tcp:'TCP',engine_wait:'ожидают движок',engine:'запуск движка',url:'URL',speed:'скорость',health:'диагностика',database:'запись в БД'};
    $('worker-status').innerHTML=['discovery','monitoring'].map(scope=>{
      const metric=s.throughput?.[scope] || {},paused=s.pauses[scope].length>0;
      const stages=Object.entries(metric.stages||{}).map(([name,count])=>`${stageNames[name]||name}: ${count}`).join(' · ');
      const status=!s.workers_enabled?'Отключён':s.pauses[scope].map(item=>reason[item]).join(', ') || `Активно: ${s.active[scope]}`;
      const average=metric.avg_duration_seconds==null?'Пока нет завершённых проверок':`Средняя цепочка: ${number(metric.avg_duration_seconds)} с; диагностика: ${number(metric.avg_stage_seconds?.health || 0)} с; запись: ${number(metric.avg_stage_seconds?.database || 0)} с`;
      return `<article class="worker-card" data-worker-scope="${scope}"><div class="worker-card-heading"><h3>${scope==='discovery'?'Discovery / поиск':'Monitoring / проверка'}</h3><div class="worker-rate" title="Завершённые проверки за последние 60 секунд, при старте — за доступное время. В час — пересчёт минутного темпа."><strong data-rate="${scope}">${number(metric.per_minute||0)} <small>/мин</small></strong><span>≈ ${Math.round(metric.per_hour||0).toLocaleString()} /ч</span></div></div><p class="worker-state ${paused?'paused':''}">${esc(status)}</p><p class="worker-progress" title="${esc(average)}">Завершено с запуска: ${metric.completed||0} · Успех: ${metric.success||0} · Отказ: ${metric.failed||0} · Повтор: ${metric.retries||0}</p><p class="worker-stages">${esc(stages||'Нет активных проверок')}</p></article>`;
    }).join('')+`<div class="worker">Health / инфраструктура<span class="${s.pauses.monitoring.includes('technical')?'paused':''}">${s.pauses.monitoring.includes('technical')?esc(healthReason):'Доступна'}</span></div><div class="worker">sing-box / GeoIP<span>${s.engine_available?'✓':'✗'} / ${s.geoip_available?'✓':'✗'}</span></div><div class="worker">Движки sing-box<span>${s.diagnostics?.active_engines||0} / ${s.diagnostics?.engine_limit||'—'}</span></div>`;
  $('updated').textContent=`ОБНОВЛЕНО ${new Date().toLocaleTimeString()}`;
}
function renderSources(sources){
    $('sources-table').innerHTML=sources.length?`<table><thead><tr><th>ПРИОРИТЕТ</th><th>ИСТОЧНИК</th><th>ЖИЗНИ</th><th>КОНФИГИ / НОВЫЕ</th><th>СОСТАВ МЕНЯЛСЯ</th><th>ПОСЛЕДНЯЯ ОШИБКА</th><th></th></tr></thead><tbody>${sources.map(r=>`<tr><td>${r.priority}</td><td><div class="source-address" title="${esc(r.url || r.label)}">${esc(r.url || r.label)}</div><small class="muted">${r.last_checked_at?new Date(r.last_checked_at*1000).toLocaleString():'Ожидает сбора'}</small></td><td class="${r.lives?'':'dead'}">${'●'.repeat(r.lives)}${'○'.repeat(3-r.lives)}</td><td>${r.total_configs} / ${r.unique_configs}</td><td>${r.last_changed_at?esc(new Date(r.last_changed_at*1000).toLocaleString()):'Ещё нет данных'}<small class="muted">${r.last_changed_at?Math.max(0,Math.floor((Date.now()/1000-r.last_changed_at)/86400))+' дн. без изменений':''}</small></td><td>${esc(r.last_error==='unchanged_for_7_days'?'Состав не менялся 7 дней':r.last_error || '—')}</td><td>${isAdmin ? `<button data-restore="${r.id}">Восстановить</button><button data-priority="${r.id}" data-current="${r.priority}">Приоритет</button><button data-disable="${r.id}">Отключить</button>` : ''}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">Активных источников пока нет. Предложи подписку через форму выше.</div>';
}
function historyGraph(id, rows, series, bars=false){
  const root=$(id),width=960,height=260,left=52,right=18,top=16,bottom=35;
  const plotWidth=width-left-right,plotHeight=height-top-bottom,step=plotWidth/rows.length;
  const values=rows.flatMap(row=>series.map(item=>row[item.key])).filter(value=>value!=null);
  const ceiling=Math.max(4,Math.ceil(Math.max(0,...values)/4)*4);
  const y=value=>top+plotHeight*(1-value/ceiling),x=index=>left+step*(index+.5);
  let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${bars?'Новые и умершие прокси за сутки':'Живые и быстрые прокси за сутки'}">`;
  for(let i=0;i<=4;i++){const value=ceiling*i/4;svg+=`<line x1="${left}" x2="${width-right}" y1="${y(value)}" y2="${y(value)}" class="statistics-gridline"/><text x="${left-8}" y="${y(value)+4}" text-anchor="end">${value}</text>`;}
  rows.forEach((row,index)=>{
    if(series.every(item=>row[item.key]==null))svg+=`<rect x="${left+step*index}" y="${top}" width="${step}" height="${plotHeight}" class="statistics-unknown"/>`;
    if(index%8===0||index===rows.length-1)svg+=`<text x="${x(index)}" y="${height-10}" text-anchor="middle">${esc(new Date(row.start*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))}</text>`;
  });
  series.forEach((item,seriesIndex)=>{
    if(bars){rows.forEach((row,index)=>{const value=row[item.key];if(value!=null)svg+=`<rect x="${left+step*index+step*.1+seriesIndex*step*.4}" y="${y(value)}" width="${step*.35}" height="${top+plotHeight-y(value)}" fill="${item.color}"/>`;});}
    else{let path='';rows.forEach((row,index)=>{if(row[item.key]==null){path+=' ';return;}const previous=index>0&&rows[index-1][item.key]!=null;path+=`${previous?'L':'M'}${x(index)},${y(row[item.key])} `;});svg+=`<path d="${path}" fill="none" stroke="${item.color}" stroke-width="2"/>`;rows.forEach((row,index)=>{if(row[item.key]!=null)svg+=`<circle cx="${x(index)}" cy="${y(row[item.key])}" r="2.3" fill="${item.color}"/>`;});}
  });
  rows.forEach((row,index)=>{
    const title=[new Date(row.start*1000).toLocaleString(),...series.map(item=>`${item.label}: ${row[item.key]??'нет данных'}`),row.partial?'Неполный интервал':''].filter(Boolean).join(' · ');
    svg+=`<rect x="${left+step*index}" y="${top}" width="${step}" height="${plotHeight}" fill="transparent"><title>${esc(title)}</title></rect>`;
  });
  root.innerHTML=svg+'</svg>';
}
let statisticsRequest=null;
async function loadStatistics(){
  if(statisticsRequest)return statisticsRequest;
  statisticsRequest=(async()=>{
    const result=await api(`${readBase}/statistics`),rows=result.buckets;
    historyGraph('statistics-events',rows,[{key:'added',label:'Новые',color:'#c1f77b'},{key:'died',label:'Умершие',color:'#ed8e91'}],true);
    historyGraph('statistics-counts',rows,[{key:'alive',label:'Живые',color:'#c1f77b'},{key:'fast',label:'Быстрые',color:'#8dbcf3'}]);
    $('statistics-coverage').textContent=`История накапливается с ${new Date(result.started_at*1000).toLocaleString()}. Время показано в часовом поясе браузера. Текущий интервал ещё не завершён.`;
    $('statistics-table').innerHTML=`<table><thead><tr><th>ИНТЕРВАЛ</th><th>НОВЫЕ</th><th>УМЕРШИЕ</th><th>ЖИВЫЕ</th><th>БЫСТРЫЕ</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(new Date(row.start*1000).toLocaleString())}${row.partial?' *':''}</td>${['added','died','alive','fast'].map(key=>`<td>${row[key]??'—'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  })();
  try{await statisticsRequest;}finally{statisticsRequest=null;}
}

async function refreshSections(){
  if(adminMode && !token)return showLogin();
  const jobs=[
    api(`${readBase}/stats`).then(renderStats),
    api(`${readBase}/sources`).then(renderSources),
    api(`${readBase}/proxies?limit=5&includeDead=false&orderBy=stability&order=desc`).then(top=>{$('top-proxies').innerHTML=proxyTable(top.items);})
  ];
  if(!$('proxies').hidden && !applyingProxyFilters)jobs.push(loadProxies());
  if(!$('statistics').hidden)jobs.push(loadStatistics());
  const outcomes=await Promise.allSettled(jobs), failed=outcomes.filter(result=>result.status==='rejected').length;
  if(adminMode && !token)return;
  $('connection').classList.toggle('connection-warning',Boolean(failed));
  $('connection').textContent=failed?(failed===outcomes.length?'API недоступен · интерфейс работает':'Данные обновлены частично'):'● УЗЕЛ ПОДКЛЮЧЁН';
  if(failed && !apiHadError)notice('Не все данные доступны. Интерфейс работает; повторим обновление автоматически.');
  apiHadError=Boolean(failed);
  if(isAdmin && !$('moderation').hidden)loadSuggestions();
  if(isAdmin && !$('tokens').hidden)loadTokens();
}
async function refresh(){
  if(refreshInFlight)return refreshInFlight;
  refreshInFlight=refreshSections();
  try{await refreshInFlight;}finally{refreshInFlight=null;}
}
$('login-form').onsubmit=async e=>{e.preventDefault();token=$('admin-token').value.trim();sessionStorage.setItem('golyb_vpn-admin',token);sessionStorage.removeItem('golyb-admin');$('notice').replaceChildren();showWorkspace();await Promise.allSettled([refresh(),loadSettings()]);};
function logout(){sessionStorage.removeItem('golyb_vpn-admin');sessionStorage.removeItem('golyb-admin');token='';$('admin-token').value='';$('created-token').value='';showLogin();} $('logout').onclick=logout;$('logout-mobile').onclick=logout;
$('source-form').onsubmit=async event=>{
  event.preventDefault();
  const form=$('source-form'), input=$('source-url'), button=form.querySelector('button');
  if(button.disabled)return;
  if(!adminMode){
    button.disabled=true;
    try{
      const result=await api('/api/source-suggestions',{method:'POST',body:JSON.stringify({url:input.value.trim()})});
      input.value='';
      notice(result.status==='known'?'Источник уже известен системе':result.status==='rejected'?'Этот источник уже рассмотрен и отклонён':result.status==='approved'?'Этот источник уже одобрен':'Предложение отправлено на рассмотрение');
      await refresh();
    }catch(error){notice(error.message,'error');}finally{button.disabled=false;}
    return;
  }
  const lines=input.value.split(/\r?\n/).map((value,index)=>({url:value.trim(),line:index+1})).filter(item=>item.url);
  if(!lines.length){notice('Вставь хотя бы один URL источника.');return;}
  const seen=new Set(), unique=lines.filter(item=>{if(seen.has(item.url))return false;seen.add(item.url);return true;});
  let added=0,known=0;
  const errors=[],remaining=[];
  button.disabled=true;input.disabled=true;form.setAttribute('aria-busy','true');
  $('source-batch-report').hidden=true;$('source-batch-errors').replaceChildren();
  try{
    for(let index=0;index<unique.length;index++){
      const item=unique[index];button.textContent=`Добавление ${index+1} / ${unique.length}…`;
      try{
        let parsed;
        try{parsed=new URL(item.url);}catch{throw new Error('Нужен полный HTTP(S) URL.');}
        if(!['http:','https:'].includes(parsed.protocol))throw new Error('Допускаются только HTTP(S) URL.');
        const result=await api('/api/sources',{method:'POST',body:JSON.stringify({url:item.url})});
        if(result.created)added++;else known++;
      }catch(error){
        errors.push({line:item.line,url:item.url,message:error.message});remaining.push(item.url);
        if(!isAdmin){remaining.push(...unique.slice(index+1).map(row=>row.url));break;}
      }
    }
    input.value=remaining.join('\n');
    for(const error of errors){const li=document.createElement('li');li.textContent=`Строка ${error.line}: ${error.url} — ${error.message}`;$('source-batch-errors').append(li);}
    $('source-batch-report').hidden=!errors.length;
    notice(`Добавлено: ${added}. Уже известны: ${known}. Повторы: ${lines.length-unique.length}. Ошибок: ${errors.length}.${errors.length?' В поле оставлены недобавленные источники.':''}`,errors.length?(added||known?'info':'error'):'success');
    if(isAdmin)await refresh();
  }finally{button.disabled=false;input.disabled=false;button.textContent='Добавить источники +';form.removeAttribute('aria-busy');}
};
async function pause(scope,paused){try{await api('/api/pause',{method:'POST',body:JSON.stringify({scope,paused})});await refresh();}catch(e){notice(e.message,'error');}}
$('pause-all').onclick=()=>pause('all',true);$('resume-all').onclick=()=>pause('all',false);$('pause-discovery').onclick=()=>pause('discovery',true);$('resume-discovery').onclick=()=>pause('discovery',false);
$('proxy-search').addEventListener('input',()=>{clearTimeout(proxySearchTimer);proxySearchTimer=setTimeout(()=>loadProxies({pageOffset:0}).catch(error=>notice(error.message,'error')),300);});
$('proxies-table').addEventListener('click',async event=>{
  const button=event.target.closest('[data-proxy-sort]');
  if(!button||applyingProxyFilters)return;
  const key=button.dataset.proxySort;
  proxyOrder=key===proxySort?(proxyOrder==='desc'?'asc':'desc'):['country','protocol','latency'].includes(key)?'asc':'desc';
  proxySort=key;
  try{
    await loadProxies({pageOffset:0});
    $('proxies-table').querySelector(`[data-proxy-sort="${key}"]`)?.focus({preventScroll:true});
  }catch(error){notice(error.message,'error');}
});
document.querySelectorAll('[data-proxy-status]').forEach(button=>button.addEventListener('click',()=>{
  proxyStatus=button.dataset.proxyStatus;
  document.querySelectorAll('[data-proxy-status]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  loadProxies({pageOffset:0}).catch(error=>notice(error.message,'error'));
}));
$('prev-proxies').onclick=()=>loadProxies({pageOffset:Math.max(0,offset-200)}).catch(error=>notice(error.message,'error'));
$('next-proxies').onclick=()=>loadProxies({pageOffset:offset+200}).catch(error=>notice(error.message,'error'));
document.addEventListener('click',async e=>{const h=e.target.closest('[data-history]'),r=e.target.closest('[data-restore]');try{if(h){const checks=await api(`${readBase}/proxies/${h.dataset.history}/checks`);$('history-panel').hidden=false;$('history-title').textContent=`Прокси #${h.dataset.history} · последние ${checks.length} проверок`;chart('history-chart',checks);$('history-table').innerHTML=`<table><thead><tr><th>ВРЕМЯ</th><th>РЕЗУЛЬТАТ</th><th>ЗАДЕРЖКА</th><th>СКОРОСТЬ</th></tr></thead><tbody>${checks.map(c=>`<tr><td>${esc(new Date(c.checked_at*1000).toLocaleString())}</td><td>${c.success?'✓':'✗ '+esc(c.error_type)}</td><td>${number(c.latency_ms,0)} ms</td><td>${number(c.speed_mb_s)} MB/s</td></tr>`).join('')}</tbody></table>`;navigate('proxies');$('history-panel').scrollIntoView({behavior:'smooth'});}if(r){await api(`/api/sources/${r.dataset.restore}`,{method:'PATCH',body:JSON.stringify({lives:3})});refresh();}}catch(e){notice(e.message,'error');}});
async function testProxy(id){
  if(!isAdmin||manualProxyTests.has(id))return;
  manualProxyTests.add(id);drawProxies();
  try{
    let job=await api(`/api/proxies/${id}/test`,{method:'POST'});
    const deadline=Date.now()+(job.timeout_seconds+20)*1000;
    while(job.state==='running'){
      if(Date.now()>deadline)throw new Error('Проверка ещё не завершилась. Результат появится в истории прокси.');
      await new Promise(resolve=>setTimeout(resolve,1000));
      if(!isAdmin)return;
      job=await api(`/api/proxies/${id}/test`);
    }
    if(job.state==='error')throw new Error(job.message);
    const result=job.result;
    if(!result.recorded)notice(`Прокси #${id}: технический сбой, жизни сохранены`);
    else if(result.success)notice(`Прокси #${id}: URL работает · ${result.speed==null?'Скорость не измерена':number(result.speed)+' МБ/с'} · 3 жизни`,'success');
    else notice(`Прокси #${id}: URL-проверка не пройдена`,'error');
    await Promise.allSettled([loadProxies(),refresh()]);
  }catch(error){notice(error.message,'error');}
  finally{manualProxyTests.delete(id);drawProxies();}
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-proxy-test]');if(button)testProxy(Number(button.dataset.proxyTest));});
$('close-history').onclick=()=>$('history-panel').hidden=true;
$('happ-filters').onclick=()=>{
  const lines=$('filters').value.split('\n').map(line=>line.trim()).filter(Boolean);
  for(const condition of ['(encrypted==true)','(cipher!=aes-256-cfb)'])if(!lines.includes(condition))lines.push(condition);
  $('filters').value=lines.join('\n');
  notice('Фильтры по указанным ограничениям Happ добавлены');
};
$('proxy-import-form').onsubmit=async event=>{
  event.preventDefault();if(!isAdmin)return;
  const button=$('proxy-import-submit'),input=$('proxy-import-uri');button.disabled=true;input.disabled=true;button.textContent='Проверяем…';
  try{
    let job=await api('/api/proxies/import',{method:'POST',body:JSON.stringify({uri:input.value.trim()})});
    while(job.state==='running'){await new Promise(resolve=>setTimeout(resolve,1000));job=await api(`/api/proxy-imports/${job.id}`);}
    if(job.state==='error')throw new Error(job.message);
    if(!job.result.recorded)throw new Error('Результат не сохранён: технический сбой или запись удалена во время проверки');
    if(!job.result.success)throw new Error('URL-тест не пройден. Конфиг не добавлен.');
    notice(`Прокси #${job.proxy_id} сохранён · ${job.result.speed==null?'Скорость не измерена':number(job.result.speed)+' МБ/с'}`,'success');input.value='';
    await Promise.allSettled([loadProxies({pageOffset:0}),refresh()]);
  }catch(error){notice(error.message,'error');}
  finally{button.disabled=false;input.disabled=false;button.textContent='Проверить и добавить';}
};
$('builder-form').onsubmit=e=>{e.preventDefault();rememberSubscriptionToken($('sub-token').value);const u=new URL(apiUrl('/subscription'),location.href);u.searchParams.set('token',$('sub-token').value);for(const [id,key] of [['order-by','orderBy'],['order','order'],['limit','limit'],['format','format'],['name-template','name']])u.searchParams.set(key,$(id).value);u.searchParams.set('uniqueCountry',$('unique-country').checked);$('filters').value.split('\n').map(v=>v.trim()).filter(Boolean).forEach(f=>u.searchParams.append('filter',f));$('subscription-url').value=u.toString();};
$('copy-url').onclick=async()=>{try{await navigator.clipboard.writeText($('subscription-url').value);notice('Ссылка скопирована','success');}catch(e){notice('Выдели ссылку и скопируй вручную');}};
$('preview-sub').onclick=async()=>{
  const url=$('subscription-url').value;if(!url)return;
  const usedToken=new URL(url).searchParams.get('token')||'';
  try{const response=await request(url),text=await response.text();
    if(!response.ok){$('subscription-preview').textContent='';if(response.status===401)forgetSubscriptionToken(usedToken);throw new Error(response.status===401?'Токен подписки недействителен или удалён':text);}
    $('subscription-preview').textContent=text;
  }catch(error){notice(error.message,'error');}
};
const settingGroups = {
  discovery: [
    ['discovery_concurrency', 'Параллельных проверок Discovery', 'Максимум одновременно проверяемых кандидатов.'],
    ['dead_retry_delay', 'Повторная проверка мёртвых, с', 'После этой паузы ранее работавшие прокси получают повторный URL + speed тест в Discovery.'],
    ['collection_delay', 'Пауза между сборами, с', 'После полного завершения текущей очереди.']
  ],
  'discovery-target': [
    ['target_count', 'Приостановить при количестве', 'Число живых прокси, подходящих под фильтр ниже.'],
    ['resume_below', 'Возобновить ниже количества', 'Должно быть не больше порога приостановки.'],
    ['speed_max_age', 'Актуальность скорости, с', 'Для фильтров по скорости: максимальный возраст измерения.']
  ],
  monitoring: [
    ['monitoring_concurrency', 'Параллельных проверок Monitoring', 'Новый лимит применяется в текущем обходе.'],
    ['monitoring_delay', 'Интервал мониторинга, с', 'Через сколько секунд прокси снова подлежит проверке.']
  ],
  sources: [
    ['collection_concurrency', 'Параллельных загрузок', 'Количество одновременно скачиваемых источников.'],
    ['source_timeout', 'Тайм-аут загрузки, с', 'Предельное время скачивания одного источника.'],
    ['source_max_bytes', 'Максимальный размер подписки, байт', 'Лимит загружаемого содержимого одного источника.'],
    ['source_max_configs', 'Максимум конфигураций', 'Количество уникальных конфигов из одного источника.'],
    ['max_sources', 'Максимум источников', 'Ограничение числа сохранённых источников.']
  ],
  connection: [
    ['tcp_timeout', 'Тайм-аут TCP, с', 'Только первоначальная проверка TCP-кандидатов.'],
    ['url_timeout', 'Тайм-аут URL, с', 'Для каждого сервиса проверки выхода через прокси.']
  ],
  speed: [
    ['speed_timeout', 'Тайм-аут измерения, с', 'Предельная длительность одной тестовой загрузки.'],
    ['speed_bytes', 'Размер тестовой загрузки, байт', 'Больший размер увеличивает расход трафика.'],
    ['speed_url', 'Адрес тестовой загрузки', 'HTTP(S) URL, отдающий достаточно данных для измерения.'],
    ['min_speed', 'Быстрый прокси в статистике, МБ/с', 'Порог карточки «Быстрые подключения»; фильтр Discovery задаётся отдельно.']
  ],
  health: [
    ['health_interval', 'Интервал диагностики, с', 'Как часто проверять доступность тестовой инфраструктуры.'],
    ['max_engine_processes', 'Одновременно работающих sing-box', 'Общий лимит тяжёлых URL-проверок обоих циклов; TCP-проверки идут отдельно.']
  ]
};
const integerSettings = new Set(['max_engine_processes','discovery_concurrency','monitoring_concurrency','collection_concurrency','target_count','resume_below','source_max_bytes','source_max_configs','max_sources','speed_bytes']);
function selectSettingsTab(key, focus=false) {
  document.querySelectorAll('[data-settings-tab]').forEach(el=>{const selected=el.dataset.settingsTab===key;el.setAttribute('aria-selected',String(selected));el.tabIndex=selected?0:-1;if(selected&&focus)el.focus();});
  document.querySelectorAll('[data-settings-panel]').forEach(el=>el.hidden=el.dataset.settingsPanel!==key);
}
document.querySelectorAll('[data-settings-tab]').forEach(el=>{
  el.addEventListener('click',()=>selectSettingsTab(el.dataset.settingsTab));
  el.addEventListener('keydown',event=>{
    const tabs=[...document.querySelectorAll('[data-settings-tab]')],index=tabs.indexOf(el);
    const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
    if(next!==null){event.preventDefault();selectSettingsTab(tabs[next].dataset.settingsTab,true);}
  });
});
async function loadSettings(){
  if(!adminMode || !token)return;
  try{
    settings=await api('/api/settings');
    for(const [group,entries] of Object.entries(settingGroups)){
      document.querySelector(`[data-settings-fields="${group}"]`).innerHTML=entries.map(([key,label,help])=>{
        const numeric=typeof settings[key]==='number',min=key==='min_speed'?0:integerSettings.has(key)?1:0.01;
        return `<label>${esc(label)}<input data-setting="${key}" type="${numeric?'number':'url'}" ${numeric?`min="${min}" step="${integerSettings.has(key)?1:'any'}"`:''} value="${esc(settings[key])}" required><small class="field-help">${esc(help)}</small></label>`;
      }).join('');
    }
    $('discovery-filters').value=(settings.discovery_filters ?? [`(speed>=${settings.min_speed})`]).join('\n');
    $('ip-endpoints').value=settings.ip_endpoints.join('\n');
  }catch(e){notice(e.message,'error');}
}
$('settings-form').addEventListener('invalid',event=>{const panel=event.target.closest('[data-settings-panel]');if(panel)selectSettingsTab(panel.dataset.settingsPanel);},true);
$('settings-form').onsubmit=async e=>{e.preventDefault();const body={};document.querySelectorAll('[data-setting]').forEach(el=>body[el.dataset.setting]=el.type==='number'?Number(el.value):el.value);body.discovery_filters=$('discovery-filters').value.split('\n').map(v=>v.trim()).filter(Boolean);body.ip_endpoints=$('ip-endpoints').value.split('\n').map(v=>v.trim()).filter(Boolean);try{await api('/api/settings',{method:'PATCH',body:JSON.stringify(body)});notice('Настройки сохранены','success');await refresh();}catch(e){notice(e.message,'error');}};
if(adminMode && !token)showLogin();else showWorkspace();
loadSettings();
async function poll(){await refresh();setTimeout(poll,5000);}
poll();

async function loadSuggestions(){
  if(!isAdmin)return;
  try{
    const data=await api(`/api/source-suggestions?status=${$('suggestion-status').value}&offset=${suggestionOffset}&limit=100`);
    suggestionTotal=data.total;
    const labels={pending:'На рассмотрении',approved:'Одобрено',rejected:'Отклонено'};
    $('suggestions-table').innerHTML=data.items.length?`<table><thead><tr><th>ПОДПИСКА</th><th>ПРЕДЛОЖЕНА</th><th>СТАТУС</th><th>РЕШЕНИЕ</th></tr></thead><tbody>${data.items.map(r=>`<tr><td class="suggestion-address">${esc(r.url)}</td><td>${esc(new Date(r.submitted_at*1000).toLocaleString())}</td><td>${labels[r.status]}</td><td>${r.status==='pending'?`<button data-review="${r.id}" data-decision="approved">Принять</button> <button data-review="${r.id}" data-decision="rejected">Отклонить</button>`:'—'}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">Здесь пока нет предложений</div>';
    $('suggestion-page').textContent=`${data.total?suggestionOffset+1:0}–${Math.min(suggestionOffset+100,data.total)} из ${data.total}`;
    $('prev-suggestions').disabled=suggestionOffset===0;$('next-suggestions').disabled=suggestionOffset+100>=data.total;
  }catch(e){notice(e.message,'error');}
}
$('suggestion-status').onchange=()=>{suggestionOffset=0;loadSuggestions();};
$('prev-suggestions').onclick=()=>{suggestionOffset=Math.max(0,suggestionOffset-100);loadSuggestions();};
$('next-suggestions').onclick=()=>{suggestionOffset+=100;loadSuggestions();};
async function loadTokens(){
  if(!isAdmin)return;
  try{
    const rows=await api('/api/tokens');
    $('tokens-table').innerHTML=rows.length?`<table><thead><tr><th>НАЗВАНИЕ</th><th>ПРЕФИКС</th><th>СОЗДАН</th><th>ИСПОЛЬЗОВАН</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td class="token-label">${esc(r.name)}</td><td><code>${esc(r.prefix)}…</code></td><td>${esc(new Date(r.created_at*1000).toLocaleString())}</td><td>${r.last_used_at?esc(new Date(r.last_used_at*1000).toLocaleString()):'—'}</td><td><button data-delete-token="${r.id}">Удалить</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty">Создай первый токен для подписки</div>';
  }catch(e){notice(e.message,'error');}
}
$('token-form').onsubmit=async e=>{
  e.preventDefault();
  try{const row=await api('/api/tokens',{method:'POST',body:JSON.stringify({name:$('token-name').value.trim()})});$('created-token').value=row.token;$('created-token-panel').hidden=false;$('token-name').value='';await loadTokens();}catch(e){notice(e.message,'error');}
};
$('copy-token').onclick=async()=>{try{await navigator.clipboard.writeText($('created-token').value);notice('Токен скопирован','success');}catch(e){notice('Выдели токен и скопируй вручную');}};
$('hide-token').onclick=()=>{$('created-token').value='';$('created-token-panel').hidden=true;};
document.addEventListener('click',async e=>{
  const review=e.target.closest('[data-review]'),deletedToken=e.target.closest('[data-delete-token]'),priority=e.target.closest('[data-priority]'),disable=e.target.closest('[data-disable]');
  if(!isAdmin)return;
  try{
    if(review){await api(`/api/source-suggestions/${review.dataset.review}/review`,{method:'POST',body:JSON.stringify({decision:review.dataset.decision})});await loadSuggestions();await refresh();}
    if(deletedToken){await api(`/api/tokens/${deletedToken.dataset.deleteToken}`,{method:'DELETE'});$('created-token').value='';$('created-token-panel').hidden=true;await loadTokens();notice('Токен удалён. Ссылки с ним больше не работают.','success');}
    if(priority){const value=window.prompt('Приоритет источника: меньшее число обрабатывается раньше',priority.dataset.current);if(value===null)return;const n=Number(value);if(!Number.isInteger(n)||n<0||n>1000000)throw new Error('Приоритет — целое число от 0 до 1000000');await api(`/api/sources/${priority.dataset.priority}`,{method:'PATCH',body:JSON.stringify({priority:n})});await refresh();}
    if(disable){await api(`/api/sources/${disable.dataset.disable}`,{method:'PATCH',body:JSON.stringify({lives:0})});await refresh();}
  }catch(e){notice(e.message,'error');}
});



let qrProxyId=null, qrRequestId=0;
function openProxyQr(proxyId){
  qrProxyId=proxyId;
  const access=adminMode?token:$('sub-token').value.trim();
  $('proxy-qr-title').textContent=`Конфигурация прокси #${proxyId}`;
  $('proxy-qr-content').hidden=true;$('proxy-qr-value').value='';$('proxy-qr-image').removeAttribute('src');
  $('proxy-qr-token').value=access;
  $('proxy-qr-token-form').hidden=Boolean(access);
  $('proxy-qr-state').textContent=access?'Загружаем конфигурацию…':'Введи токен подписки, чтобы открыть конфигурацию.';
  $('proxy-qr-dialog').showModal();
  if(access)loadProxyQr();else $('proxy-qr-token').focus();
}
async function loadProxyQr(){
  if(qrProxyId===null)return;
  const requestId=++qrRequestId, proxyId=qrProxyId, access=$('proxy-qr-token').value.trim();
  if(!access){$('proxy-qr-state').textContent='Введи токен подписки.';return;}
  $('proxy-qr-state').textContent='Загружаем конфигурацию…';
  $('proxy-qr-content').hidden=true;
  const controls=[$('proxy-qr-token'),$('proxy-qr-token-form').querySelector('button')];controls.forEach(el=>el.disabled=true);
  try{
    const response=await request(apiUrl(`/api/proxies/${proxyId}/connection`),{headers:{Authorization:`Bearer ${access}`}});
    if(response.status===401 && !adminMode)forgetSubscriptionToken(access);
    if(requestId!==qrRequestId)return;
    if(response.status===401){$('proxy-qr-token-form').hidden=false;throw new Error('Токен недействителен или удалён. Введи действующий токен подписки.');}
    if(!response.ok)throw new Error(response.status===404?'Прокси не найден.':'Не удалось получить конфигурацию.');
    const result=await response.json();
    if(requestId!==qrRequestId)return;
    $('proxy-qr-value').value=result.uri;
    $('proxy-qr-image').hidden=!result.qr;
    if(result.qr)$('proxy-qr-image').src=result.qr;
    $('proxy-qr-content').hidden=false;
    $('proxy-qr-token-form').hidden=true;
    $('proxy-qr-state').textContent=result.qrError || (result.lives?'Отсканируй QR-код в VPN-клиенте или скопируй строку.':'Прокси отмечен мёртвым. Конфигурацию можно импортировать для ручной проверки.');
    if(!adminMode)rememberSubscriptionToken(access);
  }catch(error){if(requestId===qrRequestId)$('proxy-qr-state').textContent=error.message;}
  finally{if(requestId===qrRequestId)controls.forEach(el=>el.disabled=false);}
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-proxy-qr]');if(button)openProxyQr(Number(button.dataset.proxyQr));});
$('proxy-qr-token-form').onsubmit=event=>{event.preventDefault();loadProxyQr();};
function clearProxyQr(){qrRequestId++;qrProxyId=null;$('proxy-qr-value').value='';$('proxy-qr-token').value='';$('proxy-qr-image').removeAttribute('src');$('proxy-qr-content').hidden=true;$('proxy-qr-token').disabled=false;$('proxy-qr-token-form').querySelector('button').disabled=false;}
function closeProxyQr(){clearProxyQr();$('proxy-qr-dialog').close();}
$('proxy-qr-close').onclick=closeProxyQr;
$('proxy-qr-dialog').addEventListener('click',event=>{if(event.target===$('proxy-qr-dialog')){const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeProxyQr();}});
$('proxy-qr-dialog').addEventListener('cancel',clearProxyQr);
$('proxy-qr-dialog').addEventListener('close',()=>{if(!$('proxy-qr-dialog').open)clearProxyQr();});
$('copy-proxy-config').onclick=async()=>{
  const field=$('proxy-qr-value');if(!field.value)return;
  try{await navigator.clipboard.writeText(field.value);$('proxy-qr-state').textContent='Конфигурация скопирована.';}
  catch{field.focus();field.select();field.setSelectionRange(0,field.value.length);$('proxy-qr-state').textContent='Строка выделена — скопируй её через Ctrl+C или меню устройства.';}
};
