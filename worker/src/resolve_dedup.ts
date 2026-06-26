// worker/src/resolve_dedup.ts
// F4(2026-06-25): NULL誕生日（実日付が取れない誕生）を拾う際の冪等・重複防止ヘルパー。
// 同一(zoo,species)の近接個体（NULL誕生日 or 直近作成）があれば作成せずリンクのみに回す。

export const NULL_BDAY_DEDUP_DAYS = 150;

export type ZooSpeciesIndex = Map<string, Array<{ id: string }>>;

export function zooSpeciesKey(zooId: string, species: string): string {
  return `${zooId}|${species}`;
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

// NULL誕生日で拾ってよい信頼できる出所か（公式サイト/プレスのみ。youtube/その他は除外）。
export function isTrustedBirthSource(sourceKind?: string | null): boolean {
  return sourceKind === 'site' || sourceKind === 'press';
}
