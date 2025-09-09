import { ingestAll } from './ingest';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  YOUTUBE_API_KEY?: string;
  YOUTUBE_CHANNEL_IDS?: string; // "UCxxx,UCyyy"
  RSS_SOURCES?: string; // '["https://example.com/feed.xml"]'
}

export default {
  async fetch(_req: Request, env: Env): Promise<Response> {
    // 手動実行用の簡易エンドポイント
    try {
      const result = await ingestAll(env);
      return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { "content-type": "application/json" } });
    } catch (e: any) {
      return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), { status: 500, headers: { "content-type": "application/json" } });
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    await ingestAll(env);
  },
};
