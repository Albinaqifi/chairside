'use client';

import { useTranslations } from 'next-intl';
import { StaffField, StaffForm } from '@/app/_lib/staff-form';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Dialog, DialogContent, DialogTrigger } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { NativeSelect, NativeSelectOption } from '@/ui/native-select';
import { Switch } from '@/ui/switch';
import { Textarea } from '@/ui/textarea';
import { useToast } from '@/ui/toast';
import { demoAnswer, demoOwnerOnly } from './actions';
import { DEMO_CHOICES } from './demo-choices';

/** The answers the demo form can ask for, in the order it lists them. */
const ANSWERS = ['done', 'refusal', 'internal', 'forbidden'] as const;

/**
 * The demo form's action: the owner-only one when the form asks for forbidden, so anyone but an
 * owner gets it; the every-member one otherwise. Both are wrapper-made: the clinic check, the
 * permission and the input are the wrappers' own.
 */
const askedAction: typeof demoAnswer = (clinicId, input) =>
  (input instanceof FormData && input.get('answer') === 'forbidden' ? demoOwnerOnly : demoAnswer)(
    clinicId,
    input,
  );

/**
 * The form pattern on /dev/components (E00-T04c): fields that show their errors (a note of 2 to 40
 * characters, a four-digit code; E00-T04d: details of 1 to 200 characters, a choice of three) and
 * two that cannot be wrong (a checkbox and a switch, which send "on" when they show on and nothing
 * when they show off), then the answer to ask the action for. The clinic it sends is the frame's,
 * as every staff form's.
 */
export function DemoForm() {
  const t = useTranslations('devComponents.form');
  const choices = useTranslations('devComponents.choices');
  return (
    <StaffForm
      action={askedAction}
      doneMessage={t('done')}
      refusals={{ demo_refused: t('refused') }}
      submitLabel={t('submit')}
      pendingLabel={t('submitting')}
      className="max-w-md"
    >
      <StaffField
        name="note"
        label={t('note')}
        render={(field) => <Input {...field} autoComplete="off" />}
      />
      <StaffField
        name="code"
        label={t('code')}
        render={(field) => <Input {...field} inputMode="numeric" autoComplete="off" />}
      />
      <StaffField name="details" label={t('details')} render={(field) => <Textarea {...field} />} />
      <StaffField
        name="choice"
        label={t('choice')}
        render={(field) => (
          <NativeSelect {...field} defaultValue="">
            <NativeSelectOption value="">{choices('empty')}</NativeSelectOption>
            {DEMO_CHOICES.map((choice) => (
              <NativeSelectOption key={choice} value={choice}>
                {choices(choice)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      />
      <StaffField
        name="checkbox"
        label={t('checkbox')}
        orientation="horizontal"
        render={(field) => <Checkbox {...field} />}
      />
      <StaffField
        name="switch"
        label={t('switch')}
        orientation="horizontal"
        render={(field) => <Switch {...field} />}
      />
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-small font-semibold">{t('answer')}</legend>
        {ANSWERS.map((answer) => (
          <label key={answer} className="flex items-center gap-2">
            <input
              type="radio"
              name="answer"
              value={answer}
              defaultChecked={answer === 'done'}
              className="size-4 accent-primary"
            />
            {t(`answers.${answer}`)}
          </label>
        ))}
      </fieldset>
    </StaffForm>
  );
}

/** Two buttons that show a toast each: the second replaces the first. */
export function ToastDemo() {
  const t = useTranslations('devComponents.toast');
  const showToast = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="secondary" onClick={() => showToast(t('first'))}>
        {t('show')}
      </Button>
      <Button type="button" variant="secondary" onClick={() => showToast(t('second'), 'failed')}>
        {t('showAnother')}
      </Button>
    </div>
  );
}

/**
 * The fields a demo action needs, hidden, and the answer it should give: a form here has nothing to
 * type, only a button to press.
 */
function AskedAnswer({ answer }: { answer: 'done' | 'refusal' }) {
  return (
    <>
      <input type="hidden" name="note" value="Nested demo" />
      <input type="hidden" name="code" value="1234" />
      <input type="hidden" name="details" value="Nested demo" />
      <input type="hidden" name="choice" value="first" />
      <input type="hidden" name="answer" value={answer} />
    </>
  );
}

/**
 * A dialog inside a form, and a form inside the dialog (E01-T06e, E00-T04e review). The outer form
 * would answer with a refusal, the inner one is done. A `submit` from the inner form goes up React's
 * tree through the dialog's portal, to the outer form's onSubmit: the dialog's content stops it
 * (src/ui/dialog.tsx), so pressing the inner button sends the inner form only. The outer form's
 * refusal showing means the guard is gone.
 */
export function NestedFormDemo() {
  const t = useTranslations('devComponents.nested');
  return (
    <StaffForm
      action={demoAnswer}
      doneMessage={t('innerDone')}
      refusals={{ demo_refused: t('outerRefused') }}
      submitLabel={t('outerSubmit')}
      pendingLabel={t('outerSubmitting')}
      className="max-w-md"
    >
      <AskedAnswer answer="refusal" />
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="secondary">{t('open')}</Button>
        </DialogTrigger>
        <DialogContent title={t('title')}>
          <StaffForm
            action={demoAnswer}
            doneMessage={t('innerDone')}
            submitLabel={t('innerSubmit')}
            pendingLabel={t('innerSubmitting')}
          >
            <AskedAnswer answer="done" />
          </StaffForm>
        </DialogContent>
      </Dialog>
    </StaffForm>
  );
}
