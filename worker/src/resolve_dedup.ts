// worker/src/resolve_dedup.ts
// F4(2026-06-25): NULL誕生日（実日付が取れない誕生）を拾う際の冪等・重複防止ヘルパー。
// 同一(zoo,species)の近接個体（NULL誕生日 or 直近作成）があれば作成せずリンクのみに回す。

export const NULL_BDAY_DEDUP_DAYS = 150;

export type ZooSpeciesIndex = Map<string, Array<{ id: string }>>;

// B-2(2026-07-29): 種名の粒度が不統一（「トラ」と「アムールトラ」、「カバ」と「コビトカバ」、
// 「レッサーパンダ」と「シセンレッサーパンダ」）だと (zoo,species) の重複判定をすり抜け、
// 同一個体が二重登録される。実害＝多摩のアムールトラ／神戸のコビトカバ／ズーラシアのオオアリクイ。
// → 末尾一致する総称へ寄せた「種グループ」で判定する。
const SPECIES_GROUP_BASES = [
  'レッサーパンダ', 'ジャイアントパンダ', 'プレーリードッグ', 'オランウータン', 'ナマケモノ',
  'テナガザル', 'カンガルー', 'フクロウ', 'フラミンゴ', 'ペンギン', 'カワウソ', 'ビーバー',
  'アシカ', 'アザラシ', 'キリン', 'ハイラックス', 'マンドリル', 'カピバラ', 'アリクイ',
  'トラ', 'ライオン', 'ヒョウ', 'クマ', 'ゾウ', 'カバ', 'サイ', 'シカ', 'サル', 'バク',
  'ヤマネコ', 'オオカミ'
];

export function speciesGroup(species: string): string {
  const s = (species || '').trim();
  if (!s) return s;
  // 最長一致を優先（「レッサーパンダ」を「パンダ」より先に拾う）
  let best = '';
  for (const base of SPECIES_GROUP_BASES) {
    if (s.endsWith(base) && base.length > best.length) best = base;
  }
  return best || s;
}

export function zooSpeciesKey(zooId: string, species: string): string {
  return `${zooId}|${speciesGroup(species)}`;
}

export function addToZooSpeciesIndex(idx: ZooSpeciesIndex, zooId: string, species: string, id: string): void {
  const k = zooSpeciesKey(zooId, species);
  if (!idx.has(k)) idx.set(k, []);
  idx.get(k)!.push({ id });
}

export function findRecentByZooSpecies(idx: ZooSpeciesIndex, zooId: string, species: string): string | null {
  const arr = idx.get(zooSpeciesKey(zooId, species));
  return arr && arr.length ? arr[0].id : null;
}

// NULL誕生日で拾ってよい出所か。公式サイト/プレス/Googleニュースを許可し、
// youtube（継続シリーズのノイズが多い）と不明は除外する。
// ※出所だけでは精度不足のため、呼び出し側で「誕生動詞＋種＋園の確定」を併用する。
export function isTrustedBirthSource(sourceKind?: string | null): boolean {
  return sourceKind === 'site' || sourceKind === 'press' || sourceKind === 'googlenews';
}
