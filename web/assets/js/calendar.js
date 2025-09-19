/* =========================================================
 * Calendar UI Controller
 * - CSV（babies / news_items / sources）を貼り付けた場合は自動で解析
 * - 月替え、フィルタ（すべて/予定/実績）、当月の誕生日リスト表示
 * - カレンダー日付セルにドット（予定=ピンク / 実績=グレー）
 * --------------------------------------------------------- */

(function () {
  // ===== DOM Helpers =====
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  // ===== Elements (存在しない場合は安全に無視) =====
  const monthLabel = $("#monthLabel");
  const prevBtn = $("#prevMonth");
  const nextBtn = $("#nextMonth");
  const weekdayRow = $("#weekdayRow");
  const calendarGrid = $("#calendarGrid");
  const bdayList = $("#bdayList");
  const segmentedBtns = $$(".segmented__btn");
  const tabLinks = $$(".tabbar__link");

  // Hidden CSV textareas（任意配置）
  const csvBabiesEl = $("#csv-babies");
  const csvNewsEl = $("#csv-news_items");
  const csvSourcesEl = $("#csv-sources");

  // ===== State =====
  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth(); // 0-11
  let filter = "all"; // 'all' | 'future' | 'past'

  /** Data model
   * babies: [{ id, name, species, birthday(ISO yyyy-mm-dd), zoo_id, thumbnail_url }]
   * news:   [{ id, title, url, published_at, source_id, baby_id?, zoo_id? }]
   * sources:[{ id, title, url, published_at, ... }]
   */
  let DATA = {
    babies: [],
    news: [],
    sources: [],
  };

  // ===== CSV Parser =====
  function parseCSV(text) {
    if (!text || typeof text !== "string") return [];
    // 1) 行に分解（CRLF/CR対応）
    const rows = text
      .trim()
      .split(/\r?\n/)
      .filter((r) => r.trim().length > 0);

    if (rows.length <= 1) return [];

    // 2) ヘッダ抽出（カンマ区切り、ダブルクオート対応の簡易パーサ）
    const headers = splitCSVLine(rows[0]);

    // 3) レコード化
    const items = [];
    for (let i = 1; i < rows.length; i++) {
      const cols = splitCSVLine(rows[i]);
      const obj = {};
      headers.forEach((h, idx) => (obj[h.trim()] = (cols[idx] ?? "").trim()));
      items.push(obj);
    }
    return items;
  }

  function splitCSVLine(line) {
    const out = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // 連続ダブルクオート -> エスケープ
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  // ===== データ読込（CSVが無ければ空配列のまま）=====
  function loadDataFromCSV() {
    try {
      if (csvBabiesEl) {
        const babies = parseCSV(csvBabiesEl.value);
        DATA.babies = normalizeBabies(babies);
      }
      if (csvNewsEl) {
        DATA.news = parseCSV(csvNewsEl.value);
      }
      if (csvSourcesEl) {
        DATA.sources = parseCSV(csvSourcesEl.value);
      }
    } catch (e) {
      console.warn("CSV parse error:", e);
    }
  }

  function normalizeBabies(list) {
    return list
      .map((b) => {
        const birthday = safeDate(b.birthday);
        return {
          id: b.id || "",
          name: b.name || "",
          species: b.species || "",
          birthday: birthday ? fmtDateISO(birthday) : "",
          zoo_id: b.zoo_id || "",
          thumbnail_url: b.thumbnail_url || "",
          created_at: b.created_at || "",
        };
      })
      .filter((b) => Boolean(b.birthday));
  }

  // ===== Date Utils =====
  function safeDate(v) {
    if (!v) return null;
    // support "YYYY-MM-DD" or "YYYY-MM-DD hh:mm:ss+00"
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  function fmtDateISO(d) {
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, "0");
    const day = `${d.getDate()}`.padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function isSameDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }
  function startOfMonth(y, m) {
    return new Date(y, m, 1);
  }
  function endOfMonth(y, m) {
    return new Date(y, m + 1, 0);
  }
  function range(n) {
    return Array.from({ length: n }, (_, i) => i);
  }

  // ===== UI: Weekday Row =====
  function renderWeekday() {
    if (!weekdayRow) return;
    const labels = ["日", "月", "火", "水", "木", "金", "土"];
    weekdayRow.innerHTML = labels
      .map((w) => `<div class="calendar__cell--wk">${w}</div>`)
      .join("");
  }

  // ===== UI: Month Label =====
  function renderMonthLabel() {
    if (!monthLabel) return;
    monthLabel.textContent = `${viewYear}年 ${viewMonth + 1}月`;
  }

  // ===== Filtered Babies for view month =====
  function getBabiesInViewMonth() {
    const start = startOfMonth(viewYear, viewMonth);
    const end = endOfMonth(viewYear, viewMonth);
    return DATA.babies.filter((b) => {
      const d = safeDate(b.birthday);
      if (!d) return false;
      return d >= start && d <= end;
    });
  }

  function passFilterByDate(dateObj) {
    if (filter === "all") return true;
    const isFuture = dateObj > today && !isSameDay(dateObj, today);
    return filter === "future" ? isFuture : !isFuture || isSameDay(dateObj, today);
  }

  // ===== UI: Calendar Grid =====
  function renderCalendarGrid() {
    if (!calendarGrid) return;

    const first = startOfMonth(viewYear, viewMonth);
    const last = endOfMonth(viewYear, viewMonth);
    const firstWeekday = first.getDay(); // 0..6
    const daysInMonth = last.getDate();

    // 前月の埋め
    const prevTailCount = firstWeekday;
    const prevMonthLast = endOfMonth(viewYear, viewMonth - 1).getDate();

    const cells = [];

    // 前月セル
    for (let i = prevTailCount - 1; i >= 0; i--) {
      const d = new Date(viewYear, viewMonth - 1, prevMonthLast - i);
      cells.push(renderDayCell(d, true));
    }

    // 当月セル
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(renderDayCell(new Date(viewYear, viewMonth, d), false));
    }

    // 次月セル（合計を 6週=42セルで埋める）
    const total = cells.length;
    const nextCount = 42 - total;
    for (let i = 1; i <= nextCount; i++) {
      const d = new Date(viewYear, viewMonth + 1, i);
      cells.push(renderDayCell(d, true));
    }

    calendarGrid.innerHTML = cells.join("");
  }

  function renderDayCell(dateObj, isOut) {
    const y = dateObj.getFullYear();
    const m = dateObj.getMonth();
    const d = dateObj.getDate();

    // 当日の判定
    const todayFlag = isSameDay(dateObj, today);

    // 当日の誕生日ヒット数（フィルタ考慮）
    const babies = DATA.babies.filter((b) => {
      const bd = safeDate(b.birthday);
      if (!bd) return false;
      const hit = isSameDay(bd, dateObj);
      return hit && passFilterByDate(bd);
    });

    // ドット（future/past）最大2個まで（視認性のため）
    const dots = babies.slice(0, 4).map((b) => {
      const isFuture = safeDate(b.birthday) > today && !isSameDay(safeDate(b.birthday), today);
      return `<span class="dot ${isFuture ? "dot--future" : "dot--past"}" title="${b.name} (${b.species})"></span>`;
    });

    return `
      <div class="day ${isOut ? "is-out" : ""} ${todayFlag ? "is-today" : ""}" data-date="${fmtDateISO(dateObj)}">
        <span class="day__num">${d}</span>
        <div class="day__dots">${dots.join("")}</div>
      </div>
    `;
  }

  // ===== UI: Birthday List (右側リスト) =====
  function renderBirthdayList() {
    if (!bdayList) return;

    const babies = getBabiesInViewMonth()
      .filter((b) => passFilterByDate(safeDate(b.birthday)))
      .sort((a, b) => safeDate(a.birthday) - safeDate(b.birthday));

    if (babies.length === 0) {
      bdayList.innerHTML = `
        <div class="bday" aria-live="polite">
          <div class="bday__icon">🎈</div>
          <div class="bday__body">
            <p class="bday__name">該当データはありません</p>
            <p class="bday__meta">CSVを貼り付けるか、別のフィルタ/月をお試しください。</p>
          </div>
        </div>`;
      return;
    }

    bdayList.innerHTML = babies
      .map((b) => {
        const d = safeDate(b.birthday);
        const yyyy = d.getFullYear();
        const mm = `${d.getMonth() + 1}`.padStart(2, "0");
        const dd = `${d.getDate()}`.padStart(2, "0");
        const isFuture = d > today && !isSameDay(d, today);

        return `
          <article class="bday">
            <div class="bday__icon">🐾</div>
            <div class="bday__body">
              <h4 class="bday__name">${b.name || "名称未設定"} <small>(${b.species || "-"})</small></h4>
              <p class="bday__meta">${yyyy}年${mm}月${dd}日</p>
            </div>
            <div class="bday__right">
              <span class="badge ${isFuture ? "badge--plan" : "badge--done"}">
                ${isFuture ? "予定" : "実績"}
              </span>
              ${
                b.thumbnail_url
                  ? `<span class="bday__place"><a href="${b.thumbnail_url}" target="_blank" rel="noopener">画像</a></span>`
                  : ``
              }
            </div>
          </article>
        `;
      })
      .join("");
  }

  // ===== Event Handlers =====
  function onMonthChange(delta) {
    const next = new Date(viewYear, viewMonth + delta, 1);
    viewYear = next.getFullYear();
    viewMonth = next.getMonth();
    paint();
  }

  function onFilterClick(e) {
    const btn = e.currentTarget;
    const val = btn.dataset.filter || "all";
    filter = val;

    segmentedBtns.forEach((b) =>
      b.classList.toggle("is-selected", b.dataset.filter === filter)
    );
    paint();
  }

  function onTabClick(e) {
    const link = e.currentTarget;
    tabLinks.forEach((l) => l.classList.remove("is-active"));
    link.classList.add("is-active");
    // 実装対象が1ページ内のため画面切替処理は省略
  }

  // ===== Paint (再描画) =====
  function paint() {
    renderMonthLabel();
    renderCalendarGrid();
    renderBirthdayList();
  }

  // ===== Init =====
  function init() {
    loadDataFromCSV();
    renderWeekday();
    segmentedBtns.forEach((b) => b.addEventListener("click", onFilterClick));
    tabLinks.forEach((t) => t.addEventListener("click", onTabClick));
    if (prevBtn) prevBtn.addEventListener("click", () => onMonthChange(-1));
    if (nextBtn) nextBtn.addEventListener("click", () => onMonthChange(1));
    paint();
  }

  // DOM Ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
