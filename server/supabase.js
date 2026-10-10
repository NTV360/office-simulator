import { createClient } from '@supabase/supabase-js';

// The server's Supabase client. It uses the secret (service role) key, which bypasses Row Level Security,
// so it must only ever exist here, never in browser code. Returns null when Supabase is not configured,
// and the API answers 503 instead of crashing (so the app still runs locally without credentials).
function makeSupabase(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return null;
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export { makeSupabase };
