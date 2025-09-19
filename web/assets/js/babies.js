// assets/js/babies.js
// babies.js (robust with fallbacks & mobile-friendly)

let BABIES = [];
let ZOOS = [];
let PAGE = 1;
const PAGE_SIZE = 12;
// --- Siteユーティリティのフォールバック ---
const Site = window.Site || {};
Site.fmtDate = Site.fmtDate || function (iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
};
function log(){ /* silent */ }
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

function onImgError(ev){
  const ph = 'https://placehold.co/640x360?text=No+Image';
  if (ev?.target && ev.target.src !== ph) ev.target.src = ph;
}

function tmplCard(x){
  const img = x.thumbnail_url || 'https://placehold.co/640x360?text=Baby';
  const zoo = x.zoo_name || '';
  const sp  = x.species || '';
  const bd  = x.birthday ? Site.fmtDate(x.birthday) : '';
  const alt = [x.name, zoo].filter(Boolean).join(' @ ') || '赤ちゃん動物';
  return `
    <a class="card" href="#" onclick="return false;" aria-label="${x.name || '赤ちゃん'}の詳細（準備中）">
      <div class="thumb"><img src="${img}" loading="lazy" alt="${alt}" onerror="onImgError(event)"></div>
      <div class="pad">
        <div class="title clamp-2">${x.name || '(no name)'}</div>
        <div class="meta">${zoo || '園情報なし'} <span class="dot"></span> ${sp || '種別不明'}</div>
        <div class="badge">${bd || '誕生日情報なし'}</div>
      </div>
    </a>`;
}

function setSkeleton(v){ const sk=document.getElementById('skeleton-babies'); if(sk) sk.style.display=v?'grid':'none'; }
function setEmptyState(v){
  const e=document.getElementById('empty'); const q=(document.getElementById('q')?.value||'').trim();
  if(!e) return; if(!v){ e.style.display='none'; return; }
  e.textContent = q ? '該当する赤ちゃんが見つかりません。キーワードや絞り込み条件を緩めてみてください。'
                    : 'まだ赤ちゃんのデータがありません。少し時間をおいて再度お試しください。';
  e.style.display='block';
}
function showInlineError(msg){ const $err=document.getElementById('error'); if($err){ $err.style.display='block'; $err.textContent=msg; } }

function currentSort(){ return (document.getElementById('sort')?.value==='asc')?'asc':'desc'; }

function filteredData(){
  const q=(document.getElementById('q')?.value||'').toLowerCase().trim();
  const zooId=document.getElementById('zoo')?.value||'';
  let data=[...BABIES];
  if(q){ data=data.filter(x =>
    (x.name||'').toLowerCase().includes(q) ||
    (x.species||'').toLowerCase().includes(q) ||
    (x.zoo_name||'').toLowerCase().includes(q)
  );}
  if(zooId){ data=data.filter(x => String(x.zoo_id||'')===String(zooId)); }
  const asc=currentSort()==='asc';
  data.sort((a,b)=>{
    const ad=a.birthday?new Date(a.birthday).getTime():-Infinity;
    const bd=b.birthday?new Date(b.birthday).getTime():-Infinity;
    if(ad===-Infinity && bd===-Infinity) return 0;
    if(ad===-Infinity) return 1;
    if(bd===-Infinity) return -1;
    return asc?(ad-bd):(bd-ad);
  });
  return data;
}
function updateMoreButton(total, shown){
  const btn=document.getElementById('more'); if(!btn) return;
  const hasMore=shown<total; btn.style.display=hasMore?'inline-flex':'none'; btn.disabled=!hasMore;
}
function render(){
  setSkeleton(false);
  const el=document.getElementById('list'); if(!el) return;
  const data=filteredData();
  const hasMoreBtn=!!document.getElementById('more');
  const end=hasMoreBtn? PAGE*PAGE_SIZE : data.length;
  const slice=data.slice(0,end);
  el.innerHTML = slice.length ? slice.map(tmplCard).join('') : '';
  setEmptyState(!slice.length);
  updateMoreButton(data.length, slice.length);
  log('render:', slice.length, '/', data.length);
}

// ===== Supabase helpers =====
function getSupabaseEnv(){
  const metaUrl = document.querySelector('meta[name="supabase-url"]')?.content?.trim();
  const metaKey = document.querySelector('meta[name="supabase-anon-key"]')?.content?.trim();
  const URL = window.SUPABASE?.URL || metaUrl;
  const ANON = window.SUPABASE?.ANON || metaKey;
  return { URL, ANON };
}

async function fetchJSON(u){
  const { URL: SUPA_URL, ANON } = getSupabaseEnv();
  if(!SUPA_URL || !ANON) throw new Error('Supabase config missing (URL/ANON)');
  const url = new URL(u, SUPA_URL); // 安全に結合
  const res = await fetch(url.toString(), {
    headers:{
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      'Accept-Profile': 'public',
      'Content-Profile': 'public'
    },
    cache:'no-store'
  });
  if(!res.ok){
    const t = await res.text().catch(()=> '');
    throw new Error(`HTTP ${res.status} @ ${url.pathname}: ${t}`);
  }
  return res.json();
}

// ===== Data loaders (with fallbacks) =====
async function loadZoos(){
  setSkeleton(true);
  try{
    ZOOS = await fetchJSON('/rest/v1/zoos?select=id,name&order=name.asc');
    const sel=document.getElementById('zoo');
    if(sel){ sel.innerHTML = `<option value="">すべての動物園</option>` + ZOOS.map(z=>`<option value="${z.id}">${z.name}</option>`).join(''); }
  }catch(e){
    console.warn('[zoos] fallback: continue without zoo list', e);
    // 取得できなくても一覧は表示できるので続行
    ZOOS = [];
  }
}

// babies_public → babies(embed) → babies(素)
async function loadBabies(){
  // 1) babies_public（既定）
  try{
    BABIES = await fetchJSON('/rest/v1/babies_public?select=id,name,species,birthday,thumbnail_url,zoo_id,zoo_name&order=birthday.desc.nullslast&limit=500');
    return;
  }catch(e1){
    console.warn('[babies_public] failed, try babies with embed', e1);
  }
  // 2) babies + embed zoos(name)  ※外部キー設定がある場合
  try{
    const data = await fetchJSON('/rest/v1/babies?select=id,name,species,birthday,thumbnail_url,zoo_id,zoo:zoos(name)&order=birthday.desc.nullslast&limit=500');
    BABIES = (data || []).map(x => ({
      id:x.id, name:x.name, species:x.species, birthday:x.birthday,
      thumbnail_url:x.thumbnail_url, zoo_id:x.zoo_id, zoo_name:x.zoo?.name || ''
    }));
    return;
  }catch(e2){
    console.warn('[babies embed] failed, try babies plain', e2);
  }
  // 3) babies 素のまま（zoo_name は空）
  try{
    const data = await fetchJSON('/rest/v1/babies?select=id,name,species,birthday,thumbnail_url,zoo_id&order=birthday.desc.nullslast&limit=500');
    BABIES = (data || []).map(x => ({ ...x, zoo_name:'' }));
  }catch(e3){
    console.error('[babies plain] failed', e3);
    throw e3; // ここまで失敗したら画面にエラー表示
  }
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', async ()=>{
  window.onImgError = onImgError;
  try{
    await loadZoos();
    await loadBabies();
    PAGE=1; render();

    const onSearch = debounce(()=>{ PAGE=1; render(); }, 140);
    document.getElementById('q')?.addEventListener('input', onSearch, {passive:true});
    document.getElementById('zoo')?.addEventListener('change', ()=>{ PAGE=1; render(); }, {passive:true});
    document.getElementById('sort')?.addEventListener('change', ()=>{ PAGE=1; render(); }, {passive:true});
    document.getElementById('more')?.addEventListener('click', ()=>{ PAGE++; render(); });
  }catch(e){
    console.error(e);
    setSkeleton(false);
    showInlineError('読み込みエラーが発生しました。時間をおいて再度お試しください。');
  }
});
