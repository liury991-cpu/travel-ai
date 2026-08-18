import { createClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // OAuth 回调带 ?code= 时自动换取 session
  },
});
