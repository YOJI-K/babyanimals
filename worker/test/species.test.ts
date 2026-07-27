import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSpeciesAlias } from '../src/species.ts';

const sp = (t: string) => extractSpeciesAlias(t).species ?? null;

// --- 回帰防止：2文字の短い別名が長い語の一部に誤ヒットしないこと（2026-07-27） ---
// 「エキサイト」由来で存在しない「サイ」の赤ちゃんが実際に生成された事故の再発防止。
test('「エキサイト」を種サイと誤判定しない', () => {
  assert.equal(sp('日本モンキーセンターで赤ちゃん誕生 - Excite エキサイト'), null);
});
test('「公式サイト」を種サイと誤判定しない', () => {
  assert.equal(sp('赤ちゃん情報 - 平川動物公園公式サイト'), null);
});
test('「文字サイズ」を種サイと誤判定しない', () => {
  assert.equal(sp('文字サイズ・配色の変更'), null);
});
test('「サイズ発表」を種サイと誤判定しない', () => {
  assert.equal(sp('「ウシ科最大級」の赤ちゃんが誕生…規格外の大きさ・サイズ発表'), null);
});
test('「ゾウガメ」を種ゾウと誤判定しない', () => {
  assert.equal(sp('ゾウガメの赤ちゃんが孵化しました'), null);
});

// --- 正常系：本物の種名は今までどおり拾えること ---
test('本物の種名は従来どおり判定できる', () => {
  assert.equal(sp('サイの赤ちゃんが誕生しました'), 'サイ');
  assert.equal(sp('シロサイの赤ちゃんが誕生しました'), 'サイ');
  assert.equal(sp('アムールトラの赤ちゃん2頭が誕生'), 'トラ');
  assert.equal(sp('アジアゾウの赤ちゃんお披露目'), 'ゾウ');
  assert.equal(sp('コビトカバの赤ちゃん命名'), 'カバ');
});
