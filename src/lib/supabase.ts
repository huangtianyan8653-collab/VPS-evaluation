import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL_ENV_KEYS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PROJECT_URL'] as const;
const SUPABASE_ANON_ENV_KEYS = ['VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY'] as const;

function pickFirstNonEmptyEnvValue(
    source: Record<string, unknown>,
    keys: readonly string[]
): string {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return '';
}

const rawEnv = import.meta.env as Record<string, unknown>;
export const resolvedSupabaseUrl = pickFirstNonEmptyEnvValue(rawEnv, SUPABASE_URL_ENV_KEYS);
export const resolvedSupabaseAnonKey = pickFirstNonEmptyEnvValue(rawEnv, SUPABASE_ANON_ENV_KEYS);

export const isSupabaseConfigured = Boolean(resolvedSupabaseUrl && resolvedSupabaseAnonKey);

const MISSING_SUPABASE_CONFIG_MESSAGE = [
    '云端配置缺失：请在环境变量中补充 Supabase 连接参数。',
    `URL 可用键：${SUPABASE_URL_ENV_KEYS.join(' 或 ')}`,
    `KEY 可用键：${SUPABASE_ANON_ENV_KEYS.join(' 或 ')}`,
].join(' ');

if (!isSupabaseConfigured) {
    console.error(MISSING_SUPABASE_CONFIG_MESSAGE);
}

const fallbackUrl = 'http://127.0.0.1:54321';
const fallbackAnonKey = 'public-anon-key';

export const supabase = createClient(
    isSupabaseConfigured ? resolvedSupabaseUrl : fallbackUrl,
    isSupabaseConfigured ? resolvedSupabaseAnonKey : fallbackAnonKey
);

export function getSupabaseMissingConfigMessage() {
    return MISSING_SUPABASE_CONFIG_MESSAGE;
}

export function ensureSupabaseConfigured() {
    if (!isSupabaseConfigured) {
        throw new Error(MISSING_SUPABASE_CONFIG_MESSAGE);
    }
}
