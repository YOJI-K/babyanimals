# どうベビ (babyanimals) — Claude 作業メモ

## ブランチ・プッシュ規則
- 作業ブランチ: `claude/redesign-zoo-theme-chzhf`
- **プッシュ先は常に `main`** (`git push -u origin main`)

## プロジェクト構成
- ホスティング: Cloudflare Pages (`web/` ディレクトリをルートに配信)
- SSG: `scripts/ssg.js` (Node.js、フレームワークなし)
  - Supabase からデータ取得 → `web/` 以下に静的 HTML 生成
  - `--mock` フラグで3件のデモデータで動作（**本番ファイルを上書きするので注意**）
  - GitHub Actions (`.github/workflows/ssg-rebuild.yml`) が毎日 JST 06:00 に実行
- DB: Supabase (URL / ANON KEY は ssg.js 内にハードコード済み)

## SSG マーカーパターン
HTML に `<!--SSG:セクション名:start-->内容<!--SSG:セクション名:end-->` を埋め込み、
`ssg.js` の `patchSection(html, name, content)` で冪等に差し替える。
現在マーカーが入っているセクション:
- `index.html`: `recent` (新着赤ちゃん)、`news` (ニュースプレビュー)
- `calendar/index.html`: `cal-title`、`cal-grid`、`cal-month-label`、`cal-list`
- `_redirects`: `UUID-redirects` (UUID→slug の 301 リダイレクト 51 件)

## URL 設計
- 個別ページ URL: `/babies/{slug}/` (日本語スラッグ、例: `タオ-アジアゾウ-円山動物園`)
- UUID ページ: 301 リダイレクトスタブとして残存 (`_redirects` で管理)
- スラッグマップ: `web/assets/data/baby-slugs.json`

## 主要ファイル
| ファイル | 役割 |
|---|---|
| `scripts/ssg.js` | SSG 本体。slug 生成・HTML パッチ・リダイレクト更新 |
| `web/assets/js/app.js` | トップページ JS |
| `web/assets/js/babies.js` | 赤ちゃん一覧・詳細ページ JS |
| `web/assets/js/news.js` | ニュース一覧 JS |
| `web/assets/css/style.css` | 全ページ共通スタイル |
| `web/_redirects` | Cloudflare Pages リダイレクト設定 |

## 直近の作業履歴
- `ed3bcf4`: 詳細ページの画像高さを `aspect-ratio:1/1` に修正
- `36ceb83`: news.js — NEWバッジをカテゴリバッジ（誕生/お知らせ等）に変更
- `9615dba`: SEO 改修 ①UUID 301リダイレクト ②トップSSG化 ③カレンダーSSG化
