/* お気に入り機能（v1・localStorage）PROP-20260610-02 フェーズ1
   - 保存はこの端末内（localStorage キー zb_favorites）
   - ♡ボタンは .fav-btn[data-fav-id] を document 委譲で処理（SSG/クライアント両対応）
   - ヘッダー .fav-hdr__badge に件数を同期
   - /favorites/ ページ（#fav-list）をクライアント描画 */
(() => {
  'use strict';
  const KEY = 'zb_favorites';
  const SB_URL  = 'https://hvhpfrksyytthupboaeo.supabase.co';
  const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aHBmcmtzeXl0dGh1cGJvYWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwNTc4MzQsImV4cCI6MjA3MjYzMzgzNH0.e5w3uSzajTHYdbtbVGDVFmQxcwe5HkyKSoVM7tMmKaY';

  function read(){ try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch(_) { return {}; } }
  function write(o){ try { localStorage.setItem(KEY, JSON.stringify(o)); } catch(_) {} }

  const Favorites = {
    has(id){ return !!read()[id]; },
    count(){ return Object.keys(read()).length; },
    list(){ const o = read(); return Object.keys(o).sort((a,b)=> String(o[b].addedAt||'').localeCompare(String(o[a].addedAt||''))); },
    toggle(id){
      const o = read();
      if (o[id]) delete o[id]; else o[id] = { addedAt: new Date().toISOString() };
      write(o);
      document.dispatchEvent(new CustomEvent('favchange', { detail: { id } }));
      return !!read()[id];
    }
  };
  window.ZBFavorites = Favorites;

  /* ---- ♡クリック（document委譲：SSG静的カードもクライアント描画カードも動く）---- */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.fav-btn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const id = btn.getAttribute('data-fav-id');
    if (!id) return;
    const on = Favorites.toggle(id);
    if (typeof gtag === 'function') {
      gtag('event', on ? 'favorite_add' : 'favorite_remove', {
        baby_id: id, animal_species: btn.getAttribute('data-fav-species') || ''
      });
    }
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && t && t.classList && t.classList.contains('fav-btn')) {
      e.preventDefault(); t.click();
    }
  });

  /* ---- 表示同期 ---- */
  function syncButtons(){
    const favs = read();
    document.querySelectorAll('.fav-btn[data-fav-id]').forEach(b => {
      const on = !!favs[b.getAttribute('data-fav-id')];
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', on ? 'お気に入りを解除' : 'お気に入りに追加');
    });
  }
  function syncHeader(){
    const c = Favorites.count();
    document.querySelectorAll('.fav-hdr__badge').forEach(el => {
      el.textContent = c > 99 ? '99+' : String(c);
      el.style.display = c > 0 ? '' : 'none';
    });
  }
  function syncAll(){ syncButtons(); syncHeader(); }

  document.addEventListener('favchange', () => { syncAll(); if (document.getElementById('fav-list')) renderFavoritesPage(); });
  window.addEventListener('storage', (e) => { if (e.key === KEY) { syncAll(); if (document.getElementById('fav-list')) renderFavoritesPage(); } });

  /* ---- /favorites/ ページ描画 ---- */
  async function renderFavoritesPage(){
    const wrap = document.getElementById('fav-list');
    if (!wrap) return;
    const empty = document.getElementById('fav-empty');
    const countEl = document.getElementById('fav-count');
    const ids = Favorites.list();
    if (countEl) countEl.textContent = ids.length ? `${ids.length}頭の推しベビー` : 'まだ登録がありません';
    if (!ids.length) { wrap.innerHTML = ''; if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    try {
      const inList = `(${ids.map(encodeURIComponent).join(',')})`;
      const url = `${SB_URL}/rest/v1/babies?select=id,name,species,birthday,zoo_id,thumbnail_url,display_status,zoo:zoos(name)&id=in.${inList}`;
      const rows = await fetch(url, { headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` }, cache: 'no-store' }).then(r => r.json());
      const order = new Map(ids.map((id, i) => [id, i]));
      (rows || []).sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
      const nowY = new Date().getFullYear();
      const html = (rows || []).map(b => {
        const o = Object.assign({}, b, { zoo_name: (b.zoo && b.zoo.name) || b.zoo_name || '' });
        const age = b.birthday ? (nowY - new Date(b.birthday).getFullYear()) : null;
        return (typeof window.renderBabyRow === 'function') ? window.renderBabyRow(o, { age }) : '';
      }).join('');
      wrap.innerHTML = html;
      syncButtons();
    } catch (e) { console.error('[favorites] list fetch failed', e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { syncAll(); renderFavoritesPage(); });
  } else {
    syncAll(); renderFavoritesPage();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('main') || document.body;
    try { new MutationObserver(() => syncButtons()).observe(root, { childList: true, subtree: true }); } catch(_) {}
  });
})();
