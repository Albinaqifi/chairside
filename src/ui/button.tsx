import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';

/**
 * shadcn/ui's Button (D-009, style new-york-v4), restyled to the tokens after the demo's buttons:
 * primary (brand teal), secondary (white with a border) and quiet (no border, muted text). Its
 * variants and sizes are rewritten to these three in one size; its dark-mode classes are gone. On
 * keyboard focus, a 2 px outline in the focus colour: it names its style, as Tailwind's
 * outline-none sets the style to none for every outline class after it.
 */
const buttonVariants = cva(
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-control border px-3.5 text-base whitespace-nowrap transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: 'border-transparent bg-primary font-semibold text-on-primary hover:bg-primary/90',
        secondary: 'border-border-strong bg-surface font-medium text-text hover:bg-border/50',
        quiet:
          'border-transparent bg-transparent font-medium text-muted hover:bg-border/50 hover:text-text',
      },
    },
    defaultVariants: {
      variant: 'primary',
    },
  },
);

/**
 * Without formAction and formMethod (D-084): a button never sends its form to another URL, or as
 * a GET with every field in the URL (D-076, D-081). shadcn/ui's Button as published takes React's
 * full button props, which the form lint refuses (chairside/forms-post).
 */
type ButtonProps = Omit<ComponentProps<'button'>, 'formAction' | 'formMethod'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({ className, variant = 'primary', asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      className={cn(buttonVariants({ variant, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants, type ButtonProps };
