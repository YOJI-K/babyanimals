import test from 'node:test';
import assert from 'node:assert/strict';
import { addToZooSpeciesIndex, findRecentByZooSpecies, isTrustedBirthSource, type ZooSpeciesIndex } from '../src/resolve_dedup.ts';

test('信頼ソース判定（site/pressのみ）', () => {
  assert.equal(isTrustedBirthSource('site'), true);
  assert.equal(isTrustedBirthSource('press'), true);
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
