// calendar.js (refined for UX & mobile)

const state = { d:new Date(), events:[] };

// デバッグログは無効（必要時に console.log に戻せるようフック）
function log(){ /* デバッグOFF */ }

function monthKey(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function firstLastOfMonth(d){
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last  = new Date(d.getFullYear(), d.getMonth()+1, 0);
  return {start:first.toISOString().slice(0,10), end:last.toISOString().slice(0,10)};
}

async function fetchJSON(u){
  const { URL: SUPA_URL, ANON } = window.SUPABASE || {};
  if(!SUPA_URL || !ANON) throw new Error('Supabase config missing in app.js');
  const url = new window.URL(`${SUPA_URL}${u}`);
  // 一覧の月切替で古いキャッシュが見えないよう短期no-store
  const res = await fetch(url, { headers:{ apikey:ANON, Authorization:`Bearer ${ANON}` }, cache:'no-store' });
  log('GET', url.toString(), '->', res.status);
  if(!res.ok){
    const t = await res.text().catch(()=> '');
    throw new Error(`Fetch failed ${res.status}: ${t}`);
  }
  return res.json();
}

async function loadEventsForMonth(d){
  const { start, end } = firstLastOfMonth(d);
  const q = `/rest/v1/events_public?select=id,date,title,baby_name,zoo_name&date=gte.${start}&date=lte.${end}&order=date.asc&limit=500`;
  state.events = await fetchJSON(q);
  log('events:', state.events.length);
}

// 曜日ヘッダ（HTMLに無い場合でも自動で作る）
function ensureWeekHeader(){
  const existing = document.getElementById('dow');
  if (existing) return; // 既にあれば何もしない

  const hero = document.querySelector('.hero');
  if (!hero) return;

  const wrap = document.createElement('div');
  wrap.id = 'dow';
  wrap.className = 'grid';
  wrap.style.gridTemplateColumns = 'repeat(7,1fr)';
  wrap.style.gap = '8px';
  wrap.style.marginBottom = '8px';

  const labels = ['日','月','火','水','木','金','土'];
  labels.forEach(t=>{
    const el = document.createElement('div');
    el.className = 'small';
    el.textContent = t;
    wrap.appendChild(el);
  });

  const cal = document.getElementById('cal');
  if (cal && cal.parentNode){
    cal.parentNode.insertBefore(wrap, cal);
  }else{
    hero.appendChild(wrap);
  }
}

// 凡例（HTMLに無い場合でも自動で作る）
function ensureLegend(){
  const existing = document.getElementById('legend');
  if (existing) return;

  const hero = document.querySelector('.hero');
  if (!hero) return;

  const box = document.createElement('div');
  box.id = 'legend';
  box.className = 'small';
  box.style.marginTop = '8px';
  box.innerHTML = `凡例：<span class="badge">● イベント</span> / 枠線＝本日`;
  hero.appendChild(box);
}

function draw(){
  const d = new Date(state.d.getFullYear(), state.d.getMonth(), 1);
  const firstWeekday = d.getDay();
  const days = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();

  // 1-5: 月ラベルを和式（例: 2025年9月）
  const monthLabel = document.getElementById('month');
  if (monthLabel && typeof Site?.fmtMonthYM === 'function'){
    monthLabel.textContent = Site.fmtMonthYM(d);
  }else if (monthLabel){
    // フォールバック
    monthLabel.textContent = `${d.getFullYear()}年${d.getMonth()+1}月`;
  }

  // 曜日ヘッダ & 凡例（無ければ挿入）
  ensureWeekHeader();
  ensureLegend();

  // カレンダー本体
  const grid = document.createElement('div');
  grid.className='grid';
  grid.style.gridTemplateColumns='repeat(7,1fr)';
  grid.style.gap='8px';

  const month = monthKey(d);
  const cells = [];
  for(let i=0;i<firstWeekday;i++) cells.push(null);
  for(let i=1;i<=days;i++) cells.push(i);

  const today = new Date().toISOString().slice(0,10);

  cells.forEach(v=>{
    const cell = document.createElement('div');
    cell.className='card';
    // SP余白最適化（少し小さめ、でもタップ余白は確保）
    cell.style.minHeight='92px';

    const pad = document.createElement('div');
    pad.className='pad';
    pad.innerHTML = `<div class="meta">${v||''}</div>`;

    if(v){
      const iso = `${month}-${String(v).padStart(2,'0')}`;
      const items = state.events.filter(e=>e.date===iso);

      if(items.length){
        // 最大3件を簡潔に表示（SP視認性）
        pad.innerHTML += items.slice(0,3).map(e=>`<div class="badge">● ${e.title}</div>`).join('');
        if(items.length>3) pad.innerHTML += `<div class="small">他 ${items.length-3} 件</div>`;
      }

      // 当日は枠線で強調
      if(iso===today) cell.style.outline='2px solid var(--accent)';
    }

    cell.appendChild(pad);
    grid.appendChild(cell);
  });

  const root = document.getElementById('cal');
  if (!root) return;
  root.innerHTML = '';
  root.appendChild(grid);
}

function showError(e){
  console.error(e);
  const box = document.createElement('div');
  box.className = 'empty';
  box.textContent = '読み込みエラー：' + (e?.message || e);
  document.querySelector('.hero')?.prepend(box);
}

document.addEventListener('DOMContentLoaded', async ()=>{
  log('calendar.js loaded');
  try{
    await loadEventsForMonth(state.d);
    draw();

    // 月移動（連打でも破綻しないように逐次 await）
    document.getElementById('prev').addEventListener('click', async ()=>{
      state.d.setMonth(state.d.getMonth()-1);
      await loadEventsForMonth(state.d);
      draw();
    }, {passive:true});

    document.getElementById('next').addEventListener('click', async ()=>{
      state.d.setMonth(state.d.getMonth()+1);
      await loadEventsForMonth(state.d);
      draw();
    }, {passive:true});
  }catch(e){
    showError(e);
  }
});
