// babies.js（完全版）

let BABIES = [];
let ZOOS = [];

function tmplCard(x){
  const img = x.thumbnail_url || 'https://placehold.co/640x360';
  const zoo = x.zoo_name || '';
  const sp  = x.species || '';
  const bd  = x.birthday ? Site.fmtDate(x.birthday) : '';
  return `
    <a class="card" href="#" onclick="return false;">
      <img class="thumb" src="${img}" alt="">
      <div class="pad">
        <h3>${x.name || '(no name)'}</h3>
        <div class="meta">${zoo} ・ ${sp}</div>
        <div class="badge">${bd || '誕生日情報なし'}</div>
      </div>
    </a>`;
}

function render(){
  const q = (document.getElementById('q')?.value || '').toLowerCase();
  const zooId = document.getElementById('zoo')?.value || '';

  let data = [...BABIES];
  if(q){
    data = data.filter(x =>
      (x.name||'').toLowerCase().includes(q) ||
      (x.species||'').toLowerCase().includes(q) ||
      (x.zoo_name||'').toLowerCase().includes(q)
    );
  }
  if(zooId) data = data.filter(x => String(x.zoo_id||'') === String(zooId));

  // 誕生日の新しい順（未設定は最後）
  data.sort((a,b)=>{
    const ad = a.birthday ? new Date(a.birthday).getTime() : -Infinity;
    const bd = b.birthday ? new Date(b.birthday).getTime() : -Infinity;
    return bd - ad;
  });

  document.getElementById('list').innerHTML = data.map(tmplCard).join('');
}

async function loadZoos(){
  const { URL: SUPA_URL, ANON } = window.SUPABASE || {};
  const q = new window.URL(`${SUPA_URL}/rest/v1/zoos`);
  q.searchParams.set('select','id,name');
  q.searchParams.set('order','name.asc');

  const res = await fetch(q, { headers:{ apikey:ANON, Authorization:`Bearer ${ANON}` } });
  if(!res.ok) throw new Error('load zoos failed');

  ZOOS = await res.json();
  const sel = document.getElementById('zoo');
  sel.innerHTML = `<option value="">すべての動物園</option>`
    + ZOOS.map(z=>`<option value="${z.id}">${z.name}</option>`).join('');
}

async function loadBabies(){
  const { URL: SUPA_URL, ANON } = window.SUPABASE || {};
  const q = new window.URL(`${SUPA_URL}/rest/v1/babies_public`);
  q.searchParams.set('select','id,name,species,birthday,thumbnail_url,zoo_id,zoo_name');
  q.searchParams.set('order','birthday.desc,nullslast');
  q.searchParams.set('limit','500');

  const res = await fetch(q, { headers:{ apikey:ANON, Authorization:`Bearer ${ANON}` } });
  if(!res.ok) throw new Error('load babies failed');

  BABIES = await res.json();
}

document.addEventListener('DOMContentLoaded', async ()=>{
  try{
    await loadZoos();
    await loadBabies();
  }catch(e){
    console.error(e);
  }
  render();
  document.getElementById('q').addEventListener('input', render);
  document.getElementById('zoo').addEventListener('change', render);
});
