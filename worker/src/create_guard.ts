// worker/src/create_guard.ts
// baby 作成（resolve）前の「これは本当に、この園での出生記事か？」ゲート。純関数のみ・単体テスト可能。
//
// 2026-11-05 総点検で判明した誤登録パターン（8/7以降の自動作成 40頭中 17頭が誤り）への恒久対策:
//   1) 「誕生日会」「誕生日イベント」「◯歳の誕生日」を出生扱い（日本平・福山・平川のゾウ、天王寺のホッキョクグマ、
//      智光山のコツメカワウソ ほか）
//   2) 「新施設が誕生」など、動物ではない「誕生」（東武の新カワウソ施設）
//   3) 園に紐付いた GoogleNews 検索ソースに、他園・海外・水族館の記事が混入
//      （盛岡←福岡市動物園のチンパンジー、のいち←千葉市動物公園のマレーバク、足立区生物園←米ワシントン/長崎ペンギン水族館 ほか）
// resolve はタイトルしか持たない（本文は取得していない）ため、判定はタイトル（＋URL）ベース。

// ---------------------------------------------------------------
// 1) 出生ではない「誕生」
// ---------------------------------------------------------------
const NON_BIRTH_PATTERNS: RegExp[] = [
  // 誕生日の祝い事（出生そのものではない）
  /誕生日(会|祝い|祭|イベント|パーティ|パーティー|ケーキ|プレゼント|ガイド|記念)/,
  /お?誕生会/,
  /バースデー/,
  /\d{1,3}\s*(歳|才|周年)\s*(の|を迎え|おめでとう)?.{0,6}(誕生日|お祝い|おめでとう)/,
  /(歳|才)の誕生日/,
  /誕生日を(迎え|祝)/,
  /誕生記念(イベント|日)/,
  // 施設・エリア・企画の「誕生」
  /(施設|エリア|ゾーン|ひろば|広場|展示場|展示舎|獣舎|飼育舎|ハウス|ドーム|コーナー|ショップ|カフェ|レストラン|スポット|フォトスポット|キャラクター|グッズ|メニュー|プラン|ツアー)[」』】"]?\s*(が|も)?\s*(新たに)?\s*(誕生|オープン|登場)/,
  /新(しい)?(施設|エリア|ゾーン|展示)/,
];

/** タイトルが「出生」ではない誕生（誕生日会・施設の誕生など）を指すなら true */
export function isNonBirthStory(title?: string | null): boolean {
  const t = title || '';
  if (!t) return false;
  return NON_BIRTH_PATTERNS.some(re => re.test(t));
}

// ---------------------------------------------------------------
// 2) 別施設（他園・海外・水族館）の記事
// ---------------------------------------------------------------
export type ZooName = { id: string; name: string; city?: string | null };

function normalize(s: string): string {
  return (s || '')
    .replace(/\s+/g, '')
    .replace(/[【】「」『』\[\]\(\)（）・、，,．。!！?？：:；;〈〉<>]/g, '')
    .toLowerCase();
}
function stripParens(s: string): string {
  return (s || '').replace(/[（(［\[][^）)\]］]*[）)\]］]/g, '');
}
const GENERIC_ZOO_WORD = /^(動物園|動植物園|動物公園|自然動物園|自然動物公園|動物自然公園|こども動物園|こども動物公園|子供動物園|小動物園|ファミリーパーク|サファリパーク|サファリランド|どうぶつえん|ズー|zoo)$/;

/** 園名・所在地から「◯◯市」等の自治体名（3文字以上）を取り出す */
export function zooCities(z: ZooName): string[] {
  const set = new Set<string>();
  const m1 = stripParens(z.name || '').match(/^(.{2,4}?(市|区))(?!立)/);
  if (m1) set.add(m1[1]);
  const m2 = (z.city || '').match(/^(.{2,4}?(市|区|町|村))/);
  if (m2) set.add(m2[1]);
  return Array.from(set).filter(c => c.length >= 3);
}

/** 園名の照合用の表記ゆれ（4文字以上のみ）。 */
export function zooNameVariants(name: string): string[] {
  const set = new Set<string>();
  const add = (v: string) => { const n = normalize(v); if (n.length >= 4) set.add(n); };
  add(name);
  add(stripParens(name));
  // 括弧内の正式名（例: 「のんほいパーク（豊橋総合動植物公園）」）
  for (const m of (name || '').matchAll(/[（(]([^）)]+)[）)]/g)) add(m[1]);
  // 「市立」「県立」等を外した形（静岡市立日本平動物園 → 静岡日本平動物園 / 日本平動物園）
  const noPub = stripParens(name).replace(/(都|道|府|県|市|区|町|村)立/g, '');
  add(noPub);
  // 自治体名を外した形（のいち動物公園 等の通称に当てるため）。ただし「動物公園」のような
  // 一般名詞だけが残る場合は採用しない（2026-11-05: 盛岡市動物公園→「動物公園」で全記事が自園扱いになった）
  const noPref = noPub.replace(/^.{1,4}?(都|道|府|県|市|区|町|村)(?=.{4,})/, '');
  if (noPref !== noPub && !GENERIC_ZOO_WORD.test(normalize(noPref))) add(noPref);
  return Array.from(set);
}
/** 園の「中核名」：重複登録された同一園（福岡市動物園／福岡市動植物園 など）を同一視するため */
function zooCore(name: string): string {
  return normalize(stripParens(name).replace(/(都|道|府|県|市|区|町|村)立/g, '').replace(/動植物園/g, '動物園'));
}

export type ZooMatcher = {
  /** zoo_id → その園（および同一園の重複レコード）の表記ゆれ */
  own: Map<string, string[]>;
  /** すべての園の表記ゆれ（長い順） */
  all: Array<{ id: string; v: string }>;
  /** zoo_id → 自園（＋重複レコード）の自治体名 */
  ownCities: Map<string, Set<string>>;
  /** 自治体名 → その自治体にある園の id 群 */
  cityZoos: Map<string, Set<string>>;
};

export function buildZooMatcher(zoos: ZooName[]): ZooMatcher {
  const cores = zoos.map(z => ({ id: z.id, core: zooCore(z.name), variants: zooNameVariants(z.name), cities: zooCities(z) }));
  const own = new Map<string, string[]>();
  const ownCities = new Map<string, Set<string>>();
  const cityZoos = new Map<string, Set<string>>();
  for (const c of cores) for (const city of c.cities) {
    if (!cityZoos.has(city)) cityZoos.set(city, new Set());
    cityZoos.get(city)!.add(c.id);
  }
  for (const a of cores) {
    const vs = new Set(a.variants);
    const cs = new Set(a.cities);
    for (const b of cores) {
      if (b.id === a.id || !a.core || !b.core) continue;
      // 同一園の重複レコード（中核名が一致／一方が他方を含む）は自園扱い
      if (a.core === b.core || a.core.includes(b.core) || b.core.includes(a.core)) {
        for (const v of b.variants) vs.add(v);
        for (const c of b.cities) cs.add(c);
      }
    }
    own.set(a.id, Array.from(vs));
    ownCities.set(a.id, cs);
  }
  const all: Array<{ id: string; v: string }> = [];
  for (const c of cores) for (const v of c.variants) all.push({ id: c.id, v });
  all.sort((x, y) => y.v.length - x.v.length);
  return { own, all, ownCities, cityZoos };
}

// 海外の地名・国名（「アメリカビーバー」「アメリカバク」等の種名に含まれるアメリカは除外）
const OVERSEAS_RE = /(アメリカ(?![ァ-ヶー])|米国|米・|米[^ぁ-んァ-ヶー国]?(ワシントン|カリフォルニア|ニューヨーク|サンディエゴ)|ワシントン|ニューヨーク|サンディエゴ|メキシコ|カナダ(?![ァ-ヶー])|イギリス|英国|ロンドン|フランス|ドイツ|チェコ|オランダ|ベルギー|スペイン|イタリア|ヨーロッパ|欧州|中国・|中国の|四川省|成都|台湾|台北|韓国|ソウル|タイ・|タイの|バンコク|シンガポール|インドネシア|マレーシア|オーストラリアの|豪州|ニュージーランド|南アフリカ|海外)/;
// 動物園でない飼育施設（このサイトは動物園の赤ちゃんを扱う）
const AQUARIUM_RE = /(水族館|アクアリウム|シーパラダイス|マリンパーク|海遊館)/;

export type OtherFacilityReason = 'other_zoo' | 'overseas' | 'aquarium';

/**
 * 園に紐付いたソース（ev.zoo_id あり）の記事が、実は別の施設の話なら理由を返す（null＝自園の記事とみなせる）。
 * - タイトルに自園名が出ず、他園名が出る → other_zoo
 * - 海外の地名・国名 → overseas（自園名が出ていても「海外の園から来た親」程度ならあり得るため、自園名なし時のみ）
 * - 水族館 → aquarium（自園自体が水族館名を含む場合を除く）
 */
export function otherFacilityReason(
  title: string | null | undefined,
  ownZooId: string | null | undefined,
  m: ZooMatcher,
): OtherFacilityReason | null {
  if (!ownZooId) return null;
  const t = normalize(title || '');
  if (!t) return null;
  const ownVariants = m.own.get(ownZooId) || [];
  const mentionsOwn = ownVariants.some(v => t.includes(v));
  if (!mentionsOwn) {
    for (const { id, v } of m.all) {
      if (id === ownZooId) continue;
      if (ownVariants.includes(v)) continue;           // 同一園の重複レコード
      if (ownVariants.some(o => o.includes(v))) continue; // 自園名の一部（例: 自園「東山動植物園」に対する短い別名）
      if (t.includes(v)) return 'other_zoo';
    }
    // 園名は出ないが、他園の所在自治体だけが出る（例: 「【北海道 釧路市】開園以来初！…」がおびひろ動物園に混入）
    const mine = m.ownCities.get(ownZooId) || new Set<string>();
    const mentionsOwnCity = Array.from(mine).some(c => t.includes(normalize(c)));
    if (!mentionsOwnCity) {
      for (const [city] of m.cityZoos) {
        if (mine.has(city)) continue;
        if (Array.from(mine).some(c => c.includes(city) || city.includes(c))) continue;
        if (t.includes(normalize(city))) return 'other_zoo';
      }
    }
    if (OVERSEAS_RE.test(title || '')) return 'overseas';
  }
  if (AQUARIUM_RE.test(title || '') && !ownVariants.some(v => AQUARIUM_RE.test(v))) return 'aquarium';
  return null;
}

export function isOtherFacilityStory(
  title: string | null | undefined,
  ownZooId: string | null | undefined,
  m: ZooMatcher,
): boolean {
  return otherFacilityReason(title, ownZooId, m) !== null;
}
