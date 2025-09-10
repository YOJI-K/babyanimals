// calendar.js
const state = { d:new Date(), events:[] };

function monthKey(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function firstLastOfMonth(d){
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last  = new Date(d.getFullYear(), d.getMonth()+1, 0);
  const s = first.toISOString().slice(0,10);
  const e = last.toISOString().slice(0,10);
  return {start:s, end:e};
}

async function loadEventsForMonth(d){
  const { URL, ANON } = window.SUPABASE || {};
  const { start, end } = firstLastOfMonth(d);

  const q = new URL(`${URL}/rest/v1/events_public`);
  q.searchParams.set('select','id,date,title,baby_id,baby_name,zoo_id,zoo_name');
  q.searchParams.set('date','gte.'+start);
  q.searchParams.set('date','lte.'+end);
  q.searchParams.set('order','date.asc');
  q.searchParams.set('limit','500');

  const res = await fetch(q, { headers:{ apikey:ANON, Authorization:`Bearer ${ANON}` } });
  if(!res.ok) throw new Error('load events failed');
  state.events = await res.json();
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

document.addEventListener('DOMContentLoaded', async ()=>{
  await loadEventsForMonth(state.d);
  draw();
  document.getElementById('prev').addEventListener('click', async ()=>{
    state.d.setMonth(state.d.getMonth()-1);
    await loadEventsForMonth(state.d);
    draw();
  });
  document.getElementById('next').addEventListener('click', async ()=>{
    state.d.setMonth(state.d.getMonth()+1);
    await loadEventsForMonth(state.d);
    draw();
  });
});
