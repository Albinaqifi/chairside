'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type Ref } from 'react';
import { StaffField, StaffForm } from '@/app/_lib/staff-form';
import type { CatalogueType } from '@/modules/scheduling';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Dialog, DialogContent, DialogTrigger } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { NativeSelect, NativeSelectOption } from '@/ui/native-select';
import {
  activateTreatmentType,
  addTreatmentType,
  changeTreatmentType,
  deactivateTreatmentType,
} from './treatment-type-actions';
import {
  currencyDigits,
  FIRST_TYPE_LENGTH,
  priceAmount,
  priceText,
  typeLengthChoices,
} from './treatment-type-fields';

/**
 * How long the list takes no click from a pointer once its rows have changed: the closed days'
 * moment (SETTLE_MS, ./closed-days.tsx, E01-T08c test finding 1), for the same case. A type made
 * inactive moves to the inactive ones at the list's end, and made active again it moves back: the
 * first click's answer can be back before a double click's second, which would then land on the
 * row that came under the pointer (another type's Make inactive), or on this one's Make active.
 */
const SETTLE_MS = 1_000;

/** The fields a type's form starts with: a new type's, or the type's own. */
interface TypeValues {
  name: string;
  minutes: number;
  /** The price as its field shows it, '' for none. */
  price: string;
  needsAftercare: boolean;
}

const NEW_TYPE: TypeValues = {
  name: '',
  minutes: FIRST_TYPE_LENGTH,
  price: '',
  needsAftercare: false,
};

/**
 * The Treatment types tab (E01-T09a; the demo has no such screen, design-reference.md): the clinic's
 * types, the active ones then the inactive, each by name, with its length, its price when it has one
 * and "Needs aftercare" when set; an inactive one says so. Each row has an Edit, which opens the
 * type's form in a dialog, and a Make inactive or Make active, a StaffForm of its own with the id
 * hidden, as a closed day's Remove. Under the list, under a line, the form that adds one. Its page
 * keys it by the clinic (D-098), so a render for another clinic starts it from that clinic's types.
 *
 * Every form here is a StaffForm: it sends the frame's clinic (D-092) and keeps nothing in the
 * browser (D-093), no field asking for an `autocomplete` of its own. When one is done, the action
 * renders the page again (refresh()), and the list with it. After an add, the add form is mounted
 * anew, empty, the keyboard back at its name. After a Make inactive or Make active, whose row then
 * moves and whose button changes, the keyboard goes to the section's heading, as after a Remove.
 *
 * Whenever the rows change, the list takes no pointer click for a moment (SETTLE_MS), as the closed
 * days' list: only the pointer's; the keyboard acts on the control it names.
 */
export function TreatmentTypes({
  types,
  currency,
}: {
  types: readonly CatalogueType[];
  /** The clinic's currency, ISO 4217: the prices' and the price field's. */
  currency: string;
}) {
  const t = useTranslations('settings.treatmentTypes');
  const heading = useRef<HTMLHeadingElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const [added, setAdded] = useState(0);
  useEffect(() => {
    if (added > 0) nameField.current?.focus();
  }, [added]);
  // The rows as last rendered, compared while rendering, as the closed days' list compares them: the
  // commit that moves the rows is the one that stops their clicks.
  const listed = JSON.stringify(types);
  const [rendered, setRendered] = useState(listed);
  const [settling, setSettling] = useState(false);
  if (rendered !== listed) {
    setRendered(listed);
    setSettling(true);
  }
  useEffect(() => {
    if (!settling) return;
    const timer = setTimeout(() => setSettling(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [settling, listed]);
  const refusals = {
    name_taken: t('nameTaken'),
    price_decimals: t('priceDecimals', { currency }),
    price_too_high: t('priceTooHigh'),
  };
  return (
    <section className="grid gap-4">
      <div className="grid gap-1">
        {/* tabIndex -1: the keyboard's place after a Make inactive, never a stop of the Tab key. */}
        <h2 ref={heading} tabIndex={-1} className="text-section font-semibold">
          {t('heading')}
        </h2>
        <p className="text-muted">{t('intro')}</p>
      </div>
      {types.length === 0 ? (
        <p>{t('none')}</p>
      ) : (
        <ul className={settling ? 'pointer-events-none' : undefined}>
          {types.map((type) => (
            <TypeRow
              key={type.id}
              type={type}
              currency={currency}
              onStateChanged={() => heading.current?.focus()}
            />
          ))}
        </ul>
      )}
      <StaffForm
        key={added}
        action={addTreatmentType}
        doneMessage={t('added')}
        onDone={() => setAdded((count) => count + 1)}
        refusals={refusals}
        submitLabel={t('add')}
        pendingLabel={t('adding')}
        className="border-t border-border pt-4"
      >
        <TypeFields values={NEW_TYPE} currency={currency} nameRef={nameField} />
      </StaffForm>
    </section>
  );
}

/**
 * One type: its name, "Inactive" when it is, its length, price and aftercare flag; its Edit; and its
 * Make inactive or Make active, a StaffForm of its own whose only field is the id, hidden. A group
 * named by the type (", inactive" for an inactive one, as an inactive type may share an active one's
 * name), so each button is read with the type it acts on.
 */
function TypeRow({
  type,
  currency,
  onStateChanged,
}: {
  type: CatalogueType;
  currency: string;
  onStateChanged: () => void;
}) {
  const t = useTranslations('settings.treatmentTypes');
  const format = useFormatter();
  const details = [t('lengthShown', { minutes: type.minutes })];
  if (type.price !== null) {
    details.push(
      format.number(priceAmount(type.price, currencyDigits(currency)), {
        style: 'currency',
        currency,
      }),
    );
  }
  if (type.needsAftercare) details.push(t('needsAftercare'));
  return (
    <li className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <div
        role="group"
        aria-label={type.active ? type.name : t('inactiveName', { name: type.name })}
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
      >
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium wrap-anywhere">{type.name}</span>
            {type.active ? null : <Badge variant="archived">{t('inactive')}</Badge>}
          </span>
          <span className="text-muted">{details.join(' · ')}</span>
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2">
          <EditType type={type} currency={currency} />
          {/* Keyed by the state, so a type made inactive gets a new form, its answer not carried. */}
          {type.active ? (
            <StaffForm
              key="active"
              action={deactivateTreatmentType}
              doneMessage={t('deactivated')}
              onDone={onStateChanged}
              refusals={{ not_found: t('notFound'), already_inactive: t('alreadyInactive') }}
              submitLabel={t('deactivate')}
              pendingLabel={t('deactivating')}
              className="justify-items-end"
            >
              <input type="hidden" name="treatmentTypeId" value={type.id} />
            </StaffForm>
          ) : (
            <StaffForm
              key="inactive"
              action={activateTreatmentType}
              doneMessage={t('activated')}
              onDone={onStateChanged}
              refusals={{
                not_found: t('notFound'),
                already_active: t('alreadyActive'),
                name_taken: t('activeNameTaken'),
              }}
              submitLabel={t('activate')}
              pendingLabel={t('activating')}
              className="justify-items-end"
            >
              <input type="hidden" name="treatmentTypeId" value={type.id} />
            </StaffForm>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * A type's Edit: a button that opens its form in a dialog, filled with the type as it is, the id
 * hidden. The dialog closes when the save is done; Radix gives the focus back to Edit. Its content is
 * mounted only while it is open, so each opening starts from the type's values of that render.
 */
function EditType({ type, currency }: { type: CatalogueType; currency: string }) {
  const t = useTranslations('settings.treatmentTypes');
  const [open, setOpen] = useState(false);
  const values: TypeValues = {
    name: type.name,
    minutes: type.minutes,
    price: type.price === null ? '' : priceText(type.price, currencyDigits(currency)),
    needsAftercare: type.needsAftercare,
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">{t('edit')}</Button>
      </DialogTrigger>
      <DialogContent title={t('editTitle', { name: type.name })}>
        <StaffForm
          action={changeTreatmentType}
          doneMessage={t('saved')}
          onDone={() => setOpen(false)}
          refusals={{
            name_taken: t('nameTaken'),
            price_decimals: t('priceDecimals', { currency }),
            price_too_high: t('priceTooHigh'),
            not_found: t('notFound'),
          }}
          submitLabel={t('save')}
          pendingLabel={t('saving')}
        >
          <input type="hidden" name="treatmentTypeId" value={type.id} />
          <TypeFields values={values} currency={currency} stacked />
        </StaffForm>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A type's four fields, for the add form and the edit: the name; the length, the browser's own select
 * of 5 to 240 minutes in steps of 5 with the type's own length kept among them; the price, a text in
 * the clinic's currency; "Needs aftercare", a checkbox with its label beside it.
 */
function TypeFields({
  values,
  currency,
  nameRef,
  stacked = false,
}: {
  values: TypeValues;
  currency: string;
  nameRef?: Ref<HTMLInputElement>;
  /** In a row on a wide screen (the add form), or one under another (the edit dialog). */
  stacked?: boolean;
}) {
  const t = useTranslations('settings.treatmentTypes');
  return (
    <div
      className={stacked ? 'grid gap-4' : 'grid items-start gap-4 sm:grid-cols-[1fr_10rem_12rem]'}
    >
      <StaffField
        name="name"
        label={t('name')}
        render={(field) => <Input {...field} ref={nameRef} defaultValue={values.name} />}
      />
      <StaffField
        name="minutes"
        label={t('length')}
        render={(field) => (
          <NativeSelect {...field} defaultValue={String(values.minutes)}>
            {typeLengthChoices(values.minutes).map((minutes) => (
              <NativeSelectOption key={minutes} value={String(minutes)}>
                {t('lengthChoice', { minutes })}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      />
      <StaffField
        name="price"
        label={t('price', { currency })}
        render={(field) => <Input {...field} inputMode="decimal" defaultValue={values.price} />}
      />
      <StaffField
        name="needsAftercare"
        label={t('needsAftercare')}
        orientation="horizontal"
        className={stacked ? undefined : 'sm:col-span-3'}
        render={(field) => <Checkbox {...field} defaultChecked={values.needsAftercare} />}
      />
    </div>
  );
}
