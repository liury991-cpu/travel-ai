// GET /api/auth/callback?code=...  Supabase OAuth 回调（code → session）
// 说明：生产环境建议改用官方 @supabase/ssr 的 getSessionFromCookie/setSession，
// 这里用最精简的实现把 code 换成 session 并写回 cookie，便于前端维持登录。
import { createClient } from '@supabase/supabase-js';

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
};

export default async function handler(req: any, res: any) {
  const code = req.query?.code as string | undefined;
  if (!code) return res.status(400).json({ error: 'missing code' });

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
  );
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return res.status(500).json({ error: error.message });

  const session = data.session;
  if (session) {
    res.setHeader('Set-Cookie', [
      `sb-access-token=${session.access_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${session.expires_in}`,
      `sb-refresh-token=${session.refresh_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
    ]);
  }
  res.redirect('/');
}
