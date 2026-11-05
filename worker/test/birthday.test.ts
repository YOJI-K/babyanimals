import test from 'node:test';
import assert from 'node:assert/strict';
import { inferBirthdayFromTitle, sanitizeTitleForBirthday, hasBirthContext } from '../src/birthday.ts';

test('掲載日を誕生日にしない（熊本レッサー型・回帰）', () => {
  const t = '【本邦初公開！】熊本市動植物園で生まれたレッサーパンダの赤ちゃん（2026年6月23日掲載）｜KKT NEWS NNN';
  assert.equal(inferBirthdayFromTitle(t, '2026-06-23T00:00:00Z'), null);
});
test('明示の誕生日は採用する', () => {
  assert.equal(inferBirthdayFromTitle('のんほいパーク ライオンの赤ちゃん 2025年8月17日生まれ', '2026-06-01T00:00:00Z'), '2025-08-17');
});
test('M月D日＋誕生文脈は公開年で補完', () => {
  assert.equal(inferBirthdayFromTitle('城山動物園でヤクシカが6月5日に誕生', '2026-06-22T00:00:00Z'), '2026-06-05');
});
test('未来日のM月D日は前年に調整', () => {
  assert.equal(inferBirthdayFromTitle('○○動物園で12月20日に誕生', '2026-06-25T00:00:00Z'), '2025-12-20');
});
test('誕生文脈のない日付は採用しない', () => {
  assert.equal(inferBirthdayFromTitle('特別展のお知らせ（2026年6月23日掲載）', '2026-06-23T00:00:00Z'), null);
});
test('齢ベースを最優先（掲載日に影響されない）', () => {
  assert.equal(inferBirthdayFromTitle('レッサーパンダ 5月27日（3日齢）の様子（2026年6月23日掲載）', '2026-06-23T00:00:00Z'), '2026-05-24');
});
test('sanitizeで掲載ブロックを除去', () => {
  assert.equal(/掲載/.test(sanitizeTitleForBirthday('赤ちゃん（2026年6月23日掲載）')), false);
});

test('hasBirthContext: 誕生動詞を検出', () => {
  assert.equal(hasBirthContext('オオアリクイの双子が誕生'), true);
  assert.equal(hasBirthContext('熊本で生まれたレッサーパンダ'), true);
  assert.equal(hasBirthContext('動物の赤ちゃんに会いに行こう'), false);
  assert.equal(hasBirthContext('赤ちゃんが話題'), false);
});

// --- 2026-11-05 総点検: 写真キャプションの「撮影日」を誕生日と誤読しない ---
test('撮影日を誕生日として採用しない（本文の実誕生日を採る）', () => {
  assert.equal(
    inferBirthdayFromTitle('アドベンチャーワールド5月29日に誕生したコガタペンギン（2026年8月3日撮影） - 和歌山経済新聞', '2026-08-10T00:00:00Z'),
    '2026-05-29',
  );
  assert.equal(
    inferBirthdayFromTitle('4月に生まれたツシマヤマネコの赤ちゃん（6月5日撮影、福岡市動物園提供）', '2026-06-24T00:00:00Z'),
    null,
  );
});
