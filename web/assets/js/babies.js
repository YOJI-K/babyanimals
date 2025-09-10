// babies.js (debug v3)

let BABIES = [];
let ZOOS = [];

function log(...args){ try { console.log('[babies]', ...args); } catch{} }

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

  data.sort((a,b)=>{
    const ad = a.birthday ? new Date(a.birthday).getTime() : -Infinity;
    const bd = b.birthday ? new Date(b.birthday).getTime() : -Infinity;
    return bd - ad;
  });

  const html = data.map(tmplCard).join('');
  document.getElementById('list').innerHTML = html;
  log('rendered cards:', data.length);
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

async function loadZoos(){
  const data = await fetchJSON('/rest/v1/zoos?select=id,name&order=name.asc');
  ZOOS = data;
  const sel = document.getElementById('zoo');
  sel.innerHTML = `<option value="">すべての動物園</option>`
    + ZOOS.map(z=>`<option value="${z.id}">${z.name}</option>`).join('');
  log('zoos:', ZOOS.length);
}

async function loadBabies(){
  const data = await fetchJSON('/rest/v1/babies_public?select=id,name,species,birthday,thumbnail_url,zoo_id,zoo_name&order=birthday.desc.nullslast&limit=500');
  BABIES = data;
  log('babies:', BABIES.length);
}

function showError(e){
  console.error(e);
  const box = document.createElement('div');
  box.className = 'empty';
  box.textContent = '読み込みエラー：' + (e?.message || e);
  document.querySelector('.hero')?.prepend(box);
}

document.addEventListener('DOMContentLoaded', async ()=>{
  log('babies.js loaded');
  try{
    await loadZoos();
    await loadBabies();
    render();
    document.getElementById('q').addEventListener('input', render);
    document.getElementById('zoo').addEventListener('change', render);
  }catch(e){
    showError(e);
  }
});
