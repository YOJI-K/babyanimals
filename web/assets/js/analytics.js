/* 旧ドメイン(babyanimals.pages.dev)アクセスは新ドメインzoobabies.jpへパス保持で転送（独自ドメイン移行） */
(function(){try{if(location.hostname==='babyanimals.pages.dev'){var d='https://zoobabies.jp'+location.pathname+location.search+location.hash;location.replace(d);}}catch(e){}})();

/**
 * analytics.js — どうベビ GA4 カスタムイベント
 *
 * 担当イベント:
 *   outbound_click  外部リンクのクリック
 *   push_subscribe  プッシュ通知登録（将来実装時に呼び出す）
 *
 * baby_view    → SSG生成ページ (scripts/ssg.js) のインラインスクリプトで送信
 * favorite_add → app.js の bindLike() 内で送信
 */

(function () {
  'use strict';

  /** gtag が準備できるまで待って呼び出す */
  function sendEvent(name, params) {
    if (typeof gtag === 'function') {
      gtag('event', name, params || {});
    }
  }

  // ── outbound_click ──────────────────────────────────────────────────
  // ページ内のすべての外部リンクをイベント委譲でトラッキング
  // data-link-type / data-zoo-name / data-animal-name 属性があれば追加計測
  document.addEventListener('click', function (e) {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    // 内部・相対・アンカーリンクは除外
    if (!href || href.startsWith('/') || href.startsWith('#') || href.startsWith('.')) return;
    try {
      const url = new URL(href, location.href);
      if (url.hostname === location.hostname) return;
      const params = {
        link_url:    href,
        link_text:   (a.textContent || '').trim().slice(0, 100),
        link_type:   a.dataset.linkType   || 'general',
      };
      if (a.dataset.zooName)    params.zoo_name    = a.dataset.zooName;
      if (a.dataset.animalName) params.animal_name = a.dataset.animalName;
      // ── affiliate_click ──（収益リンクを分離計測） PROP-20260607-02 施策7
      const isAffiliate = /a8\.net|px\.a8\.|asoview/i.test(href);
      if (isAffiliate && params.link_type === 'general') params.link_type = 'affiliate';
      sendEvent('outbound_click', params);
      if (isAffiliate) {
        sendEvent('affiliate_click', {
          link_url:    href,
          page_path:   location.pathname,
          link_text:   params.link_text,
          network:     /asoview/i.test(href) ? 'asoview' : 'a8',
          zoo_name:    a.dataset.zooName    || undefined,
          animal_name: a.dataset.animalName || undefined,
        });
      }
    } catch (_) { /* 不正なURL は無視 */ }
  }, { passive: true });

  // ── push_subscribe ──────────────────────────────────────────────────
  // プッシュ通知登録が実装されたら window.trackPushSubscribe() を呼び出す
  window.trackPushSubscribe = function () {
    sendEvent('push_subscribe');
  };
})();
