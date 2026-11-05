import { fileURLToPath } from 'node:url';
import path from 'node:path';
/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
};
export default nextConfig;
