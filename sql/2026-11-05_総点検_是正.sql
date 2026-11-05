-- =====================================================================
-- 2026-11-05 総点検（再監査）是正SQL
--   対象: 2026-08-07 以降に作成された babies 40頭 ＋ 監査中に見つかった旧誤登録・重複
--   実行: Supabase SQL Editor（service role）で、まず [0] を単独実行 → 件数を控える →
--         [1]〜[7] をまとめて実行（1トランザクション。途中で失敗すれば全部ロールバック）→ [8] で差分確認
--   ※ 却下登録(baby_rejections)は、重複登録された園（盛岡・日本平・智光山・アフリカンサファリ・五月山）は
--     両方の zoo_id に入れる（片方だけだと Worker がもう一方の zoo_id で復活させる）。
--   ※ 却下の期限は 180日（= Worker の RESOLVE_RECENT_DAYS。誤記事がキューの対象外になるまで塞ぐ。
--     同じ園で本物の同種が生まれた場合に永久に塞がないため）
-- =====================================================================

-- [0] 実行前の件数（控えておく）
select
  (select count(*) from babies)                                   as babies,
  (select count(*) from babies where thumbnail_url is not null)  as babies_with_image,
  (select count(*) from baby_links)                               as links,
  (select count(*) from baby_rejections)                          as rejections;

begin;

-- 削除対象（22頭）
create temp table _del (id uuid primary key, reason text) on commit drop;
insert into _del values
  -- 8/7以降の誤登録（15）
  ('00b86f97-8a35-4580-a150-651fea938a0e', 'のいち マレーバク「カナタ」: 千葉市動物公園の記事。千葉に本物(9cb55dfd)あり'),
  ('faa1a0eb-58d1-47c6-92b6-9a2d9b26535e', '盛岡 チーター: 広島市安佐動物公園の記事。安佐に本物(436d73ce)あり'),
  ('595aa616-fbc3-4935-a3b2-b6b62a65ad94', '日本平 ゾウ: 「ダンボ」60歳の誕生日'),
  ('16eebeaa-f6e7-4bab-89a4-e8509dbfb48c', '足立区生物園 ゾウ: 米ワシントンの動物園'),
  ('53057244-5926-4f52-a397-a9abb97d1f0a', '足立区生物園 ペンギン: 長崎ペンギン水族館'),
  ('ec1d4bfa-3517-4fbd-8de6-92937480e9fe', '東武 カワウソ: 「新・カワウソ施設」が誕生（施設）'),
  ('dbb0dbc7-41d1-423f-8e71-98504947d1b8', 'おびひろ テナガザル: 釧路市動物園の記事'),
  ('cd35da5f-a210-4957-bfd4-f0d09991e074', '福山 ゾウ: 「ふく」28歳の誕生日イベント'),
  ('49a12e18-ddad-40cb-b710-1424ddd02939', '智光山 コツメカワウソ: お誕生会'),
  ('920b854e-bf9a-4c62-bd29-ffb861b9cd21', '群馬サファリ カバ: アメリカバイソンをカバと誤判定'),
  ('48c4b5ff-ce71-42ec-961f-15744f292d59', '大牟田 ツシマヤマネコ: 福岡市動物園の記事＋撮影日を誕生日と誤読。福岡に本物(0c3e37e9)あり'),
  ('7798e1d5-cc50-4a9e-b61f-562eac1bc6db', '埼玉こども コツメカワウソ: 智光山のお誕生会記事'),
  ('42e5fc4d-c073-481f-981c-cd5ad0138b02', '平川 ゾウ: アジアゾウの誕生日会'),
  ('7cc75199-d01c-436b-8188-e9a4d9c34cb6', '天王寺 ホッキョクグマ: 誕生日イベント'),
  ('b27db32c-cd87-40ae-ac8e-d35bcbdcaae4', '東武 ホワイトタイガー: 2013/2015年「4頭誕生」記事の再配信（2024年生ハク/コタとも別）'),
  -- 重複（2）
  ('f6555f24-1e22-4be1-b2a1-07bbef52f1d3', 'おびひろ エゾモモンガ: 12453ffe と重複'),
  ('cf03c007-1bfc-4f53-88ee-54bc69e584bb', '東武 アクシスジカ: 8d1f7c70 と重複'),
  -- 旧誤登録（5）
  ('0702af6e-3760-4695-a5e3-efe847ee49e8', '姫セン トラ「しばふ」: 2020年のチーター記事'),
  ('cbd0922a-0e84-4b80-bf83-ee2d4903173b', 'アフリカンサファリ ゾウ「ズーム」: メキシコの動物園(2020)'),
  ('e99bbd9b-df2b-4f29-9c53-449e478d67d0', '日本モンキーセンター ニホンザル: 淡路島モンキーセンターの記事'),
  ('44975ad3-be25-453c-8a1e-5075c0bb1603', '富山ファミリーパーク ペンギン: おたる水族館の記事'),
  ('eccb5cde-ca64-4f78-9a70-64587569056f', '五月山 ニホンザル「バンパク」: 高崎山の記事');

-- [1] 却下登録（復活防止）。重複zooは両方。重複レコード2件は本物が別にいるので却下しない。
insert into baby_rejections (zoo_id, species, expires_at)
select v.zoo_id::uuid, v.species, now() + interval '180 days'
from (values
  ('a05a6a7c-de75-4f02-8492-d927f937a833', 'マレーバク'),      -- のいち
  ('19eb647b-c530-4466-9b56-4c81eb3d23b0', 'チーター'),        -- 盛岡市動物公園
  ('4e3ffb2f-3e7d-49ae-8dea-322e20e7ecb2', 'チーター'),        -- 盛岡市動物公園ZOOMO（重複zoo）
  ('19eb647b-c530-4466-9b56-4c81eb3d23b0', 'チンパンジー'),    -- 盛岡（福岡の記事 → [3]で福岡へ付け替え）
  ('4e3ffb2f-3e7d-49ae-8dea-322e20e7ecb2', 'チンパンジー'),
  ('bffa9c5c-ac9b-4516-8eaa-bf8ae47d4280', 'ゾウ'),            -- 日本平動物園
  ('40e94baa-9f83-4081-9773-2e08c9816e45', 'ゾウ'),            -- 静岡市立日本平動物園（重複zoo）
  ('935b1ce0-16a8-4f5a-a498-bcf6a901dcad', 'ゾウ'),            -- 足立区生物園
  ('935b1ce0-16a8-4f5a-a498-bcf6a901dcad', 'ペンギン'),
  ('54473d9f-988f-48f8-a7ed-2c4070ea5977', 'カワウソ'),        -- 東武
  ('54473d9f-988f-48f8-a7ed-2c4070ea5977', 'ホワイトタイガー'),
  ('d056d624-9316-48ae-86e8-4c5df26fc5ba', 'テナガザル'),      -- おびひろ
  ('de3bb3d7-b180-46dc-a003-5a2a24d4fed0', 'ゾウ'),            -- 福山
  ('2dced1b7-8b2f-4e83-932b-cd323af61ae7', 'コツメカワウソ'),  -- 智光山公園こども動物園
  ('9674de04-f58a-4ce8-b1de-eb94f4d45f2a', 'コツメカワウソ'),  -- 狭山市立智光山公園こども動物園（重複zoo）
  ('7c8dbfd9-baa1-488f-86f7-b11adf252500', 'カバ'),            -- 群馬サファリ
  ('7c8dbfd9-baa1-488f-86f7-b11adf252500', 'カピバラ'),        -- 群馬サファリ（草津の記事 → [3]で草津へ付け替え）
  ('912340ca-9fbb-46cf-80de-2a378828340d', 'ツシマヤマネコ'),  -- 大牟田
  ('1d7f631e-8f1d-4324-830a-14f791b27344', 'コツメカワウソ'),  -- 埼玉こども
  ('a021caf6-3d74-4396-9a90-af25cc67479e', 'ゾウ'),            -- 平川
  ('431f4f43-b6a2-49ed-85b9-65ba9820cac0', 'ホッキョクグマ'),  -- 天王寺
  ('0276415b-768f-4f76-aa6d-ca3c435a8da6', 'トラ'),            -- 姫セン（しばふ）
  ('df166714-6ccc-4f3a-8334-01f6ed8f5aec', 'ゾウ'),            -- アフリカンサファリ（九州自然動物公園）
  ('84f8bc03-e03c-42fb-857d-3e642a4046e2', 'ゾウ'),            -- 九州自然動物公園アフリカンサファリ（重複zoo）
  ('4d55f07b-0207-4f74-935a-d2def860f543', 'ニホンザル'),      -- 日本モンキーセンター
  ('a6636936-0a41-4238-9218-e45b43cd7f8d', 'ペンギン'),        -- 富山ファミリーパーク
  ('a5f1065a-d10d-4a74-9e34-63c429968e94', 'ニホンザル'),      -- 五月山動物園
  ('09a80865-af0f-49e6-a867-7a8c77abc137', 'ニホンザル')       -- 池田市立五月山動物園（重複zoo）
) as v(zoo_id, species);

-- [2] 削除（リンク → 本体）
delete from baby_links where baby_id in (select id from _del);
delete from babies     where id      in (select id from _del);

-- [3] 他園の記事だが「本物の出生」なので、正しい園へ付け替える（2頭）
update babies set zoo_id = '13db19ed-6c24-4fae-aa83-dbcdd8d71380'   -- 福岡市動物園: チンパンジー 28年ぶり誕生(2026-08)
 where id = '1d08bc90-1baf-4689-a05f-43588911849f';
update babies set zoo_id = 'e6516c90-ff0e-4eee-8431-8e982ce2c6cc'   -- 草津熱帯圏: カピバラ4匹誕生(2026-04)
 where id = '09e56b8b-27b5-4428-9df8-1070f948556e';

-- [4] 判明した新情報の反映（12頭）
update babies set name = '桃香', name_status = 'confirmed'            -- 熊本 レッサーパンダ「桃香（もこ）」8/31決定
 where id = '3cf77773-8488-487a-93b0-8b6db02496a8';
update babies set birthday = '2026-09-03',                             -- ズーラシア オカピ 9/3生メス・愛称投票 11/9〜11/23
       naming_url = 'https://www.hama-midorinokyokai.or.jp/zoo/zoorasia/details/2026/post-558970.php',
       naming_deadline = '2026-11-23'
 where id = '4b5f24b1-0ab2-43bf-a9c8-aaaed671baf8';
update babies set birthday = '2026-07-10'                              -- 東山 シセンレッサーパンダ
 where id = '2e0310c2-8e8b-437f-ada5-5ee80119447b';
update babies set birthday = '2026-08-11'                              -- 東山 コビトカバ
 where id = 'bb124131-e8ad-4640-aefc-5994eec40167';
update babies set birthday = '2026-08-22'                              -- 姫セン アジアゾウ 8/22生メス
 where id = '8c804f9b-2f07-4eeb-802f-5303cfc871a8';
update babies set birthday = '2026-10-02'                              -- 神戸どうぶつ王国 プーズー 10/2生オス（2025-10-30 は公開日の誤読）
 where id = 'b5d9945d-5fc1-4277-ace4-4bc909decb2d';
update babies set birthday = '2026-08-17'                              -- かみね ビーバー 8/17生2頭（うち1頭 9/27死亡）
 where id = '575e484d-7c5c-49d8-8127-b9c796e251d5';
update babies set name = null, name_status = 'provisional'             -- とべ ジャガー:「募集します」が名前として誤登録
 where id = '65408493-2fa3-4f62-8af4-4fbbef7d72f4';
update babies set birthday = '2026-05-29'                              -- AW コガタペンギン 5/29生（8/3 は撮影日）
 where id = 'b1a0b43f-6172-4121-acb4-17db010bd8d1';
update babies set species = 'アメリカバク'                             -- 神戸どうぶつ王国: アメリカバクを「カバ」と誤判定
 where id = 'a4bfb4bd-2461-4c63-9849-3c14b9ba7afa';
update babies set name = 'イツハ', name_status = 'confirmed'           -- のいち グラントシマウマ: 2026-03-20 命名式で「イツハ」
 where id = '644b8618-67ff-42f1-a08b-26d51bf7cb40';
update babies set name = 'シュウマ', name_status = 'confirmed',        -- フェニックス マサイキリン: 2025-10-05生オス「シュウマ」（園発表）
       birthday = '2025-10-05'
 where id = '094bea88-b00c-4d11-a28b-d329ede66d5c';

-- [5] 誤リンクの解除（本物の個体に他園の記事が紐付いていたもの）
delete from baby_links l using baby_events e
 where l.event_id = e.id
   and l.baby_id = 'c5745990-406f-486b-804c-a254a10745e1'   -- 埼玉こども プーズー「イチハ」← 神戸どうぶつ王国の記事
   and e.title like '%神戸どうぶつ王国%';
delete from baby_links l using baby_events e
 where l.event_id = e.id
   and l.baby_id = '8053ad4d-7d00-4e7a-911e-a40ee8e4c2f9'   -- 岩手サファリ トラ「にリラ」← 姫路セントラルパークのゾウ誕生記事
   and e.title like '%姫路セントラルパーク%';

-- [6] 新規投入: 東山動植物園 コアラ「てんむす」（2026-01-10生）
insert into babies (name, name_status, species, birthday, zoo_id, display_status)
select 'てんむす', 'confirmed', 'コアラ', '2026-01-10', '76d94342-386c-4a64-a80e-e304d0d82774', 'public'
where not exists (
  select 1 from babies where zoo_id = '76d94342-386c-4a64-a80e-e304d0d82774' and species = 'コアラ' and name = 'てんむす'
);

-- [7] 巡回失敗ソースの修正
update sources set url = 'https://utsunomiya-zoo.com/news-list/'      -- 旧 /category/news/ は 404
 where id = '1cc45f6d-536c-40e9-b960-ab4ba32d2216';
update sources set url = 'http://www.tobezoo.com/tobenews/animalinfo/' -- https は証明書チェーン不備で取得失敗（http は 200）
 where id = '60acb327-d71e-4f8e-91b4-3358f42d3501';

commit;

-- [8] 実行後の件数（[0] との差分を確認）
--   期待値: babies -22 +1 = 127 / 画像あり -2 = 51（削除のうち画像ありは天王寺・平川の2頭） / rejections +28
select
  (select count(*) from babies)                                   as babies,
  (select count(*) from babies where thumbnail_url is not null)  as babies_with_image,
  (select count(*) from baby_links)                               as links,
  (select count(*) from baby_rejections)                          as rejections;
