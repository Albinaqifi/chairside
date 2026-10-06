import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { onest, sourceSerif } from '@/ui/fonts';
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
    <html lang={locale} className={`${onest.variable} ${sourceSerif.variable}`}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
