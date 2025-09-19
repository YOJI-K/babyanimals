// assets/js/news.js
(() => {
  let page = 1;
  const PAGE_SIZE = 12;
  let all = [];

  async function loadMock() {
    try {
      const res = await fetch("../assets/mock/news.json");
      return res.json();
    } catch (e) {
      console.error("Mock load failed", e);
      return [];
    }
  }

  async function loadSupabase() {
    const { URL, ANON } = window.SUPABASE || {};
    if (!URL || !ANON) throw new Error("Supabase config missing");

    const q = new URL(`${URL}/rest/v1/news_items`);
    q.searchParams.set(
      "select",
      "title,url,published_at,source_name,thumbnail_url,source_url"
    );
    q.searchParams.set("order", "published_at.desc,id.desc");
    q.searchParams.set("limit", "200");

    const res = await fetch(q.toString(), {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
    return res.json();
  }

  function filterAndSort() {
    const q = (document.getElementById("q").value || "").toLowerCase();
    const source = document.getElementById("source").value;
    const sort = document.getElementById("sort").value;

    let data = [...all];
    if (q) {
      data = data.filter(
        (x) =>
          (x.title || "").toLowerCase().includes(q) ||
          (x.source_name || "").toLowerCase().includes(q)
      );
    }

    if (source === "YouTube") {
      data = data.filter((x) =>
        (x.source_name || "").toLowerCase().includes("youtube")
      );
    } else if (source === "blog") {
      data = data.filter(
        (x) => !(x.source_name || "").toLowerCase().includes("youtube")
      );
    }

    data.sort((a, b) =>
      sort === "desc"
        ? new Date(b.published_at) - new Date(a.published_at)
        : new Date(a.published_at) - new Date(b.published_at)
    );

    return data;
  }

  function render() {
    const sk = document.getElementById("skeleton-news");
    const el = document.getElementById("list");
    const empty = document.getElementById("empty");

    if (!el) return;

    const data = filterAndSort();
    const slice = data.slice(0, page * PAGE_SIZE);

    // --- 描画 ---
    el.innerHTML = slice
      .map((x) => {
        const href = x.url || x.source_url || "#";
        const thumb = x.thumbnail_url || "../assets/img/noimage-16x9.png";
        const alt = x.title || x.source_name || "ニュース";
        const dateStr = Site.fmtDate(x.published_at);

        return `
        <a class="card" href="${href}" target="_blank" rel="noopener">
          <div class="thumb"><img src="${thumb}" loading="lazy" alt="${alt}"></div>
          <div class="pad">
            <h3 class="clamp-2">${x.title || "(no title)"}</h3>
            <div class="meta">${dateStr} ・ <strong>${Site.domain(href)}</strong></div>
            <div class="badge src">${x.source_name || ""}</div>
          </div>
        </a>`;
      })
      .join("");

    // --- UI状態更新 ---
    if (sk) sk.style.display = "none"; // 初期ロード終了後は非表示
    if (empty) empty.style.display = slice.length ? "none" : "block";
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const sk = document.getElementById("skeleton-news");
    if (sk) sk.style.display = "grid"; // 初回のみ表示

    try {
      all = await loadSupabase();
    } catch (e) {
      console.warn(e);
      all = await loadMock();
    }

    render();

    // --- イベント登録 ---
    document.getElementById("q").addEventListener("input", () => {
      page = 1;
      render();
    });
    document.getElementById("source").addEventListener("change", () => {
      page = 1;
      render();
    });
    document.getElementById("sort").addEventListener("change", () => {
      page = 1;
      render();
    });
    document.getElementById("more").addEventListener("click", () => {
      page++;
      render();
    });
  });
})();
