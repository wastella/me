import { fileURLToPath } from 'node:url';
import path from 'node:path';
/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  output: 'standalone',
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  // libSQL loads a platform-specific native module at runtime, which the
  // bundler can't see; ship whichever one is installed (mac locally, linux on Vercel).
  serverExternalPackages: ['@libsql/client', 'libsql'],
  outputFileTracingIncludes: { '/**': ['./node_modules/@libsql/*/**', './node_modules/libsql/**'] },
};
export default nextConfig;
