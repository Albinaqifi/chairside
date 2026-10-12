import type { LOCALE } from './locale';
import type messages from './en.json';

/**
 * Types every message key by the message file, so t('login.emial') or a role without a name is a
 * type error, not a raw key on the page. The one locale is English with the 24-hour clock
 * (./locale.ts, E01-T04b).
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: typeof LOCALE;
    Messages: typeof messages;
  }
}
