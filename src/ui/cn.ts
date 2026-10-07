import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * shadcn/ui's class helper (D-009): joins class names, and when two set the same thing, keeps the
 * later one, so a caller's className can override a component's own. tailwind-merge knows
 * Tailwind's own scales only; ours (src/app/globals.css) are named here, or it would read
 * `text-heading` as a colour and drop a `text-muted` next to it, and keep two radii. A size,
 * radius, shadow, tracking or animation added to the stylesheet is added here too.
 */
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['small', 'caption', 'overline', 'section', 'heading', 'wordmark'],
      radius: ['card', 'control', 'pill', 'toast', 'checkbox'],
      shadow: ['toast'],
      tracking: ['heading', 'overline'],
      animate: ['enter', 'toast'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
