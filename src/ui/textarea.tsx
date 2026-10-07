import type { ComponentProps } from 'react';
import { cn } from './cn';

/**
 * shadcn/ui's Textarea (D-009, style new-york-v4), restyled to the tokens after the demo's
 * textareas (lines 499 and 940): white, the strong border and the control radius, 10 px by 12 px
 * of padding, a line height of 1.5, at least 96 px high and taller by dragging its corner, as the
 * demo's are. shadcn/ui's growing with its text (field-sizing) is left out for that drag, which
 * every browser supports. Focus and errors as Input's: the focus colour on keyboard focus, never
 * the browser's own outline, and the error colour when aria-invalid. A textarea has no formAction
 * or formMethod to take out (D-084).
 */
function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-24 w-full min-w-0 resize-y rounded-control border border-border-strong bg-surface px-3 py-2.5 text-base leading-normal text-text transition-colors outline-none selection:bg-primary selection:text-on-primary placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-focus focus-visible:ring-3 focus-visible:ring-focus/25',
        'aria-invalid:border-error aria-invalid:ring-error/20',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
