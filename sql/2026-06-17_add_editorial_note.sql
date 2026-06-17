-- 2026-06-17 赤ちゃん独自プロフィール本文カラム追加（AdSense対策B/C）
-- 目的: 自動生成テンプレに代えて、その子固有の一次情報ベースの本文を持たせる。
-- 安全: 追加のみ・NULL許容。未投入の間はSSGが従来テンプレにフォールバック。
ALTER TABLE babies ADD COLUMN IF NOT EXISTS editorial_note text;

COMMENT ON COLUMN babies.editorial_note IS '編集部が一次情報をもとに執筆した独自プロフィール本文。空欄時はSSGが自動生成文にフォールバック。改行で段落分け。';
