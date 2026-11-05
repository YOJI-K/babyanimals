import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isNonBirthStory, otherFacilityReason, buildZooMatcher, zooNameVariants } from '../src/create_guard.ts';
import { extractSpeciesAlias } from '../src/species.ts';

// ---------------------------------------------------------------
// isNonBirthStory: 出生ではない「誕生」（2026-11-05 総点検の実データ）
// ---------------------------------------------------------------
test('誕生日会・誕生日イベントは出生扱いしない', () => {
  for (const t of [
    'アジアゾウ「ダンボ」が60歳の誕生日 静岡市・日本平動物園で来場者が祝福',
    'ボルネオゾウ「ふく」 ２８歳おめでとう タカオ福山動物園で誕生日イベント - 山陽新聞',
    'アジアゾウの誕生日会を実施します - 平川動物公園公式サイト',
    '【事前申込（抽選）制】 有料イベント「ホッキョクグマ誕生日イベント」を実施します',
    '【智光山公園こども動物園】10月・11月はコツメカワウソの誕生日が目白押し！総勢7頭のお誕生会を4回開催！',
    '10月・11月に計4回、コツメカワウソを祝う！智光山公園こども動物園 コツメカワウソのお誕生会',
    '1歳の誕生日迎えたマルミミゾウの赤ちゃん「アオ」 国内初出産から1年 ファンが祝福',
  ]) assert.equal(isNonBirthStory(t), true, t);
});

test('施設の「誕生」は出生扱いしない', () => {
  assert.equal(isNonBirthStory('動物園 2026.9.7 2027年春 自然環境を再現した「新・カワウソ施設」が誕生！'), true);
  assert.equal(isNonBirthStory('新エリア「アフリカの森」が誕生しました'), true);
});

test('本物の出生記事は通す（誤ブロック防止）', () => {
  for (const t of [
    'シセンレッサーパンダの赤ちゃんが生まれました！',
    'コビトカバの赤ちゃんが生まれました！',
    '姫センで35年ぶりに生まれたゾウ、来月には会えるかな…母・シューティーは昨夏インドから来園、母子ともに健康 - 読売新聞',
    '世界最小のシカ「プーズー」の赤ちゃん誕生 神戸どうぶつ王国で公開 [兵庫県] - 朝日新聞',
    '【動物情報】オカピの赤ちゃんが誕生しました！',
    'アメリカビーバーの赤ちゃんが誕生しました｜日立市公式ウェブサイト',
    'アドベンチャーワールドで10月28日に誕生したキタイワトビペンギン（写真提供＝アドベンチャーワールド、2026年10月28日撮影）',
    'シロテテナガザルの赤ちゃん誕生 親子で展示も開始 釧路市動物園での繁殖成功は初 北海道',
  ]) assert.equal(isNonBirthStory(t), false, t);
});

// ---------------------------------------------------------------
// otherFacilityReason: 園紐付きソースへの他園・海外・水族館記事の混入
// ---------------------------------------------------------------
const Z = [
  { id: 'morioka', name: '盛岡市動物公園', city: null },
  { id: 'morioka2', name: '盛岡市動物公園ZOOMO', city: null },
  { id: 'fukuoka', name: '福岡市動物園', city: null },
  { id: 'fukuoka2', name: '福岡市動植物園', city: null },
  { id: 'asa', name: '広島市安佐動物公園', city: null },
  { id: 'kushiro', name: '釧路市動物園', city: null },
  { id: 'obihiro', name: 'おびひろ動物園', city: '帯広市' },
  { id: 'adachi', name: '足立区生物園', city: null },
  { id: 'noichi', name: '高知県立のいち動物公園', city: null },
  { id: 'chiba', name: '千葉市動物公園', city: null },
  { id: 'himeji_cp', name: '姫路セントラルパーク', city: '姫路市' },
  { id: 'kobe_oukoku', name: '神戸どうぶつ王国', city: '神戸市' },
  { id: 'nihondaira', name: '静岡市立日本平動物園', city: null },
  { id: 'nihondaira2', name: '日本平動物園', city: null },
];
const M = buildZooMatcher(Z);

test('他園名だけが出る記事は other_zoo', () => {
  assert.equal(otherFacilityReason('「ちっちゃくて本当にかわいい」福岡市動物園でチンパンジーの赤ちゃん誕生　28年ぶり', 'morioka', M), 'other_zoo');
  assert.equal(otherFacilityReason('赤ちゃん4頭！初のチーター出産　広島市安佐動物公園 - Infoseek', 'morioka', M), 'other_zoo');
  assert.equal(otherFacilityReason('千葉市動物公園でマレーバクの赤ちゃん「カナタ」誕生 10日から一般公開', 'noichi', M), 'other_zoo');
  assert.equal(otherFacilityReason('シロテテナガザル赤ちゃん誕生 北海道の釧路市動物園一般公開', 'obihiro', M), 'other_zoo');
});

test('園名が無くても他園の自治体名だけが出る記事は other_zoo', () => {
  assert.equal(otherFacilityReason('【北海道 釧路市】開園以来初！シロテテナガザルの赤ちゃんが誕生しました - ニコニコニュース', 'obihiro', M), 'other_zoo');
});

test('「盛岡市動物公園」が一般名「動物公園」に縮退して全記事を自園扱いしない（回帰）', () => {
  assert.ok(!zooNameVariants('盛岡市動物公園').includes('動物公園'));
});

test('海外・水族館の記事', () => {
  assert.equal(otherFacilityReason('アメリカ・ワシントンの動物園でアジアゾウの赤ちゃん一般公開 名前は「リン・マイ」', 'adachi', M), 'overseas');
  assert.equal(otherFacilityReason('ゾウの赤ちゃん誕生を生配信、名前は「ズーム」 メキシコ - AFPBB News', 'adachi', M), 'overseas');
  assert.equal(otherFacilityReason('キングペンギンのヒナ"191g"で誕生 長崎ペンギン水族館で13年ぶり', 'adachi', M), 'aquarium');
  assert.equal(otherFacilityReason('ふ化した日の体重85グラム ジェンツーペンギンのひな誕生 おたる水族館', 'adachi', M), 'aquarium');
});

test('自園の記事・同一園の重複レコード・種名中の「アメリカ」は通す', () => {
  assert.equal(otherFacilityReason('アメリカビーバー誕生 日立・かみね動物園 茨城', 'adachi', M), null);
  assert.equal(otherFacilityReason('神戸どうぶつ王国でアメリカバクの赤ちゃん誕生', 'kobe_oukoku', M), null);
  assert.equal(otherFacilityReason('ツシマヤマネコの赤ちゃん誕生 福岡市動物園で4年ぶり', 'fukuoka2', M), null);
  assert.equal(otherFacilityReason('シロテテナガザルの赤ちゃん誕生 釧路市動物園で初', 'kushiro', M), null);
  assert.equal(otherFacilityReason('姫センで35年ぶりにゾウが誕生 赤ちゃんゾウが初公開／兵庫県', 'himeji_cp', M), null);
  assert.equal(otherFacilityReason('赤ちゃんゾウの名前つけて 姫セン、8月生まれのやんちゃな雌 母親の故郷インドの言葉で|姫路 - 神戸新聞', 'himeji_cp', M), null);
  assert.equal(otherFacilityReason('世界最小のシカ「プーズー」の赤ちゃん誕生 神戸どうぶつ王国で公開', 'kobe_oukoku', M), null);
  assert.equal(otherFacilityReason('アジアゾウの赤ちゃん 静岡市立日本平動物園', 'nihondaira2', M), null);
  assert.equal(otherFacilityReason('シセンレッサーパンダの赤ちゃんが生まれました！', 'kobe_oukoku', M), null);
});

test('園に紐付かないイベント（zoo_id=null）は判定しない', () => {
  assert.equal(otherFacilityReason('福岡市動物園でチンパンジーの赤ちゃん誕生', null, M), null);
});

// ---------------------------------------------------------------
// 実データ再生（2026-11-05 時点の babies に紐付く全 baby_events 344件）
//   合格基準: 誤登録(bad)の個体はどれも作成されない／本物(real)の個体は1件も「全イベントがブロック」にならない
//   resolve の他の足切り（RESOLVE_RECENT_DAYS=180日・種なし）も同じ条件で再現する
// ---------------------------------------------------------------
type Fx = {
  captured_at: string;
  zoos: Array<{ id: string; name: string; city: string | null }>;
  events: Array<{ baby: string; zoo: string; verdict: 'real' | 'bad'; title: string; zoo_id: string | null; species: string | null; published_at: string | null }>;
};
const fx: Fx = JSON.parse(readFileSync(new URL('./fixtures/replay_2026-11-05.json', import.meta.url), 'utf8'));
const FM = buildZooMatcher(fx.zoos);
const RECENT_MS = 180 * 86400_000;
const captured = Date.parse(fx.captured_at + 'T00:00:00Z');

// タイトルだけでは見分けられないと分かっている誤登録（古記事の再配信で、タイトルに年も他園名も無い）
const KNOWN_UNDETECTABLE = new Set(['b27db32c']); // 東武「ホワイトタイガー4頭誕生」(2013/2015年の記事の再配信)

function passes(e: Fx['events'][number]): boolean {
  // resolve の取得条件: 180日以内（ここでは「公開日が無い」も通す）
  if (e.published_at && captured - Date.parse(e.published_at) > RECENT_MS) return false;
  // 種: 現在の判定ロジックで再計算（カバ誤判定の解消を反映）
  const sp = extractSpeciesAlias(e.title || '').species ?? null;
  if (!sp) return false;
  if (isNonBirthStory(e.title)) return false;
  if (otherFacilityReason(e.title, e.zoo_id, FM)) return false;
  return true;
}

test('実データ再生: 誤登録の個体は作成されない', () => {
  const byBaby = new Map<string, boolean>();
  for (const e of fx.events.filter(x => x.verdict === 'bad')) {
    byBaby.set(e.baby, (byBaby.get(e.baby) || false) || passes(e));
  }
  const leaked = [...byBaby].filter(([b, ok]) => ok && !KNOWN_UNDETECTABLE.has(b)).map(([b]) => b);
  assert.deepEqual(leaked, []);
  assert.ok(byBaby.size >= 20, `bad babies in fixture: ${byBaby.size}`);
});

test('実データ再生: 本物の個体の誤ブロック 0（現存イベントの少なくとも1件は通る）', () => {
  const byBaby = new Map<string, { zoo: string; any: boolean; recentAny: boolean }>();
  for (const e of fx.events.filter(x => x.verdict === 'real')) {
    const recent = !e.published_at || captured - Date.parse(e.published_at) <= RECENT_MS;
    const cur = byBaby.get(e.baby) || { zoo: e.zoo, any: false, recentAny: false };
    cur.recentAny ||= recent;
    cur.any ||= passes(e);
    byBaby.set(e.baby, cur);
  }
  // 180日の足切り外（過去の命名記事などから手動登録された個体）は対象外。
  // 8053ad4d（岩手サファリパーク・トラ 2017年生）: 180日以内のイベントは「姫路セントラルパークのゾウ誕生」記事が
  //   誤ってリンクされたものだけ。これを弾くのは正しい（＝誤リンク防止が効いている）ので除外する。
  const MISLINKED_ONLY = new Set(['8053ad4d']);
  const blocked = [...byBaby].filter(([b, v]) => v.recentAny && !v.any && !MISLINKED_ONLY.has(b)).map(([b, v]) => `${b} ${v.zoo}`);
  assert.deepEqual(blocked, []);
});
