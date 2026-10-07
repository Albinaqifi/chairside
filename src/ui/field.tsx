import { useId, type ReactNode } from 'react';
import { cn } from './cn';
import { Label } from './label';

/** What a field gives its control: spread it onto the control, `render={(field) => <Input {...field} />}`. */
export interface FieldControlProps {
  /** The id the field's label names. */
  id: string;
  name?: string;
  /** While the field has an error. */
  'aria-invalid'?: true;
  /** While the field has an error: the error's id, so a screen reader reads it with the control. */
  'aria-describedby'?: string;
}

/**
 * A form field: its label, its control and its error, tied together for screen readers (E00-T04c).
 * After shadcn/ui's Form (D-009: FormField's `render`, FormItem, FormLabel, FormControl,
 * FormMessage), which takes its errors from react-hook-form; this one takes its error from the
 * caller, and hands the control its attributes as `render`'s argument rather than through a Slot,
 * so a control cannot replace the id its label names by having an id of its own. The control reads
 * its label, that it is invalid, and the error, which shows under it in the error colour. Not a
 * client component: a server page can render it too, with `render` run on the server.
 */
function Field({
  name,
  label,
  error,
  className,
  render,
}: {
  /** The control's name, the field's in the form's data. */
  name?: string;
  label: ReactNode;
  /** The error's text, from the message file; none or empty: no error. */
  error?: string;
  className?: string;
  /** The control, given its id, name and the error's attributes. */
  render: (control: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const invalid = error !== undefined && error !== '';
  const control: FieldControlProps = invalid
    ? { id, name, 'aria-invalid': true, 'aria-describedby': errorId }
    : { id, name };

  return (
    <div
      data-slot="field"
      data-invalid={invalid || undefined}
      className={cn('grid gap-2', className)}
    >
      <Label htmlFor={id}>{label}</Label>
      {render(control)}
      {invalid && (
        <p id={errorId} data-slot="field-error" className="text-small text-error">
          {error}
        </p>
      )}
    </div>
  );
}

export { Field };
