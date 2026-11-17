import type { NextConfig } from 'next';
const config: NextConfig = { basePath: process.env.NEXT_PUBLIC_BASE_PATH || '', devIndicators: false, distDir: process.env.NEXT_DIST_DIR || '.next', turbopack: { root: process.cwd() } };
export default config;
