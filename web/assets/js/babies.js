// babies.js (refined for UX & mobile)

// ===== State =====
let BABIES = [];
let ZOOS = [];
let PAGE = 1;
const PAGE_SIZE = 12; // 1回あたりの追加表示件数（newsと同等感覚）

// デバッグログ：必要時に console.log に差し替え
function log(){ /* silent */ }

// ===== Utilities =====
function debounce(fn, ms){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}

// 画像エラーフォールバック（SPでも崩れない）
function onImgError(ev){
  const ph = 'https://placehold.co/640x360?text=No+Image';
  if (ev?.target && ev.target.src !== ph) ev.target.src = ph;
}

// 1カードのテンプレート（SP視認性：タイトル2行、省略記号、メタは簡潔）
function tmplCard(x){
  const img = x.thumbnail_url || 'https://placehold.co/640x360?text=Baby';
  const zoo = x.zoo_name || '';
  const sp  = x.species || '';
  const bd  = x.birthday ? Site.fmtDate(x.birthday) : '';

  // アクセシビリティ：画像altは名前＋園で説明的に
  const alt = [x.name, zoo].filter(Boolean).join(' @ ') || '赤ちゃん動物';

  return `
    <a class="card" href="#" onclick="return false;" aria-label="${x.name || '赤ちゃん'}の詳細（準備中）">
      <div class="thumb">
        <img src="${img}" loading="lazy" alt="${alt}" onerror="onImgError(event)">
      </div>
      <div class="pad">
        <div class="title clamp-2">${x.name || '(no name)'}</div>
        <div class="meta">${zoo || '園情報なし'} <span class="dot"></span> ${sp || '種別不明'}</div>
        <div class="badge">${bd || '誕生日情報なし'}</div>
      </div>
    </a>`;
}

// ===== Skeleton / Empty / Error =====
function setSkeleton(visible){
  const sk = document.getElementById('skeleton-babies');
  if (!sk) return;
  sk.style.display = visible ? 'grid' : 'none';
}

function setEmptyState(visible){
  const empty = document.getElementById('empty');
  const q = (document.getElementById('q')?.value || '').trim();
  if (!empty) return;
  if (!visible){
    empty.style.display = 'none';
    return;
  }
  empty.textContent = q
    ? '該当する赤ちゃんが見つかりません。キーワードや絞り込み条件を緩めてみてください。'
    : 'まだ赤ちゃんのデータがありません。少し時間をおいて再度お試しください。';
  empty.style.display = 'block';
}

function showInlineError(msg){
  const $err = document.getElementById('error');
  if ($err){
    $err.style.display = 'block';
    $err.textContent = msg;
  } else {
    // フォールバック
    const box = document.createElement('div');
    box.className = 'empty';
    box.textContent = msg;
    document.querySelector('.hero')?.prepend(box);
  }
}

// ===== Filtering & Rendering =====
function currentSort(){
  const v = document.getElementById('sort')?.value;
  return v === 'asc' ? 'asc' : 'desc';
}

function filteredData(){
  const q = (document.getElementById('q')?.value || '').toLowerCase().trim();
  const zooId = document.getElementById('zoo')?.value || '';

  let data = [...BABIES];

  if (q){
    data = data.filter(x =>
      (x.name||'').toLowerCase().includes(q) ||
      (x.species||'').toLowerCase().includes(q) ||
      (x.zoo_name||'').toLowerCase().includes(q)
    );
  }
  if (zooId) data = data.filter(x => String(x.zoo_id||'') === String(zooId));

  // 並び替え
  const asc = currentSort() === 'asc';
  data.sort((a,b)=>{
    const ad = a.birthday ? new Date(a.birthday).getTime() : -Infinity;
    const bd = b.birthday ? new Date(b.birthday).getTime() : -Infinity;
    // nulls last のニュアンスを維持
    if (ad === -Infinity && bd === -Infinity) return 0;
    if (ad === -Infinity) return 1;   // aが未設定 → 後ろ
    if (bd === -Infinity) return -1;  // bが未設定 → 後ろ
    return asc ? (ad - bd) : (bd - ad);
  });

  return data;
}

function updateMoreButton(totalCount, shownCount){
  const btn = document.getElementById('more');
  if (!btn) return;
  const hasMore = shownCount < totalCount;
  btn.style.display = hasMore ? 'inline-flex' : 'none';
  btn.disabled = !hasMore;
}

function render(){
  setSkeleton(false);

  const el = document.getElementById('list');
  if (!el){ log('no #list'); return; }

  const data = filteredData();

  // ページネーション（「もっと読む」が存在する場合のみ有効に）
  const hasMoreBtn = !!document.getElementById('more');
  const end = hasMoreBtn ? PAGE * PAGE_SIZE : data.length;
  const slice = data.slice(0, end);

  // 描画
  if (slice.length){
    el.innerHTML = slice.map(tmplCard).join('');
    setEmptyState(false);
  }else{
    el.innerHTML = '';
    setEmptyState(true);
  }

  updateMoreButton(data.length, slice.length);
  log('rendered:', slice.length, '/', data.length);
}

// ===== Supabase REST =====
async function fetchJSON(u){
  const { URL: SUPA_URL, ANON } = window.SUPABASE || {};
  if(!SUPA_URL || !ANON) throw new Error('Supabase config missing in app.js');

  const url = new window.URL(`${SUPA_URL}${u}`);
  const res = await fetch(url, {
    headers:{ apikey:ANON, Authorization:`Bearer ${ANON}` },
    cache: 'no-store'
  });
  log('GET', url.toString(), '->', res.status);
  if(!res.ok){
    const t = await res.text().catch(()=> '');
    throw new Error(`Fetch failed ${res.status}: ${t}`);
  }
  return res.json();
}

async function loadZoos(){
  setSkeleton(true);
  const data = await fetchJSON('/rest/v1/zoos?select=id,name&order=name.asc');
  ZOOS = data;

  const sel = document.getElementById('zoo');
  if (sel){
    sel.innerHTML = `<option value="">すべての動物園</option>`
      + ZOOS.map(z=>`<option value="${z.id}">${z.name}</option>`).join('');
  }
  log('zoos:', ZOOS.length);
}

async function loadBabies(){
  const data = await fetchJSON(
    '/rest/v1/babies_public'
    + '?select=id,name,species,birthday,thumbnail_url,zoo_id,zoo_name'
    + '&order=birthday.desc.nullslast'
    + '&limit=500'
  );
  BABIES = data;
  log('babies:', BABIES.length);
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', async ()=>{
  // グローバルで参照できるように公開
  window.onImgError = onImgError;

  try{
    await loadZoos();
    await loadBabies();
    PAGE = 1;
    render();

    // 入力・選択のイベント
    const onSearch = debounce(()=>{
      PAGE = 1; // フィルタ変更時は先頭に戻す
      render();
    }, 140);

    const $q   = document.getElementById('q');
    const $zoo = document.getElementById('zoo');
    const $sort= document.getElementById('sort');
    const $more= document.getElementById('more');

    if ($q)   $q.addEventListener('input', onSearch, {passive:true});
    if ($zoo) $zoo.addEventListener('change', ()=>{ PAGE=1; render(); }, {passive:true});
    if ($sort)$sort.addEventListener('change', ()=>{ PAGE=1; render(); }, {passive:true});
    if ($more)$more.addEventListener('click', ()=>{ PAGE++; render(); });

  }catch(e){
    console.error(e);
    setSkeleton(false);
    showInlineError('読み込みエラーが発生しました。時間をおいて再度お試しください。');
  }
});
