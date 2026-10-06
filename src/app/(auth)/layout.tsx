import type { ReactNode } from 'react';
import { Logo } from '@/ui/logo';

/**
 * The frame of the pages a person sees before a clinic is chosen: the logo mark and the wordmark
 * above a card, in the middle of the page (the demo has no login screen; handoffs/E00-T04a.md
 * proposes this layout). It holds no data and checks nothing: each page checks the session itself.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-12">
      <div className="mb-6 flex justify-center">
        <Logo />
      </div>
      <div className="rounded-card border border-border bg-surface p-7 motion-safe:animate-enter">
        {children}
      </div>
    </main>
  );
}
