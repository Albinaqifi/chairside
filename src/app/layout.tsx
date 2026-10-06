import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { figtree, newsreader } from '@/ui/fonts';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app');
  return { title: t('name') };
}

/**
 * Every page: the stylesheet with the design tokens, the two fonts' variables, and the message
 * file's texts for client components (NextIntlClientProvider passes on the request's configuration,
 * src/i18n/request.ts).
 */
export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${figtree.variable} ${newsreader.variable}`}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
