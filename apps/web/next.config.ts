import type { NextConfig } from 'next'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'))

function resolveGitHash(): string {
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

const nextConfig: NextConfig = {
  output: 'export',
  transpilePackages: ['@line-crm/shared'],
  env: {
    APP_VERSION: pkg.version,
    GIT_HASH: resolveGitHash(),
  },
}
export default nextConfig
