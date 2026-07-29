import test from 'node:test';
import assert from 'node:assert/strict';
import { addToZooSpeciesIndex, findRecentByZooSpecies, isTrustedBirthSource, speciesGroup, type ZooSpeciesIndex } from '../src/resolve_dedup.ts';

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
