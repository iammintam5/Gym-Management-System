import type { NextConfig } from 'next';
import { loadEnvConfig } from '@next/env';
import { resolve } from 'node:path';
loadEnvConfig(resolve(process.cwd(), '../..'));
const nextConfig: NextConfig = {
  transpilePackages: ['@gym/contracts', '@gym/ui'],
};
export default nextConfig;
