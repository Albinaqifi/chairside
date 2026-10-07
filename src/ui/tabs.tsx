'use client';

import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';

/**
 * shadcn/ui's Tabs (D-009, style new-york-v4), on Radix's, restyled to the demo's settings tab bar
 * (lines 750–752, logic 1913): the tabs in a row over a 1 px border line, 20 px above the chosen
 * tab's content. One look: shadcn/ui's variants and its vertical orientation are gone, so the arrow
 * keys are left and right (Radix's, with Home and End), and they choose the tab they move to.
 *
 * Only the chosen tab's content is on the page: Radix takes a tab's content off the page when
 * another tab is chosen, and puts it back fresh when it is chosen again. So a form never spans two
 * tabs: what was typed in one tab is gone after another is chosen, and fields in another tab would
 * not be sent. Each tab holds whole forms of its own. TabsContent leaves out Radix's forceMount,
 * which would keep every tab's content on the page.
 */
function Tabs({
  className,
  ...props
}: Omit<ComponentProps<typeof TabsPrimitive.Root>, 'orientation'>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-5', className)}
      {...props}
    />
  );
}

/** The bar: the tabs in a row, 4 px apart, wrapping when they do not fit, over the border line. */
function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('flex flex-wrap gap-1 border-b border-border', className)}
      {...props}
    />
  );
}

/**
 * A tab's props: Radix's, which are a button's, without formAction and formMethod (D-084), so a tab
 * never sends its form to another URL or as a GET with every field in the URL (D-076, D-081); and
 * without type, which it sets itself.
 */
type TabsTriggerProps = Omit<
  ComponentProps<typeof TabsPrimitive.Trigger>,
  'formAction' | 'formMethod' | 'type'
>;

/**
 * A tab, as the demo draws it: the chosen one in the text colour at weight 600 over a 2 px primary
 * line, which covers the bar's line; the others muted at 500. Keyboard focus shows Button's outline
 * in the focus colour, never the browser's own. The button is type="button", written after the
 * props: Radix writes its own before them, where a caller's would win, and in a staff form the one
 * submit button is Send.
 */
function TabsTrigger({ className, ...props }: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        '-mb-px border-b-2 border-transparent bg-transparent px-3.5 py-2.5 font-medium whitespace-nowrap text-muted transition-colors outline-none hover:text-text disabled:pointer-events-none disabled:opacity-50',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid',
        'data-[state=active]:border-primary data-[state=active]:font-semibold data-[state=active]:text-text',
        className,
      )}
      {...props}
      type="button"
    />
  );
}

/**
 * A tab's content. Radix puts it in the order of the Tab key (a panel with nothing to focus is
 * reached that way), so its keyboard focus shows the same outline.
 */
function TabsContent({
  className,
  ...props
}: Omit<ComponentProps<typeof TabsPrimitive.Content>, 'forceMount'>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid',
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger, type TabsTriggerProps };
