-- X 自動投稿の冪等化用：投稿済みタイムスタンプ。
-- NULL = 未投稿。投稿成功時に now() を記録し、同じ子を二度投稿しない。
ALTER TABLE babies ADD COLUMN IF NOT EXISTS x_posted_at timestamptz;
