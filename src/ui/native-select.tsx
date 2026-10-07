import { ChevronDownIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from './cn';

/**
 * shadcn/ui's NativeSelect (D-009, style new-york-v4): the browser's own <select> (D-093), which
 * sends what it shows, works before the page's script runs and opens a tablet's own picker. Styled
 * as Input is: white, the strong border, the control radius, the focus colour on keyboard focus
 * and the error colour when aria-invalid; its own arrow is replaced by a chevron in the muted
 * colour. Restyled from shadcn/ui's in three ways: one size, as Input has (its size prop is gone,
 * and so is the HTML size attribute, which would make it a list box); className sizes the wrapper,
 * which holds the chevron, so a narrower select keeps its chevron inside it; and the options take
 * the select's own colours (shadcn/ui's system-colour classes were for its dark mode). An empty
 * choice is an option the caller writes, `<NativeSelectOption value="">`, with its text from the
 * message file. A select has no formAction or formMethod to take out (D-084).
 */
function NativeSelect({ className, ...props }: Omit<ComponentProps<'select'>, 'size'>) {
  return (
    <div
      data-slot="native-select-wrapper"
      className={cn('relative w-full min-w-0 has-[select:disabled]:opacity-50', className)}
    >
      <select
        data-slot="native-select"
        className={cn(
          'h-10 w-full min-w-0 appearance-none rounded-control border border-border-strong bg-surface pr-9 pl-3 text-base text-text transition-colors outline-none disabled:pointer-events-none disabled:cursor-not-allowed',
          'focus-visible:border-focus focus-visible:ring-3 focus-visible:ring-focus/25',
          'aria-invalid:border-error aria-invalid:ring-error/20',
        )}
        {...props}
      />
      <ChevronDownIcon
        aria-hidden="true"
        data-slot="native-select-icon"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted select-none"
      />
    </div>
  );
}

function NativeSelectOption(props: ComponentProps<'option'>) {
  return <option data-slot="native-select-option" {...props} />;
}

function NativeSelectOptGroup(props: ComponentProps<'optgroup'>) {
  return <optgroup data-slot="native-select-optgroup" {...props} />;
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
