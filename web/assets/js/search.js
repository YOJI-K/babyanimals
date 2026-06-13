/* サイト内検索（PROP-20260613-01 P2#10）
   ヘッダーの [data-search-open] からオーバーレイを開き、
   /assets/data/search-index.json（SSGがビルド時に出力）を
   初回オープン時にフェッチして 名前/種/動物園/県 で絞り込む。 */
(() => {
  'use strict';
  let idx = null, box = null, input = null, list = null, lastFocus = null;
  const esc = (s) => String(s ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const TYPE_ICON = { baby: '🐾', zoo: '🏛️', species: '📖' };

  function ensureUi(){
    if (box) return;
    box = document.createElement('div');
    box.className = 'srch';
    box.innerHTML = `
      <div class="srch__panel" role="dialog" aria-modal="true" aria-label="サイト内検索">
        <div class="srch__bar">
          <input class="srch__input" type="search" placeholder="なまえ・どうぶつ・動物園・県名" autocomplete="off" aria-label="検索キーワード">
          <button class="srch__close" type="button" aria-label="閉じる">✕</button>
        </div>
        <div class="srch__hint">例: レッサーパンダ ／ 上野 ／ 北海道</div>
        <div class="srch__list" role="list"></div>
      </div>`;
    document.body.appendChild(box);
    input = box.querySelector('.srch__input');
    list  = box.querySelector('.srch__list');
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    box.querySelector('.srch__close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    input.addEventListener('input', () => render(input.value));
  }

  async function load(){
    if (idx) return;
    try {
      const r = await fetch('/assets/data/search-index.json');
      idx = r.ok ? await r.json() : [];
    } catch (_) { idx = []; }
  }

  // カタカナ→ひらがな正規化（ゆるい一致）
  const norm = (s) => String(s || '').toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));

  function render(q){
    const n = norm(q.trim());
    if (!n) { list.innerHTML = ''; return; }
    const hits = (idx || [])
      .filter(it => [it.n, it.s, it.z, it.p].some(v => v && norm(v).includes(n)))
      .slice(0, 30);
    list.innerHTML = hits.length
      ? hits.map(it => `<a class="srch__item" role="listitem" href="${esc(it.u)}">
          <span class="srch__type" aria-hidden="true">${TYPE_ICON[it.t] || '🔎'}</span>
          <span class="srch__name">${esc(it.n)}</span>
          <span class="srch__sub">${esc([it.s, it.z || it.p].filter(Boolean).join(' · '))}</span>
        </a>`).join('')
      : '<p class="srch__empty">みつかりませんでした 🐾</p>';
  }

  function open(){
    ensureUi();
    lastFocus = document.activeElement;
    box.classList.add('is-open');
    document.documentElement.classList.add('srch-lock');
    load().then(() => render(input.value));
    setTimeout(() => input.focus(), 30);
  }
  function close(){
    if (!box) return;
    box.classList.remove('is-open');
    document.documentElement.classList.remove('srch-lock');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-search-open]');
    if (btn) { e.preventDefault(); open(); }
  });
})();
