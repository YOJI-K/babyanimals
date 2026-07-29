import test from 'node:test';
import assert from 'node:assert/strict';
import { addToZooSpeciesIndex, findRecentByZooSpecies, isTrustedBirthSource, speciesGroup, zooSpeciesKey, type ZooSpeciesIndex } from '../src/resolve_dedup.ts';

test('信頼ソース判定（site/press/googlenewsを許可・youtube除外）', () => {
  assert.equal(isTrustedBirthSource('site'), true);
  assert.equal(isTrustedBirthSource('press'), true);
  assert.equal(isTrustedBirthSource('googlenews'), true);
  assert.equal(isTrustedBirthSource('youtube'), false);
  assert.equal(isTrustedBirthSource('rss'), false);
  assert.equal(isTrustedBirthSource(null), false);
  assert.equal(isTrustedBirthSource(undefined), false);
});

test('同(zoo,species)はリンク先を返す＝二重作成防止', () => {
  const idx: ZooSpeciesIndex = new Map();
  addToZooSpeciesIndex(idx, 'zooA', 'レッサーパンダ', 'baby1');
  assert.equal(findRecentByZooSpecies(idx, 'zooA', 'レッサーパンダ'), 'baby1');
});

test('別zoo/別種/未登録は null（新規作成に回る）', () => {
  const idx: ZooSpeciesIndex = new Map();
  addToZooSpeciesIndex(idx, 'zooA', 'レッサーパンダ', 'baby1');
  assert.equal(findRecentByZooSpecies(idx, 'zooB', 'レッサーパンダ'), null);
  assert.equal(findRecentByZooSpecies(idx, 'zooA', 'オオアリクイ'), null);
  assert.equal(findRecentByZooSpecies(new Map(), 'zooA', 'レッサーパンダ'), null);
});

// B-2(2026-07-29): 種名の粒度が不統一でも重複判定が効くこと。
// 実害＝多摩の「トラ」と既存「アムールトラ」／神戸の「カバ」と既存「コビトカバ」／
//       円山の「レッサーパンダ」と「シセンレッサーパンダ」が二重登録された。
test('種グループで重複判定する（アムールトラ＝トラ／コビトカバ＝カバ）', () => {
  const idx: ZooSpeciesIndex = new Map();
  addToZooSpeciesIndex(idx, 'zooA', 'アムールトラ', 'baby1');
  assert.equal(findRecentByZooSpecies(idx, 'zooA', 'トラ'), 'baby1');
  addToZooSpeciesIndex(idx, 'zooB', 'コビトカバ', 'baby2');
  assert.equal(findRecentByZooSpecies(idx, 'zooB', 'カバ'), 'baby2');
  addToZooSpeciesIndex(idx, 'zooC', 'シセンレッサーパンダ', 'baby3');
  assert.equal(findRecentByZooSpecies(idx, 'zooC', 'レッサーパンダ'), 'baby3');
});

test('別種は取り違えない（レッサーパンダとジャイアントパンダ／トラとライオン）', () => {
  assert.equal(speciesGroup('シセンレッサーパンダ'), 'レッサーパンダ');
  assert.equal(speciesGroup('ジャイアントパンダ'), 'ジャイアントパンダ');
  assert.notEqual(speciesGroup('シセンレッサーパンダ'), speciesGroup('ジャイアントパンダ'));
  assert.notEqual(speciesGroup('アムールトラ'), speciesGroup('ライオン'));
  assert.equal(speciesGroup('オグロプレーリードッグ'), 'プレーリードッグ');
  assert.equal(speciesGroup('ツシマヤマネコ'), 'ヤマネコ');
  assert.equal(speciesGroup('エランド'), 'エランド');  // 該当なしは原文どおり
});

// B-4(2026-07-29): GoogleNews RSS の published_at が再配信で更新され、古い記事が
// 「最近の誕生」として流入する問題。実害＝2021年の「沖縄こどもの国 キリンのユメが出産」が
// published_at=2026-07-23 で入り、実在しない赤ちゃんが作られた。
// 「同じ(園・種グループ)に前年以前の誕生イベントがある」かつ「誕生日が取れない」を疑う。
test('過去年の誕生イベント索引は種グループで一致する（沖縄こどもの国のキリン）', () => {
  const stale = new Set<string>();
  stale.add(zooSpeciesKey('okinawa', 'アミメキリン'));   // 2021年の記事から積まれた想定
  // 2026年の再浮上記事は species='キリン' と粗く付くが、同一グループとして照合できること
  assert.equal(stale.has(zooSpeciesKey('okinawa', 'キリン')), true);
  // 別の園・別の種は巻き込まない
  assert.equal(stale.has(zooSpeciesKey('chiba', 'キリン')), false);
  assert.equal(stale.has(zooSpeciesKey('okinawa', 'ジャガー')), false);
});
