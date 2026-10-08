import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from './cn';

/**
 * shadcn/ui's Badge (D-009, style new-york-v4), restyled to the demo's status pill (demo line 134):
 * 12 px, weight 600, on a pill, in the status colours of the theme (src/app/globals.css). Its
 * variants are rewritten to the statuses, an appointment's and (E01-T02a) a patient's who is not
 * active, and one must be named: a pill without a status says nothing. Its asChild and focus
 * styles are gone: a pill is a label, never a link or a button.
 */
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1.25 overflow-hidden rounded-pill border border-transparent px-2.25 py-0.75 text-caption font-semibold whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        booked: 'bg-status-booked-bg text-status-booked-fg',
        'no-reply': 'bg-status-no-reply-bg text-status-no-reply-fg',
        confirmed: 'bg-status-confirmed-bg text-status-confirmed-fg',
        arrived: 'bg-status-arrived-bg text-status-arrived-fg',
        completed: 'bg-status-completed-bg text-status-completed-fg',
        cancelled: 'bg-status-cancelled-bg text-status-cancelled-fg',
        'no-show': 'bg-status-no-show-bg text-status-no-show-fg',
        archived: 'bg-status-archived-bg text-status-archived-fg',
        deceased: 'bg-status-deceased-bg text-status-deceased-fg',
      },
    },
  },
);

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

type BadgeProps = ComponentProps<'span'> & { variant: BadgeVariant };

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants, type BadgeProps, type BadgeVariant };
