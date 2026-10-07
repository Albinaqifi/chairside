'use client';

import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';

/**
 * Its props: Radix's, which are a button's, without formAction and formMethod (D-084), so it never
 * sends its form to another URL or as a GET with every field in the URL (D-076, D-081); and without
 * type, which it sets itself.
 */
type SwitchProps = Omit<
  ComponentProps<typeof SwitchPrimitive.Root>,
  'formAction' | 'formMethod' | 'type'
>;

/**
 * shadcn/ui's Switch (D-009, style new-york-v4), the on/off control on Radix's (not shadcn/ui's
 * Toggle, a pressed button), restyled to the demo's toggles (lines 429, 462, 558): a 38 by 22 px
 * pill with a white 16 px knob 3 px inside it; on, accent with the knob at the right; off, the
 * switch-off colour. One size: shadcn/ui's size prop is gone. Keyboard focus shows Button's outline
 * in the focus colour, never the browser's own; the error colour on its edge when aria-invalid.
 * Space and Enter turn it on or off.
 *
 * In a form, Radix keeps a hidden checkbox input beside the button, under the field's name: that
 * input is what the form sends, "on" when on and nothing when off. It is set only when the switch
 * changes, so a browser that gave it back after a reload would send what the switch does not show;
 * StaffForm's form has autocomplete="off" for that (D-093). The button is type="button", written
 * after the props, so it never submits the form: a staff form's one submit button is Send.
 */
function Switch({ className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-5.5 w-9.5 shrink-0 items-center rounded-pill border border-transparent px-0.5 transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid',
        'aria-invalid:border-error data-[state=checked]:bg-accent data-[state=unchecked]:bg-switch-off',
        className,
      )}
      {...props}
      type="button"
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-pill bg-surface transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch, type SwitchProps };
