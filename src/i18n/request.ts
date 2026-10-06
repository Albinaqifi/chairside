import { getRequestConfig } from 'next-intl/server';
import messages from './en.json';

/**
 * next-intl's configuration for every request (D-015): English only, with no locale in the URL
 * (D-053), so one message file and no locale routing. next-intl needs no middleware then, and gets
 * none: the request proxy is src/proxy.ts (D-067). next.config.ts finds this file by its path.
 */
export default getRequestConfig(() => ({ locale: 'en', messages }));
