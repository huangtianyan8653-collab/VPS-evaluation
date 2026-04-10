import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const URL_ENV_KEYS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PROJECT_URL']
const ANON_ENV_KEYS = ['VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY']

function hasAnyConfiguredKey(env: Record<string, string>, keys: string[]): boolean {
  return keys.some((key) => typeof env[key] === 'string' && env[key].trim().length > 0)
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  if (command === 'build') {
    const hasSupabaseUrl = hasAnyConfiguredKey(env, URL_ENV_KEYS)
    const hasSupabaseAnonKey = hasAnyConfiguredKey(env, ANON_ENV_KEYS)

    if (!hasSupabaseUrl || !hasSupabaseAnonKey) {
      throw new Error(
        [
          'Supabase 环境变量缺失，已阻止构建（避免发布空白/不可用页面）。',
          `URL 可用键：${URL_ENV_KEYS.join(' 或 ')}`,
          `KEY 可用键：${ANON_ENV_KEYS.join(' 或 ')}`,
          '请在 Vercel Project Settings -> Environment Variables 补齐后重新部署。',
        ].join('\n')
      )
    }
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
  }
})
