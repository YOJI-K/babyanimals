// assets/js/app.js
// Global enhancements shared across pages (home / news / babies / calendar)

(() => {
  const $  = (sel, ctx = document) => ctx.querySelector(sel);
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
   * Normalize path:
   * - Resolve relative href to absolute URL
   * - Trim trailing slash and resolve to /index.html
   * - Collapse multiple slashes
   */
  function normalizePath(inputHref) {
    try {
      const abs = new URL(inputHref, location.href);
      let p = abs.pathname;

      // collapse duplicate slashes
      p = p.replace(/\/{2,}/g, '/');

      // if ends with '/', treat as '/index.html'
      if (p.endsWith('/')) p += 'index.html';

      return p;
    } catch {
      // fallback: best-effort string ops
      let p = String(inputHref || '');
      p = p.replace(/\/{2,}/g, '/');
      if (/\/$/.test(p)) p += 'index.html';
      return p;
    }
  }

  /**
   * Highlight active tabbar link based on current normalized path.
   * No page-specific hacks; works with ../ relative hrefs as well.
   */
  function setActiveTabbarLink() {
    const current = normalizePath(location.pathname);

    const links = $$('.tabbar .tabbar__link');
    if (!links.length) return;

    // clear all first
    links.forEach(a => {
      a.classList.remove('is-active');
      a.removeAttribute('aria-current');
    });

    // find exact match by normalized path
    let matched = null;
    for (const a of links) {
      const href = a.getAttribute('href');
      if (!href) continue;
      const target = normalizePath(href);
      if (target === current) {
        matched = a;
        break;
      }
    }

    // if nothing matched (e.g., top page variations), try a loose fallback:
    if (!matched) {
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        // home fallback: link to ../index.html or ./index.html when current is root index
        if (/(\.|\/)index\.html$/.test(href) && /\/index\.html$/.test(current)) {
          matched = a;
          break;
        }
      }
    }

    if (matched) {
      matched.classList.add('is-active');
      matched.setAttribute('aria-current', 'page');
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
    document.addEventListener(
      'touchstart',
      (e) => {
        const btn = e.target.closest('button, a, [tabindex]');
        if (!btn) return;
        btn.classList.add('had-touch');
      },
      { passive: true }
    );
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
    $$('use').forEach((u) => {
      const href = u.getAttribute('href') || u.getAttribute('xlink:href');
      if (href) u.setAttribute('href', href);
    });
  }

  /**
   * Tabbar labels: set title attr so truncated text shows full on long-press/hover.
   */
  function autoSetTabbarTitles() {
    $$('.tabbar__link').forEach((link) => {
      const label = $('.tabbar__text', link);
      if (label && !link.title) link.title = label.textContent.trim();
    });
  }
})();
