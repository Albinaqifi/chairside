'use client';

import { useTranslations } from 'next-intl';
import { Toast as ToastPrimitive } from 'radix-ui';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

/** How long a toast shows: the demo's 3.4 s (logic line 1615). */
export const TOAST_DURATION_MS = 3400;

/**
 * done: what the person asked for happened ("Saved"); failed: it did not. Both look the same, as
 * the demo's one toast does; a screen reader hears a failure at once (Radix's foreground type,
 * assertive) and a done one when it is free (background, polite).
 */
export type ToastTone = 'done' | 'failed';

/** Shows a toast with this text, already translated, in place of the one showing. */
export type ShowToast = (message: string, tone?: ToastTone) => void;

function noToaster(): never {
  throw new Error('useToast: there is no Toaster around this component; the root layout holds one');
}

// Without a Toaster, rendering works and showing a toast fails loudly: a component that shows one
// (the logout button) can be rendered in a test on its own.
const ToastContext = createContext<ShowToast>(noToaster);

interface Shown {
  id: number;
  message: string;
  tone: ToastTone;
}

/**
 * The toast, as the demo draws it (lines 1364–1366, logic 1615): one message at a time at the
 * bottom centre, the next replacing it, gone after 3.4 s. Built on Radix's Toast from radix-ui
 * (D-086), which shadcn/ui's earlier toast was built on, restyled to the tokens: the demo's dark
 * panel, light text, 12 px radius and shadow. Radix keeps it while the pointer or the focus is on
 * it and while the window is in the background, closes it on Escape or a swipe down, and moves the
 * focus to it with F8. The root layout holds the one Toaster, so the staff pages and the clinic
 * picker share it.
 */
export function Toaster({ children }: { children: ReactNode }) {
  const t = useTranslations('toast');
  const lastId = useRef(0);
  const [shown, setShown] = useState<Shown | null>(null);

  const show = useCallback<ShowToast>((message, tone = 'done') => {
    lastId.current += 1;
    setShown({ id: lastId.current, message, tone });
  }, []);

  return (
    <ToastContext value={show}>
      <ToastPrimitive.Provider
        duration={TOAST_DURATION_MS}
        swipeDirection="down"
        label={t('label')}
      >
        {children}
        {shown && (
          // A new key for each toast: the one showing goes, and the new one starts its 3.4 s.
          <ToastPrimitive.Root
            key={shown.id}
            type={shown.tone === 'failed' ? 'foreground' : 'background'}
            onOpenChange={(open) => {
              if (!open) setShown((current) => (current?.id === shown.id ? null : current));
            }}
            className="pointer-events-auto w-fit max-w-140 rounded-toast bg-toast px-4.5 py-3 text-base text-on-toast shadow-toast outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid motion-safe:animate-toast"
          >
            <ToastPrimitive.Description>{shown.message}</ToastPrimitive.Description>
          </ToastPrimitive.Root>
        )}
        <ToastPrimitive.Viewport
          label={t('region', { hotkey: 'F8' })}
          className="pointer-events-none fixed inset-x-0 bottom-6 z-60 flex flex-col items-center px-4 outline-none"
        />
      </ToastPrimitive.Provider>
    </ToastContext>
  );
}

/** Shows a toast: `useToast()(t('saved'))`. Rendered without a Toaster, it throws when called. */
export function useToast(): ShowToast {
  return useContext(ToastContext);
}
