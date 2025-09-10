let page = 1;
const PAGE_SIZE = 12;
let all = [];

async function loadMock(){
  // Fallback: 失敗時モック
  const res = await fetch('/assets/mock/news.json');
  return res.json();
}

async function loadSupabase(){
  const { URL, ANON } = window.SUPABASE || {};
  if(!URL || !ANON) throw new Error("Supabase config missing");

  const q = new URL(`${URL}/rest/v1/news_items`);
  q.searchParams.set("select", "title,url,published_at,source_name,thumbnail_url,source_url");
  q.searchParams.set("order", "published_at.desc");
  q.searchParams.set("limit", "200");

  const res = await fetch(q.toString(), {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }
  });
  if(!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
  return res.json();
}

function render(){
  const sk = document.getElementById('skeleton-news');
  const el = document.getElementById('list');

  // ---- 1. 描画開始：スケルトンON、リストを空にする ----
  if (sk) sk.style.display = 'grid';  // skeletonを表示
  if (el) el.innerHTML = '';          // 前の内容を消す

  // ---- 2. データ加工 ----
  const q = (document.getElementById('q').value||'').toLowerCase();
  const source = document.getElementById('source').value;
  const sort = document.getElementById('sort').value;

  let data = [...all];
  if (q) data = data.filter(x => (x.title||'').toLowerCase().includes(q) || (x.source_name||'').toLowerCase().includes(q));
  if (source === 'YouTube') data = data.filter(x => x.source_name === 'YouTube');
  if (source === 'blog') data = data.filter(x => x.source_name !== 'YouTube');

  data.sort((a,b)=> sort==='desc'
    ? (new Date(b.published_at)-new Date(a.published_at))
    : (new Date(a.published_at)-new Date(b.published_at))
  );

  const start = 0;
  const end = page * PAGE_SIZE;
  const slice = data.slice(start, end);

  // ---- 3. 描画本体 ----
  el.innerHTML = slice.map(x => `
    <a class="card" href="${x.url}" target="_blank" rel="noopener">
      <img class="thumb" src="${x.thumbnail_url || ''}" loading="lazy" alt="">
      <div class="pad">
        <h3 class="clamp-2">${x.title || '(no title)'}</h3>
        <div class="meta">${Site.fmtDate(x.published_at)} ・ <strong>${Site.domain(x.url)}</strong></div>
        <div class="badge src">${x.source_name || ''}</div>
      </div>
    </a>
  `).join('');

  // ---- 4. 描画完了：スケルトンOFF ----
  if (sk) sk.style.display = 'none';

  // ---- 5. 空状態の表示 ----
  document.getElementById('empty').style.display = slice.length ? 'none' : 'block';
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    all = await loadSupabase();   // ← まずSupabaseを試す
  } catch (e) {
    console.warn(e);
    all = await loadMock();       // ← 失敗時はモック
  }
  render();

  document.getElementById('q').addEventListener('input', ()=>{ page=1; render(); });
  document.getElementById('source').addEventListener('change', ()=>{ page=1; render(); });
  document.getElementById('sort').addEventListener('change', ()=>{ page=1; render(); });
  document.getElementById('more').addEventListener('click', ()=>{ page++; render(); });
});

