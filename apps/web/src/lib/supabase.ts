import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL;
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const LEGACY_SUPABASE_CONFIGURED = Boolean(rawUrl && rawKey);

const fallbackUrl = 'https://legacy-supabase-disabled.invalid';
const fallbackKey = 'legacy-supabase-disabled';

/**
 * Cliente Supabase legado mantido estritamente para compatibilidade
 * de inicialização de módulos legados pendentes de migração (Fases 2 a 13).
 * NÃO é autoridade de autenticação. A autoridade canônica é a API Fastify.
 */
export const supabase = createClient(
  rawUrl || fallbackUrl,
  rawKey || fallbackKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
