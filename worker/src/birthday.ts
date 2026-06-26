// worker/src/birthday.ts
// 誕生日推定の純関数群（単体テスト可能に分離）。
// F1(2026-06-25): タイトル内の「掲載/配信/更新/公開」日付を誕生日として誤採用しない。

export function parseDateToISODateOnly(input?: string | null): string | null {
  if (!input) return null;
  const iso = input.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const jp = input.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (jp) {
    const y = Number(jp[1]);
    const m = String(Number(jp[2])).padStart(2,'0');
    const d = String(Number(jp[3])).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  const t = Date.parse(input);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }
  return null;
}

export function decideBirthdayByAge(title: string, fallbackISO?: string | null): string | null {
  const m = title.match(/(?<m>\d{1,2})月(?<d>\d{1,2})日（(?<age>\d{1,3})日齢）/);
  if (!m?.groups) return null;
  const pub = fallbackISO ? new Date(fallbackISO) : null;
  const nowY = new Date().getFullYear();
  const refY = pub ? pub.getFullYear() : nowY;
  const ref = new Date(refY, Number(m.groups.m) - 1, Number(m.groups.d));
  const refDate = (pub && ref.getTime() > pub.getTime()) ? pub : ref;
  refDate.setDate(refDate.getDate() - Number(m.groups.age));
  return refDate.toISOString().slice(0, 10);
}

// 掲載/配信/更新/公開 系の日付（記事メタ）を誕生日解析の前に除去する。
const PUB_PAREN_RE = /[（(][^（）()]*?(掲載|配信|更新|公開|時点)[^（）()]*?[）)]/g;
const PUB_DATE_RE  = /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*(掲載|配信|更新|公開|時点)/g;
const BIRTH_CONTEXT_RE = /(誕生|生まれ|産まれ|うまれ|出産|孵化|ふ化)/;

export function sanitizeTitleForBirthday(title: string | null | undefined): string {
  return (title || '').replace(PUB_PAREN_RE, ' ').replace(PUB_DATE_RE, ' ');
}

// タイトルから「実誕生日」を推定する。掲載日や文脈のない日付は採用しない（→ null）。
export function inferBirthdayFromTitle(title: string | null | undefined, publishedAt?: string | null): string | null {
  const raw = title || '';
  // 1) 齢ベース（最も信頼でき、掲載日と無関係）を最優先
  const byAge = raw ? decideBirthdayByAge(raw, publishedAt || null) : null;
  if (byAge) return byAge;
  // 2) 掲載/配信日を除去し、誕生文脈がある時のみ日付を誕生日として採用
  const cleaned = sanitizeTitleForBirthday(raw);
  if (!BIRTH_CONTEXT_RE.test(cleaned)) return null;
  const byTitle = parseDateToISODateOnly(cleaned);
  if (byTitle) return byTitle;
  // 3) 年なし「M月D日」→ 記事公開年で補完し、未来日なら前年に調整
  const m = cleaned.match(/(\d{1,2})月(\d{1,2})日/);
  if (m) {
    const pubDate = publishedAt ? new Date(publishedAt) : new Date();
    const candidate = new Date(pubDate.getFullYear(), Number(m[1]) - 1, Number(m[2]));
    if (candidate > pubDate) candidate.setFullYear(candidate.getFullYear() - 1);
    return candidate.toISOString().slice(0, 10);
  }
  return null;
}
