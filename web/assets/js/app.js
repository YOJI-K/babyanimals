// assets/js/app.js
// Global enhancements shared across pages (home / news / babies / calendar)

(() => {
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  document.addEventListener('DOMContentLoaded', () => {
    setActiveTabbarLink();
    headerOnScrollCompact();
    improveExternalUseHref();
    a11yTouchFocus();
    reduceMotionGuard();
    autoSetTabbarTitles();
  });

  /**
   * Highlight active tabbar link based on current path.
   * Works for nested pages: /news/, /babies/, /calendar/
   */
  function setActiveTabbarLink() {
    const path = location.pathname.replace(/\/+$/, ''); // trim trailing slash
    const map = [
      { href: /\/(index\.html)?$/, key: 'home' },
      { href: /\/news(\/|\/index\.html)?$/, key: 'news' },
      { href: /\/babies(\/|\/index\.html)?$/, key: 'babies' },
      { href: /\/calendar(\/|\/index\.html)?$/, key: 'calendar' }
    ];

    const current = map.find(m => m.href.test(path));
    if (!current) return;

    $$('.tabbar__link').forEach(a => a.classList.remove('is-active'));
    // Prefer exact match; fall back to includes
    const found =
      $(`.tabbar a[href*="${current.key}"]`) ||
      (current.key === 'home' ? $('.tabbar a[href$="index.html"]') : null);
    if (found) {
      found.classList.add('is-active');
      found.setAttribute('aria-current', 'page');
    }
  }

  /**
   * Compact header when scrolling down a bit (mobile-friendly).
   */
  function headerOnScrollCompact() {
    const header = $('.site-header');
    if (!header) return;

    const onScroll = () => {
      const scrolled = window.scrollY > 6;
      header.classList.toggle('is-scrolled', scrolled);
      document.body.classList.toggle('header-scrolled', scrolled);
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /**
   * A11y: add focus styles on touch (iOS Safari sometimes drops :focus-visible)
   */
  function a11yTouchFocus() {
    document.addEventListener('touchstart', e => {
      const btn = e.target.closest('button, a, [tabindex]');
      if (!btn) return;
      btn.classList.add('had-touch');
    }, { passive: true });
  }

  /**
   * Respect prefers-reduced-motion: avoid JS smooth-scroll if any is used later
   */
  function reduceMotionGuard() {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) {
      document.documentElement.style.scrollBehavior = 'auto';
    }
  }

  /**
   * External SVG <use> robustness:
   * Ensures `href` is set (not just xlink:href) and re-assigns to trigger Safari repaint.
   */
  function improveExternalUseHref() {
    $$('use').forEach(u => {
      const href = u.getAttribute('href') || u.getAttribute('xlink:href');
      if (href) {
        u.setAttribute('href', href);
      }
    });
  }

  /**
   * Tabbar labels: set title attr so truncated text shows full on long-press/hover.
   */
  function autoSetTabbarTitles() {
    $$('.tabbar__link').forEach(link => {
      const label = $('.tabbar__text', link);
      if (label && !link.title) link.title = label.textContent.trim();
    });
  }
})();
