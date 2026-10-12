import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { languageOf } from '@/i18n/locale';
import { onest, sourceSerif } from '@/ui/fonts';
import { Toaster } from '@/ui/toast';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app');
  return { title: t('name') };
}

/**
 * Every page: the stylesheet with the design tokens, the two fonts' variables, the message file's
 * texts for client components (NextIntlClientProvider passes on the request's configuration,
 * src/i18n/request.ts), and the one toast (src/ui/toast.tsx), for the staff pages and the clinic
 * picker alike. The page's language is the locale's, without the 24-hour clock's extension
 * (src/i18n/locale.ts): `en`.
 */
export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const locale = await getLocale();
  return (
    <html lang={languageOf(locale)} className={`${onest.variable} ${sourceSerif.variable}`}>
      <body>
        <NextIntlClientProvider>
          <Toaster>{children}</Toaster>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
