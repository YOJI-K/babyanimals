const state = { d:new Date() };
const mock = [{ date:new Date().toISOString().slice(0,10), title:'シロクマの赤ちゃん誕生日' }];

function draw(){
  const d = new Date(state.d.getFullYear(), state.d.getMonth(), 1);
  const first = new Date(d);
  const monthName = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  document.getElementById('month').textContent = monthName;

  const startWeek = first.getDay();
  const daysInMonth = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  const cells = [];
  for(let i=0;i<startWeek;i++) cells.push('');
  for(let i=1;i<=daysInMonth;i++) cells.push(String(i));

  const todayISO = new Date().toISOString().slice(0,10);
  const events = mock;

  const grid = document.createElement('div');
  grid.className='grid';
  grid.style.gridTemplateColumns='repeat(7,1fr)';
  grid.style.gap='8px';

  cells.forEach((v, idx)=>{
    const cell = document.createElement('div');
    cell.className='card';
    cell.style.minHeight='80px';
    cell.innerHTML = `<div class="pad"><div class="meta">${v || ''}</div></div>`;
    if(v){
      const dateISO = `${monthName}-${String(v).padStart(2,'0')}`;
      if(events.some(e=>e.date===dateISO)){
        cell.querySelector('.pad').innerHTML += `<div class="badge">● イベント</div>`;
      }
      if(dateISO===todayISO){
        cell.style.outline='2px solid var(--accent)';
      }
    }
    grid.appendChild(cell);
  });

  const root = document.getElementById('cal');
  root.innerHTML='';
  root.appendChild(grid);
}

document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('prev').addEventListener('click',()=>{ state.d.setMonth(state.d.getMonth()-1); draw(); });
  document.getElementById('next').addEventListener('click',()=>{ state.d.setMonth(state.d.getMonth()+1); draw(); });
  draw();
});
