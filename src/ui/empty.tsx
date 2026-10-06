import type { ComponentProps } from 'react';
import { cn } from './cn';

/**
 * shadcn/ui's Empty (D-009, style new-york-v4), the empty state, restyled to the tokens: a dashed
 * border in the strong border colour on the card radius, a section heading and a muted line. The
 * demo has no empty state of its own, so its shape follows the demo's dashed boxes (demo lines 544
 * and 653) and its words the wording style (design-reference.md). shadcn/ui's EmptyMedia, a slot for
 * an icon, waits for the first icon (D-088).
 */
function Empty({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty"
      className={cn(
        'flex min-w-0 flex-1 flex-col items-center justify-center gap-6 rounded-card border border-dashed border-border-strong p-6 text-center text-balance md:p-12',
        className,
      )}
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-header"
      className={cn('flex max-w-sm flex-col items-center gap-2 text-center', className)}
      {...props}
    />
  );
}

/** A section heading: 16 px, weight 600 (design-reference.md, "Base size"). */
function EmptyTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-title"
      className={cn('text-section font-semibold', className)}
      {...props}
    />
  );
}

function EmptyDescription({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot="empty-description"
      className={cn(
        'leading-relaxed text-muted [&>a]:underline [&>a]:underline-offset-4',
        className,
      )}
      {...props}
    />
  );
}

function EmptyContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        'flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-balance',
        className,
      )}
      {...props}
    />
  );
}

export { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle };
