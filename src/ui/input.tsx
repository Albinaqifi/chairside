import type { ComponentProps } from 'react';
import { cn } from './cn';

/**
 * shadcn/ui's Input (D-009, style new-york-v4), restyled to the tokens after the demo's inputs:
 * white, with the strong border and the control radius; the focus colour on focus, the error colour
 * when aria-invalid. Without formAction and formMethod (D-084): an input of type submit or image
 * never sends its form to another URL, or as a GET with every field in the URL (D-076, D-081).
 */
function Input({
  className,
  type,
  ...props
}: Omit<ComponentProps<'input'>, 'formAction' | 'formMethod'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-10 w-full min-w-0 rounded-control border border-border-strong bg-surface px-3 text-base text-text transition-colors outline-none selection:bg-primary selection:text-on-primary file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-small file:font-medium file:text-text placeholder:text-muted disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-focus focus-visible:ring-3 focus-visible:ring-focus/25',
        'aria-invalid:border-error aria-invalid:ring-error/20',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
