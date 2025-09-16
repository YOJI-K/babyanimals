// /assets/js/news.js  — v2 (Supabase専用 / サンプル無効 / 12件ずつ増分)
(() => {
  if (window.__NEWS_JS_V2_INITED) return; // 二重初期化防止
  window.__NEWS_JS_V2_INITED = true;

  // ===== 設定 =====
  let page = 1;                 // 現在のページ（1ページ=12件）
  const PAGE_SIZE = 12;         // 1回の増分
  let all = [];                 // Supabaseから取得した全データ（最大200件など）

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

  // ===== データ取得（サンプルは使わない）=====
  async function loadSupabase() {
    const { URL, ANON } = getSupabaseConfig();
    if (!URL || !ANON) throw new Error('Supabase config missing');

    const u = new URL(`${URL}/rest/v1/news_items`);
    // id を含めて安定ソート可能にする
    u.searchParams.set('select', 'id,title,url,published_at,source_name,thumbnail_url,source_url');
    // 初回まとめて取得（必要なら値調整）
    u.searchParams.set('order', 'published_at.desc,id.desc');
    u.searchParams.set('limit', '200');

    const res = await fetch(u.toString(), {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }
    });
    if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
    return res.json();
  }

  // ===== データ加工（検索・絞り込み・並び替え）=====
  function normalize(str) { return (str || '').toString().toLowerCase(); }
  function isYouTubeSource(name) { return normalize(name).includes('youtube'); }

  function filterAndSort() {
    const qVal     = normalize($q?.value);
    const srcVal   = $source?.value || '';
    const sortVal  = $sort?.value === 'asc' ? 'asc' : 'desc';

    let data = Array.isArray(all) ? all.slice() : [];

    // 検索（タイトル / ソース名）
    if (qVal) {
      data = data.filter(x =>
        normalize(x.title).includes(qVal) || normalize(x.source_name).includes(qVal)
      );
    }

    // ソース絞り込み
    if (srcVal === 'YouTube') {
      data = data.filter(x => isYouTubeSource(x.source_name));
    } else if (srcVal === 'blog') {
      data = data.filter(x => !isYouTubeSource(x.source_name));
    }

    // 並び替え（published_at → id の安定ソート）
    data.sort((a, b) => {
      const ad = new Date(a.published_at || 0).getTime();
      const bd = new Date(b.published_at || 0).getTime();
      if (ad !== bd) return sortVal === 'asc' ? ad - bd : bd - ad;
      // id は文字列比較でOK（同日時の安定化）
      if (a.id !== b.id) return sortVal === 'asc' ? (a.id > b.id ? 1 : -1) : (a.id < b.id ? 1 : -1);
      return 0;
    });

    return data;
  }

  // ===== 描画 =====
  function render() {
    const data = filterAndSort();

    const end = page * PAGE_SIZE;
    const slice = data.slice(0, end);

    // HTML構築（16:9のため <div class="thumb"><img /></div> 構造）
    const html = slice.map(x => {
      const href = x.url || x.source_url || '#';
      const date = Site.fmtDate(x.published_at);
      const src  = x.source_name || '';
      const domain = Site.domain(x.url || x.source_url || '');

      const thumb = x.thumbnail_url || '';
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

    // もっと読むの制御（末尾に到達したら非表示/disabled）
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
    page = 1; // フィルタ変更時は先頭から
    render();
  }

  // ===== 初期化 =====
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      // 初回フェッチ中のみスケルトン表示
      if ($skeleton) $skeleton.style.display = 'grid';
      if ($error) { $error.style.display = 'none'; $error.textContent = ''; }

      all = await loadSupabase();     // 成功: 取得データのみ使用（サンプルには一切フォールバックしない）
    } catch (e) {
      console.error(e);
      all = [];                       // 失敗時は空配列
      if ($error) {
        $error.style.display = 'block';
        $error.textContent = 'データの取得に失敗しました。設定やCORS/RLSをご確認ください。';
      }
    } finally {
      if ($skeleton) $skeleton.style.display = 'none';
      render();
    }

    // イベント登録
    if ($q)      $q.addEventListener('input', debounce(onFilterChange, 200));
    if ($source) $source.addEventListener('change', onFilterChange);
    if ($sort)   $sort.addEventListener('change', onFilterChange);
    if ($more)   $more.addEventListener('click', () => { page += 1; render(); });
  });
})();
