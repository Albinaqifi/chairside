import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {};

// next-intl (D-015) finds its request configuration at src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
