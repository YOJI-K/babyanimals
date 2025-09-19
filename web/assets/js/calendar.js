/**
 * 誕生日カレンダー（完成版）
 * - カレンダーの描画
 * - 月移動（前/次）
 * - 当月の誕生日リスト表示
 * - データは window.__BABIES__ があればそれを採用。無ければサンプルを利用。
 */

(() => {
  // -----------------------------
  // 1) データ取得（グローバルがあれば優先）
  // -----------------------------
  /** @type {Array<{id:string,name:string,species:string,birthday:string,thumbnail_url?:string,zoo?:string}>} */
  const FALLBACK_BABIES = [
    // ここは最小限のサンプル（必要に応じて置換可能）
    {
      id: "a1b2c3",
      name: "えみ",
      species: "レッサーパンダ",
      birthday: "2023-07-09",
      thumbnail_url: "https://www.nhdzoo.jp/wp-content/uploads/2023/12/redpanda-emi.jpg",
      zoo: "のいち動物公園"
    },
    {
      id: "b2c3d4",
      name: "たけのこ",
      species: "レッサーパンダ",
      birthday: "2024-06-14",
      thumbnail_url: "https://hamurazoo.jp/_res/projects/default_project/_page_/001/000/383/hamura_takenoko.jpg",
      zoo: "羽村市動物公園"
    },
    {
      id: "c3d4e5",
      name: "ミルク",
      species: "ホッキョクグマ",
      birthday: "2025-03-01",
      thumbnail_url: "https://www.city.asahikawa.hokkaido.jp/asahiyamazoo/images/polar-milk.jpg",
      zoo: "旭山動物園"
    },
    {
      id: "d4e5f6",
      name: "レオナ",
      species: "アムールトラ",
      birthday: "2024-05-02",
      thumbnail_url: "https://www.city.asahikawa.hokkaido.jp/asahiyamazoo/images/amur-leona.jpg",
      zoo: "旭山動物園"
    },
    {
      id: "e5f6g7",
      name: "おうき",
      species: "コアラ",
      birthday: "2024-06-12",
      thumbnail_url: "https://www.kobe-ojizoo.jp/wp-content/uploads/2025/03/koala-ooki.jpg",
      zoo: "神戸市立王子動物園"
    },
  ];

  const BABIES = Array.isArray(window.__BABIES__) && window.__BABIES__.length
    ? window.__BABIES__
    : FALLBACK_BABIES;

  // -----------------------------
  // 2) ユーティリティ
  // -----------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtMonthLabel = (y, m) => `${y}年${m}月`;

  const parseISO = (iso) => {
    // yyyy-mm-dd のみを想定（時刻付きは切り捨て）
    const [y, m, d] = iso.split("T")[0].split("-").map(Number);
    // ローカルタイムで厳密に扱う
    return new Date(y, m - 1, d);
  };

  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const toKey = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

  const startOfMonth = (y, m) => new Date(y, m, 1);
  const endOfMonth = (y, m) => new Date(y, m + 1, 0);
  const startOfCalendar = (date) => {
    const d = new Date(date.getFullYear(), date.getMonth(), 1);
    const day = d.getDay(); // 0:日〜6:土
    d.setDate(d.getDate() - day);
    return d;
  };
  const endOfCalendar = (date) => {
    const d = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const day = d.getDay();
    d.setDate(d.getDate() + (6 - day));
    return d;
  };

  // 当日（ローカル）の 0:00
  const today = new Date();
  const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // 誕生日を「月ごと」「日付ごと」に素早く引けるようにインデックス化
  const indexByMonthDay = (() => {
    /** @type {Record<string, Array<any>>} */
    const map = {};
    for (const b of BABIES) {
      if (!b.birthday) continue;
      const date = parseISO(b.birthday);
      const key = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`; // "MM-DD"
      (map[key] ||= []).push(b);
    }
    return map;
  })();

  // -----------------------------
  // 3) 描画処理
  // -----------------------------
  const monthLabelEl = $("#js-monthLabel");
  const monthLabelListEl = $("#js-monthLabelList");
  const gridEl = $("#js-calendarGrid");
  const listEl = $("#js-birthdayList");
  const prevBtn = $("#js-prevMonth");
  const nextBtn = $("#js-nextMonth");

  // 表示基準の年月
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth(); // 0-11

  const setMonthLabel = (y, m0) => {
    const label = fmtMonthLabel(y, m0 + 1);
    if (monthLabelEl) monthLabelEl.textContent = label;
    if (monthLabelListEl) monthLabelListEl.textContent = label;
    document.title = `動物園ベビー情報 | 誕生日カレンダー（${label}）`;
  };

  const getBirthdaysOn = (date) => {
    const k = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    return indexByMonthDay[k] || [];
  };

  const renderGrid = (y, m0) => {
    gridEl.innerHTML = "";

    const start = startOfCalendar(new Date(y, m0, 1));
    const end = endOfCalendar(new Date(y, m0, 1));
    const curMonthStart = startOfMonth(y, m0);
    const curMonthEnd = endOfMonth(y, m0);

    // 全セルを日付順に回す
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const cell = document.createElement("div");
      cell.className = "calendar__cell";
      const isOut = d < curMonthStart || d > curMonthEnd;
      if (isOut) cell.setAttribute("data-out", "1");

      // 日付ヘッダ
      const dateEl = document.createElement("div");
      dateEl.className = "date";
      dateEl.textContent = d.getDate();
      cell.appendChild(dateEl);

      // バッジ（その日に誕生日がある場合のみ）
      const babies = getBirthdaysOn(d);
      if (babies.length) {
        const badges = document.createElement("div");
        badges.className = "badges";
        const isFutureOrToday = d >= today0;
        const badge = document.createElement("span");
        badge.className = `badge ${isFutureOrToday ? "badge--future" : "badge--past"}`;
        badge.textContent = `誕生日 × ${babies.length}`;
        badges.appendChild(badge);
        cell.appendChild(badges);
      }

      // 当日の誕生日をリスト表示
      if (babies.length) {
        const ul = document.createElement("div");
        ul.className = "cell-list";
        babies.forEach((b) => {
          const item = document.createElement("div");
          item.className = "cell-item";

          const t = document.createElement("div");
          t.className = "thumb";
          const img = document.createElement("img");
          img.loading = "lazy";
          img.decoding = "async";
          img.src = b.thumbnail_url || "/assets/img/og.png";
          img.alt = `${b.name}（${b.species}）`;
          t.appendChild(img);

          const meta = document.createElement("div");
          const name = document.createElement("div");
          name.className = "name";
          name.textContent = b.name;
          const spec = document.createElement("div");
          spec.className = "spec";
          spec.textContent = `${b.species}${b.zoo ? ` @ ${b.zoo}` : ""}`;

          meta.appendChild(name);
          meta.appendChild(spec);

          item.appendChild(t);
          item.appendChild(meta);
          ul.appendChild(item);
        });
        cell.appendChild(ul);
      }

      gridEl.appendChild(cell);
    }
  };

  const renderList = (y, m0) => {
    listEl.innerHTML = "";

    // 当月の全日を走査して、当月該当のデータを収集
    const start = startOfMonth(y, m0);
    const end = endOfMonth(y, m0);
    /** @type {Array<{date: Date, items: any[]}>} */
    const perDay = [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const babies = getBirthdaysOn(d);
      if (babies.length) perDay.push({ date: new Date(d), items: babies });
    }

    if (!perDay.length) {
      const empty = document.createElement("p");
      empty.style.color = "var(--muted)";
      empty.textContent = "この月に誕生日の登録はありません。";
      listEl.appendChild(empty);
      return;
    }

    // 日付順にカードを作成
    perDay.forEach(({ date, items }) => {
      items.forEach((b) => {
        const card = document.createElement("article");
        card.className = "bcard";

        const th = document.createElement("div");
        th.className = "bcard__thumb";
        const img = document.createElement("img");
        img.loading = "lazy";
        img.decoding = "async";
        img.src = b.thumbnail_url || "/assets/img/og.png";
        img.alt = `${b.name}（${b.species}）`;
        th.appendChild(img);

        const body = document.createElement("div");
        const h = document.createElement("h3");
        h.className = "bcard__name";
        h.textContent = b.name;

        const meta = document.createElement("p");
        meta.className = "bcard__meta";
        const yyyy = date.getFullYear();
        const mm = pad2(date.getMonth() + 1);
        const dd = pad2(date.getDate());
        meta.textContent = `${yyyy}/${mm}/${dd}・${b.species}${b.zoo ? ` @ ${b.zoo}` : ""}`;

        body.appendChild(h);
        body.appendChild(meta);

        card.appendChild(th);
        card.appendChild(body);
        listEl.appendChild(card);
      });
    });
  };

  const renderAll = () => {
    setMonthLabel(viewYear, viewMonth);
    renderGrid(viewYear, viewMonth);
    renderList(viewYear, viewMonth);
  };

  // -----------------------------
  // 4) イベント
  // -----------------------------
  prevBtn?.addEventListener("click", () => {
    viewMonth -= 1;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear -= 1;
    }
    renderAll();
  });

  nextBtn?.addEventListener("click", () => {
    viewMonth += 1;
    if (viewMonth > 11) {
      viewMonth = 0;
      viewYear += 1;
    }
    renderAll();
  });

  // -----------------------------
  // 5) 初期描画（URLに年月があれば反映）
  //    例: /calendar/?y=2025&m=3
  // -----------------------------
  const params = new URLSearchParams(location.search);
  const yParam = parseInt(params.get("y") || "", 10);
  const mParam = parseInt(params.get("m") || "", 10);
  if (!Number.isNaN(yParam) && !Number.isNaN(mParam) && mParam >= 1 && mParam <= 12) {
    viewYear = yParam;
    viewMonth = mParam - 1;
  }

  // 「今日」にバッジを付けたい場合はここで class を追加する等も可能
  renderAll();
})();
