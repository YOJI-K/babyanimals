// calendar.js (debug v3)

const state = { d:new Date(), events:[] };

function log(...a){ try{ console.log('[calendar]', ...a);}catch{} }

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
  const res = await fetch(url, { headers:{ apikey:ANON, Authorization:`Bearer ${ANON}` } });
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

function draw(){
  const d = new Date(state.d.getFullYear(), state.d.getMonth(), 1);
  const firstWeekday = d.getDay();
  const days = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  const month = monthKey(d);
  document.getElementById('month').textContent = month;

  const grid = document.createElement('div');
  grid.className='grid';
  grid.style.gridTemplateColumns='repeat(7,1fr)';
  grid.style.gap='8px';

  const cells = [];
  for(let i=0;i<firstWeekday;i++) cells.push(null);
  for(let i=1;i<=days;i++) cells.push(i);

  const today = new Date().toISOString().slice(0,10);

  cells.forEach(v=>{
    const cell = document.createElement('div');
    cell.className='card';
    cell.style.minHeight='100px';
    const pad = document.createElement('div');
    pad.className='pad';
    pad.innerHTML = `<div class="meta">${v||''}</div>`;
    if(v){
      const iso = `${month}-${String(v).padStart(2,'0')}`;
      const items = state.events.filter(e=>e.date===iso);
      if(items.length){
        pad.innerHTML += items.slice(0,3).map(e=>`<div class="badge">● ${e.title}</div>`).join('');
        if(items.length>3) pad.innerHTML += `<div class="small">他 ${items.length-3} 件</div>`;
      }
      if(iso===today) cell.style.outline='2px solid var(--accent)';
    }
    cell.appendChild(pad);
    grid.appendChild(cell);
  });

  const root = document.getElementById('cal');
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
    document.getElementById('prev').addEventListener('click', async ()=>{
      state.d.setMonth(state.d.getMonth()-1);
      await loadEventsForMonth(state.d); draw();
    });
    document.getElementById('next').addEventListener('click', async ()=>{
      state.d.setMonth(state.d.getMonth()+1);
      await loadEventsForMonth(state.d); draw();
    });
  }catch(e){
    showError(e);
  }
});
