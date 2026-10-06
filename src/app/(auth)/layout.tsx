import type { ReactNode } from 'react';
import { Card, CardContent } from '@/ui/card';
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
      <Card className="py-7 motion-safe:animate-enter">
        <CardContent className="px-7">{children}</CardContent>
      </Card>
    </main>
  );
}
