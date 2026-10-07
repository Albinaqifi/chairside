'use client';

import { CheckIcon } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';

/**
 * Its props: Radix's, which are a button's, without formAction and formMethod (D-084), so it never
 * sends its form to another URL or as a GET with every field in the URL (D-076, D-081); and without
 * type, which it sets itself.
 */
type CheckboxProps = Omit<
  ComponentProps<typeof CheckboxPrimitive.Root>,
  'formAction' | 'formMethod' | 'type'
>;

/**
 * shadcn/ui's Checkbox (D-009, style new-york-v4), on Radix's, restyled to the demo's checkboxes
 * (lines 1305, 1352): an 18 px box with a 5 px radius, white; ticked, accent with a white check
 * mark. Its border is 1 px, shadcn/ui's, where the demo's is 1.5: Tailwind makes whole pixels only,
 * and a value written in square brackets is the kind the token search refuses. Keyboard focus shows
 * Button's outline in the focus colour, never the browser's own; the error colour on its border
 * when aria-invalid. Space ticks it; Enter does not (Radix's, as WAI-ARIA's checkbox asks).
 *
 * In a form, Radix keeps a hidden checkbox input beside the button, under the field's name: that
 * input is what the form sends, "on" when ticked and nothing when not. It is set only when the box
 * changes, so a browser that gave it back after a reload would send what the box does not show;
 * StaffForm's form has autocomplete="off" for that (D-093). The button is type="button", written
 * after the props, so it never submits the form: a staff form's one submit button is Send.
 */
function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-4.5 shrink-0 rounded-checkbox border border-checkbox-border bg-surface text-on-primary transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid',
        'aria-invalid:border-error data-[state=checked]:border-accent data-[state=checked]:bg-accent',
        className,
      )}
      {...props}
      type="button"
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox, type CheckboxProps };
