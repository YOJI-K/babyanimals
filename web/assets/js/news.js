// /assets/js/news.js — v3 (Supabase専用 / 競合回避 / 12件ずつ増分 / エラー抑制)
(() => {
  // --- 競合回避: すでに別のニュース実装が初期化済みなら何もしない ---
  if (window.__NEWS_ANY_INITED) return;
  window.__NEWS_ANY_INITED = true;

  // --- 競合回避: index.html に旧インライン実装の印（data-news-v2等）があれば退出 ---
  const body = document.body;
  if (body && (body.hasAttribute('data-news-v2') || body.getAttribute('data-news') === 'inline')) {
    // 旧実装に委ねる
    return;
  }

  // ===== 設定 =====
  let page = 1;
  const PAGE_SIZE = 12;
  let all = [];

  // DOM参照
  const $list     = document.getElementById('list');
  const $empty    = document.getElementById('empty');
  const $error    = document.getElementById('error');
  const $skeleton = document.getElementById('skeleton-news');
  const $q        = document.getElementById('q');
  const $source   = document.getElementById('source');
  const $sort     = document.getElementById('sort');
  const $more     = document.getElementById('more');

  // ===== Siteユーティリティのフォールバック =====
  const Site = window.Site || {};
  Site.fmtDate = Site.fmtDate || function (iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };
  Site.domain = Site.domain || function (url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  };

  // ===== Supabase設定（window.SUPABASE → <meta> フォールバック）=====
  function getSupabaseConfig() {
    const fromWin = (window.SUPABASE || {});
    let URL = fromWin.URL || fromWin.url;
    let ANON = fromWin.ANON || fromWin.anon || fromWin.ANON_KEY || fromWin.anonKey;

    if (!URL || !ANON) {
      const metaUrl = document.querySelector('meta[name="supabase-url"]');
      const metaKey = document.querySelector('meta[name="supabase-anon-key"]');
      URL  = URL  || metaUrl?.content?.trim();
      ANON = ANON || metaKey?.content?.trim();
    }
    return { URL, ANON };
  }

  // ===== データ取得（サンプル/モックは使わない）=====
  async function loadSupabase() {
    const { URL, ANON } = getSupabaseConfig();
    if (!URL || !ANON) throw new Error('Supabase config missing');

    const u = new URL(`${URL}/rest/v1/news_items`);
    u.searchParams.set('select', 'id,title,url,published_at,source_name,thumbnail_url,source_url');
    u.searchParams.set('order', 'published_at.desc,id.desc');
    u.searchParams.set('limit', '200');

    const res = await fetch(u.toString(), {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }
    });
    if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
    return res.json();
  }

  // ===== データ加工（検索・絞り込み・並び替え）=====
  const normalize = (s) => (s || '').toString().toLowerCase();
  const isYouTube = (name) => normalize(name).includes('youtube');

  function filterAndSort() {
    const qVal   = normalize($q?.value);
    const srcVal = $source?.value || '';
    const sort   = $sort?.value === 'asc' ? 'asc' : 'desc';

    let data = Array.isArray(all) ? all.slice() : [];

    if (qVal) {
      data = data.filter(x =>
        normalize(x.title).includes(qVal) || normalize(x.source_name).includes(qVal)
      );
    }
    if (srcVal === 'YouTube')       data = data.filter(x => isYouTube(x.source_name));
    else if (srcVal === 'blog')     data = data.filter(x => !isYouTube(x.source_name));

    data.sort((a, b) => {
      const ad = new Date(a.published_at || 0).getTime();
      const bd = new Date(b.published_at || 0).getTime();
      if (ad !== bd) return sort === 'asc' ? ad - bd : bd - ad;
      // 同時刻は id で安定化
      if (a.id !== b.id) return sort === 'asc' ? (a.id > b.id ? 1 : -1) : (a.id < b.id ? 1 : -1);
      return 0;
    });

    return data;
  }

  // ===== 描画 =====
  function render() {
    const data = filterAndSort();

    const end = page * PAGE_SIZE;
    const slice = data.slice(0, end);

    // HTML構築：16:9に合わせて <div class="thumb"><img /></div> 構造
    const html = slice.map(x => {
      const href   = x.url || x.source_url || '#';
      const date   = Site.fmtDate(x.published_at);
      const src    = x.source_name || '';
      const domain = Site.domain(x.url || x.source_url || '');
      const thumb  = x.thumbnail_url || '';

      return `
        <a class="card" href="${href}" target="_blank" rel="noopener">
          <div class="thumb"><img src="${thumb}" loading="lazy" alt=""></div>
          <div class="pad">
            <h3 class="title clamp-2">${x.title || '(no title)'}</h3>
            <div class="meta">${date}${domain ? ` ・ <strong>${domain}</strong>` : ''}</div>
            <div class="badge src">${src}</div>
          </div>
        </a>
      `;
    }).join('');

    if ($list) $list.innerHTML = html;

    // 空状態
    if ($empty) $empty.style.display = slice.length ? 'none' : 'block';

    // もっと読むの表示制御
    const hasMore = slice.length < data.length;
    if ($more) {
      $more.disabled = !hasMore;
      $more.style.display = hasMore ? 'inline-flex' : 'none';
    }
  }

  // ===== イベント =====
  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
  function onFilterChange() {
    page = 1; // フィルタ/ソート変更時は先頭から
    render();
  }

  // ===== 初期化 =====
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      // 初回フェッチ中だけスケルトン表示
      if ($skeleton) $skeleton.style.display = 'grid';
      if ($error) { $error.style.display = 'none'; $error.textContent = ''; }

      all = await loadSupabase();
    } catch (e) {
      // 取得に失敗しても、サンプルは使わない。空表示にする。
      console.warn('[news.js] fetch error:', e);
      all = [];
      // ユーザー体験を優先し、目立つエラーは出さない（空表示に留める）
      if ($error) { $error.style.display = 'none'; $error.textContent = ''; }
    } finally {
      if ($skeleton) $skeleton.style.display = 'none';
      render();
    }

    // イベント登録（重複防止のため addEventListener のみ／inline onclickは使わない）
    if ($q)      $q.addEventListener('input', debounce(onFilterChange, 200));
    if ($source) $source.addEventListener('change', onFilterChange);
    if ($sort)   $sort.addEventListener('change', onFilterChange);
    if ($more)   $more.addEventListener('click', () => { page += 1; render(); });
  });
})();
