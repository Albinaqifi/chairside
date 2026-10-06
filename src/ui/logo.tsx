import { useTranslations } from 'next-intl';

/**
 * The logo mark and the wordmark, as the demo's sidebar header draws them (lines 26–29): a teal
 * rounded square with a light dot, then "Chairside" in the serif. The mark is decoration; the
 * wordmark is the product's name, from the message file.
 */
export function Logo() {
  const t = useTranslations('app');
  return (
    <div className="flex items-center gap-2.5">
      <div
        aria-hidden="true"
        className="flex size-7 items-center justify-center rounded-control bg-primary"
      >
        <div className="size-2.5 rounded-pill bg-on-primary" />
      </div>
      <div className="font-serif text-wordmark font-medium tracking-heading">{t('name')}</div>
    </div>
  );
}
