import type messages from './en.json';

/**
 * Types every message key by the message file, so t('login.emial') or a role without a name is a
 * type error, not a raw key on the page.
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: 'en';
    Messages: typeof messages;
  }
}
