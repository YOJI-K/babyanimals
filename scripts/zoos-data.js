/**
 * scripts/zoos-data.js — どうベビ 動物園マスターデータ
 *
 * 掲載動物園の営業情報・アクセス・アフィリエイトURLを一元管理します。
 *
 * 【追加・更新の手順】
 * 1. 新しい動物園を追加する場合、このファイルに1エントリ追加してください
 * 2. 掲載内容の修正依頼が来た場合、該当 zoo の値を更新するだけで全ページに反映されます
 * 3. 変更後は `npm run build` もしくは `node scripts/ssg.js` を実行
 *
 * 【スキーマ】
 *   slug            URL用スラッグ（半角英数・ハイフン）/zoos/{slug}/
 *   db_name         Supabase zoos.name と完全一致させる（赤ちゃんデータ突合用）
 *   name            表示用の動物園名
 *   prefecture      都道府県（都道府県別グルーピング用）
 *   city            市区町村
 *   address         郵便番号＋住所（全文）
 *   nearest_station 最寄り駅・アクセス情報（複数行可・改行で区切り）
 *   hours           営業時間（複数行可）
 *   closed_days     休園日
 *   fees            入園料（複数行可）
 *   description     動物園の特徴紹介（120〜200文字程度／SEO description 兼用）
 *   official_url    公式サイトURL
 *   asoview_url     アソビューアフィリエイトURL（null = 非表示・公式URLへ誘導）
 *   hero_emoji      ヒーロー絵文字（写真がない場合のフォールバック）
 */

export const ZOOS = [
  // ── 東京 ─────────────────────────────────────────────────────────────
  {
    slug: 'ueno',
    db_name: '上野動物園',
    name: '恩賜上野動物園',
    prefecture: '東京都',
    city: '台東区',
    address: '〒110-8711 東京都台東区上野公園9-83',
    nearest_station: 'JR上野駅・公園口から徒歩5分\n東京メトロ銀座線・日比谷線 上野駅から徒歩12分',
    hours: '9:30〜17:00（入園は16:00まで）',
    closed_days: '月曜日（祝日の場合は翌日）、年末年始（12/29〜1/1）',
    fees: '一般 600円／中学生 200円／65歳以上 300円／小学生以下 無料',
    description: 'ジャイアントパンダをはじめ約300種の動物を飼育する日本最古の動物園。双子パンダ「シャオシャオ」「レイレイ」で話題に。',
    official_url: 'https://www.tokyo-zoo.net/zoo/ueno/',
    asoview_url: null,
    hero_emoji: '🐼',
  },
  {
    slug: 'tama',
    db_name: '多摩動物公園',
    name: '多摩動物公園',
    prefecture: '東京都',
    city: '日野市',
    address: '〒191-0042 東京都日野市程久保7-1-1',
    nearest_station: '京王線・多摩モノレール 多摩動物公園駅からすぐ',
    hours: '9:30〜17:00（入園は16:00まで）',
    closed_days: '水曜日（祝日の場合は翌日）、年末年始（12/29〜1/1）',
    fees: '一般 600円／中学生 200円／65歳以上 300円／小学生以下 無料',
    description: '52ヘクタールの広大な敷地で動物たちを自然に近い環境で観察できる動物園。ライオンバスやコアラ舎が人気。',
    official_url: 'https://www.tokyo-zoo.net/zoo/tama/',
    asoview_url: null,
    hero_emoji: '🦁',
  },
  // ── 北海道 ───────────────────────────────────────────────────────────
  {
    slug: 'asahiyama',
    db_name: '旭山動物園',
    name: '旭川市旭山動物園',
    prefecture: '北海道',
    city: '旭川市',
    address: '〒078-8205 北海道旭川市東旭川町倉沼',
    nearest_station: 'JR旭川駅から旭川電気軌道バス「旭山動物園」行きで約40分',
    hours: '夏期 9:30〜17:15／冬期 10:30〜15:30（時期により変動）',
    closed_days: '年末年始、春・秋の閉園期間あり（公式サイト要確認）',
    fees: '大人 1,000円／中学生以下 無料',
    description: '動物の行動や生態をいきいきと見せる「行動展示」の先駆け。ペンギンの散歩やホッキョクグマ館が国内外から注目される。',
    official_url: 'https://www.city.asahikawa.hokkaido.jp/asahiyamazoo/',
    asoview_url: null,
    hero_emoji: '🐧',
  },
  {
    slug: 'maruyama',
    db_name: '札幌市円山動物園',
    name: '札幌市円山動物園',
    prefecture: '北海道',
    city: '札幌市',
    address: '〒064-0959 北海道札幌市中央区宮ヶ丘3-1',
    nearest_station: '地下鉄東西線「円山公園駅」からバスで約5分、徒歩約15分',
    hours: '3〜10月 9:30〜16:30／11〜2月 9:30〜16:00',
    closed_days: '第2・第4水曜日（4・11月のみ全水曜日）、年末年始',
    fees: '大人 800円／高校生 400円／中学生以下 無料',
    description: '北海道屈指の歴史ある動物園。ゾウやホッキョクグマなど寒冷地に適した動物たちの飼育環境が充実。',
    official_url: 'https://www.city.sapporo.jp/zoo/',
    asoview_url: null,
    hero_emoji: '🐻‍❄️',
  },
  // ── 神奈川 ───────────────────────────────────────────────────────────
  {
    slug: 'zoorasia',
    db_name: 'ズーラシア',
    name: 'よこはま動物園ズーラシア',
    prefecture: '神奈川県',
    city: '横浜市',
    address: '〒241-0001 神奈川県横浜市旭区上白根町1175-1',
    nearest_station: '相鉄線 鶴ヶ峰駅・三ツ境駅、JR 中山駅からバスで約15分',
    hours: '9:30〜16:30（入園は16:00まで）',
    closed_days: '火曜日（祝日の場合は翌日）、年末年始（12/29〜1/1）',
    fees: '大人 800円／高校生 300円／小中学生 200円／小学生未満 無料',
    description: '世界の気候帯・地域別に動物を配置した約45ヘクタールの動物園。オカピなど希少動物に会える。',
    official_url: 'https://www.hama-midorinokyokai.or.jp/zoo/zoorasia/',
    asoview_url: null,
    hero_emoji: '🦒',
  },
  // ── 愛知 ─────────────────────────────────────────────────────────────
  {
    slug: 'higashiyama',
    db_name: '東山動植物園',
    name: '東山動植物園',
    prefecture: '愛知県',
    city: '名古屋市',
    address: '〒464-0804 愛知県名古屋市千種区東山元町3-70',
    nearest_station: '地下鉄東山線「東山公園駅」から徒歩3分',
    hours: '9:00〜16:50（入園は16:30まで）',
    closed_days: '月曜日（祝日の場合は直後の平日）、年末年始（12/29〜1/1）',
    fees: '大人 500円／中学生以下 無料',
    description: 'イケメンゴリラ「シャバーニ」で有名な、約500種の動物と約7,000種の植物を有する国内屈指の動植物園。',
    official_url: 'https://www.higashiyama.city.nagoya.jp/',
    asoview_url: null,
    hero_emoji: '🦍',
  },
  // ── 大阪 ─────────────────────────────────────────────────────────────
  {
    slug: 'tennoji',
    db_name: '天王寺動物園',
    name: '天王寺動物園',
    prefecture: '大阪府',
    city: '大阪市',
    address: '〒543-0063 大阪府大阪市天王寺区茶臼山町1-108',
    nearest_station: '地下鉄御堂筋線・堺筋線「動物園前駅」「天王寺駅」から徒歩約10分',
    hours: '9:30〜17:00（5・9月の土日祝は18:00まで）',
    closed_days: '月曜日（祝日の場合は翌日）、年末年始（12/29〜1/1）',
    fees: '大人 500円／小中学生 200円／未就学児 無料',
    description: '1915年開園の大阪を代表する都市型動物園。約180種の動物が飼育され、アフリカサバンナゾーンが人気。',
    official_url: 'https://www.tennojizoo.jp/',
    asoview_url: null,
    hero_emoji: '🦓',
  },
  // ── 兵庫 ─────────────────────────────────────────────────────────────
  {
    slug: 'kobe-oukoku',
    db_name: '神戸どうぶつ王国',
    name: '神戸どうぶつ王国',
    prefecture: '兵庫県',
    city: '神戸市',
    address: '〒650-0047 兵庫県神戸市中央区港島南町7-1-9',
    nearest_station: 'ポートライナー「計算科学センター（神戸どうぶつ王国・「富岳」前）駅」すぐ',
    hours: '平日 10:00〜16:00／土日祝 10:00〜17:00',
    closed_days: '木曜日（祝日・GW・春/夏/冬休みを除く）',
    fees: '大人 2,200円／小学生 1,200円／幼児（4・5歳）500円',
    description: '天候に左右されない全天候型動物園。動物との距離が近く、カピバラやハシビロコウの観察・ふれあいが楽しめる。',
    official_url: 'https://www.kobe-oukoku.com/',
    asoview_url: null,
    hero_emoji: '🦦',
  },
];

/** 都道府県別にグルーピングして返す（都道府県順を保持） */
export function groupByPrefecture(zoos) {
  const order = [];
  const map = new Map();
  for (const z of zoos) {
    if (!map.has(z.prefecture)) {
      order.push(z.prefecture);
      map.set(z.prefecture, []);
    }
    map.get(z.prefecture).push(z);
  }
  return order.map(pref => ({ prefecture: pref, zoos: map.get(pref) }));
}

/** db_name → zoo エントリの逆引き（赤ちゃんデータ突合用） */
export function zooByDbName(dbName) {
  return ZOOS.find(z => z.db_name === dbName) || null;
}

/** slug → zoo エントリ */
export function zooBySlug(slug) {
  return ZOOS.find(z => z.slug === slug) || null;
}

/** 既存 ZOO_AFFILIATE_MAP 形式で返す（後方互換） */
export function toAffiliateMap() {
  const map = {};
  for (const z of ZOOS) {
    map[z.db_name] = {
      official_url: z.official_url,
      asoview_url:  z.asoview_url,
      slug:         z.slug,
    };
  }
  return map;
}
