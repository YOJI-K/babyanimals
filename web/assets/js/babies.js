// babies.js (refined for UX & mobile)

let BABIES = [];
let ZOOS = [];

// デバッグログは既定で無効（必要時に console.log に戻せるようにフックだけ残す）
function log(){ /* デバッグOFF */ }

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
      <img class="thumb" src="${img}" loading="lazy" alt="${alt}" onerror="onImgError(event)">
      <div class="pad">
        <h3 class="clamp-2">${x.name || '(no name)'}</h3>
        <div class="meta">${zoo} ・ ${sp || '種別不明'}</div>
        <div class="badge">${bd || '誕生日情報なし'}</div>
      </div>
    </a>`;
}

// スケルトンON/OFF
function setSkeleton(visible){
  const sk = document.getElementById('skeleton-babies');
  if (!sk) return;
  sk.style.display = visible ? 'grid' : 'none';
}

// 空状態の表示（検索条件に応じたメッセージ）
function setEmptyState(visible){
  const empty = document.getElementById('empty'); // 既存の空DOMがあれば利用
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

// 検索・絞り込み → 描画
function render(){
  // 初期ロード直後のちらつき防止：開始時にスケルトンを消す・直前のリストは一旦空
  setSkeleton(false);

  const el = document.getElementById('list');
  if (!el){ log('no #list'); return; }
  el.innerHTML = '';

  const q = (document.getElementById('q')?.value || '').toLowerCase().trim();
  const zooId = document.getElementById('zoo')?.value || '';

  let data = [...BABIES];

  // 軽量フィルタ（SP配慮：複合条件でも高速）
  if (q){
    data = data.filter(x =>
      (x.name||'').toLowerCase().includes(q) ||
      (x.species||'').toLowerCase().includes(q) ||
      (x.zoo_name||'').toLowerCase().includes(q)
    );
  }
  if (zooId) data = data.filter(x => String(x.zoo_id||'') === String(zooId));

  // 誕生日の新しい順（未設定は最後）
  data.sort((a,b)=>{
    const ad = a.birthday ? new Date(a.birthday).getTime() : -Infinity;
    const bd = b.birthday ? new Date(b.birthday).getTime() : -Infinity;
    return bd - ad;
  });

  // DOM差し込み（SPの初期描画安定のため一括代入）
  if (data.length){
    el.innerHTML = data.map(tmplCard).join('');
    setEmptyState(false);
  }else{
    setEmptyState(true);
  }
  log('rendered cards:', data.length);
}

// Supabase REST ヘルパー
async function fetchJSON(u){
  const { URL: SUPA_URL, ANON } = window.SUPABASE || {};
  if(!SUPA_URL || !ANON) throw new Error('Supabase config missing in app.js');

  const url = new window.URL(`${SUPA_URL}${u}`);
  // キャッシュ効かせすぎによる「古い一覧」防止（短期のno-store）
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

// 動物園プルダウン
async function loadZoos(){
  // 初回ロード感：スケルトン見せてから取得
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

// 赤ちゃん一覧
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

// 失敗時のUI
function showError(e){
  console.error(e);
  const box = document.createElement('div');
  box.className = 'empty';
  box.textContent = '読み込みエラー：' + (e?.message || e);
  const root = document.querySelector('.hero');
  if (root) root.prepend(box);
  setSkeleton(false);
}

// 入力の連打でもSPで重くならないよう、小さなデバウンス
function debounce(fn, ms){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}

document.addEventListener('DOMContentLoaded', async ()=>{
  // 画像エラーのフォールバックをグローバル関数として使えるように
  window.onImgError = onImgError;

  try{
    await loadZoos();
    await loadBabies();
    render();

    // 入力・選択のイベント（モバイルでのタイプ中の過描画抑制）
    const onChange = debounce(render, 120);
    const q = document.getElementById('q');
    const zoo = document.getElementById('zoo');
    if (q) q.addEventListener('input', onChange, {passive:true});
    if (zoo) zoo.addEventListener('change', render, {passive:true});

  }catch(e){
    showError(e);
  }
});
