import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite'],
  typedRoutes: true,

  /**
   * `.next` is shared mutable state: a second dev server, or a `next build`,
   * overwrites the chunks the first one is serving, and the browser then loads
   * half-written JavaScript. Setting NEXT_DIST_DIR gives a throwaway server its
   * own directory so it cannot touch a running one.
   *
   *   NEXT_DIST_DIR=.next-check npx next dev -p 3211
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default nextConfig;
