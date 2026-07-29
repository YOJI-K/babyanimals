import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSiteDate } from '../src/sitedate.ts';

// B-1(2026-07-29) 回帰テスト。
// 園公式サイトの一覧には過去数年分の誕生記事が並ぶ。日付が取れないと 180日足切りを
// 素通りし、古い誕生が「いまの赤ちゃん」として作成される（7/27〜28に39頭・うち22頭が誤り）。
const d = (h: string, u: string) => (extractSiteDate(h, u) || '').slice(0, 10) || null;

test('本文の「更新日：YYYY年M月D日」を拾う（円山動物園）', () => {
  assert.equal(d('<p>更新日：2023年4月29日</p>', 'https://www.city.sapporo.jp/zoo/topics/r5shimahukutannjyou.html'), '2023-04-29');
  assert.equal(d('更新日：2022年9月21日', 'https://www.city.sapporo.jp/zoo/topics/2022beniirofuramingo.html'), '2022-09-21');
  assert.equal(d('更新日：2024年6月9日', 'https://www.city.sapporo.jp/zoo/03doubutsu/asiazone/tenagazaru/2020127sirotetenaga.html'), '2024-06-09');
  assert.equal(d('更新日：2026年7月17日', 'https://www.city.sapporo.jp/zoo/03doubutsu/05asiazone/redpanda/r8/redpanda_delivery.html'), '2026-07-17');
});

test('和暦（令和N年M月D日）を西暦へ', () => {
  assert.equal(d('令和8年7月16日午前7時ごろ出産しました', 'https://example.jp/a.html'), '2026-07-16');
});

test('本文に日付が無ければURLから拾う', () => {
  assert.equal(d('本文なし', 'https://zoo.city.kyoto.lg.jp/zoo/news/20260714-84984.html'), '2026-07-14');
  assert.equal(d('本文なし', 'https://www.miyazaki-city-zoo.jp/news_t/20260602/'), '2026-06-02');
  assert.equal(d('本文なし', 'https://www.higashiyama.city.nagoya.jp/news/2026/06/post-1497.html'), '2026-06-01');
});

test('どこにも日付が無ければ null（＝site由来は resolve 対象外になる）', () => {
  assert.equal(d('なにもなし', 'https://example.jp/news/abc.html'), null);
});

test('あり得ない年は採用しない', () => {
  assert.equal(d('1998年5月1日', 'https://example.jp/news/abc.html'), null);
});
