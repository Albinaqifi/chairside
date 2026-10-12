'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { StaffField, StaffForm } from '@/app/_lib/staff-form';
import type { FieldControlProps } from '@/ui/field';
import { Input } from '@/ui/input';
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from '@/ui/native-select';
import { saveClinicDetails } from './actions';
import type { Choice, ZoneChoices } from './clinic-choices';

/** The clinic's details as the form starts with them: the stored values, '' for none. */
export interface ClinicDetailsValues {
  name: string;
  /**
   * With its country code (`+389 70 001 402`, phoneWithCountryCode, D-111), never in E.164: it reads
   * the same whatever phone country the same save chooses.
   */
  phone: string;
  address: string;
  email: string;
  timeZone: string;
  locale: string;
  currency: string;
  country: string;
}

/** What each select offers (./clinic-choices.ts), made by the page. */
export interface ClinicDetailsChoices {
  timeZones: ZoneChoices;
  languages: Choice[];
  currencies: Choice[];
  countries: Choice[];
}

/**
 * The Clinic tab's form (E01-T08a, demo lines 754–756): a StaffForm with the clinic's name, phone,
 * address and email, its time zone, language, currency and phone country, filled from the clinic's
 * row. It sends the frame's clinic (D-092) and keeps nothing in the browser: no field sets an
 * `autocomplete` of its own, so StaffForm's "off" holds for each (D-093, D-095). Its page keys it by
 * the clinic (D-098): a render for another clinic starts a form filled with that clinic's row.
 *
 * Each select is the browser's own (D-093), keyed by the value stored: when a save has changed it,
 * the page renders again (the action's refresh) and the select starts again from what is stored now.
 * React keeps a select's choice while its element stays, and when the option chosen leaves the list
 * (a stored value the list lacks, offered as it is, then saved as PostgreSQL spells it) the browser
 * would show, and a second save send, the first option instead.
 */
export function ClinicDetailsForm({
  values,
  choices,
}: {
  values: ClinicDetailsValues;
  choices: ClinicDetailsChoices;
}) {
  const t = useTranslations('settings.clinic');
  return (
    <StaffForm
      action={saveClinicDetails}
      doneMessage={t('saved')}
      refusals={{ time_zone_unknown: t('timeZoneUnknown') }}
      submitLabel={t('save')}
      pendingLabel={t('saving')}
    >
      {/* items-start: a field with a line under it makes its row taller, never its neighbour. */}
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <StaffField
          name="name"
          label={t('name')}
          render={(field) => <Input {...field} defaultValue={values.name} />}
        />
        <StaffField
          name="phone"
          label={t('phone')}
          render={(field) => <Input {...field} type="tel" defaultValue={values.phone} />}
        />
        <StaffField
          name="address"
          label={t('address')}
          render={(field) => <Input {...field} defaultValue={values.address} />}
        />
        <StaffField
          name="email"
          label={t('email')}
          render={(field) => <Input {...field} type="email" defaultValue={values.email} />}
        />
        <StaffField
          name="timeZone"
          label={t('timeZone')}
          render={(field) => (
            <Hinted field={field} hint={t('timeZoneHint')}>
              {(control) => (
                <NativeSelect key={values.timeZone} {...control} defaultValue={values.timeZone}>
                  {choices.timeZones.ungrouped.map((zone) => (
                    <NativeSelectOption key={zone} value={zone}>
                      {zone}
                    </NativeSelectOption>
                  ))}
                  {choices.timeZones.areas.map(({ area, zones }) => (
                    <NativeSelectOptGroup key={area} label={area}>
                      {zones.map((zone) => (
                        <NativeSelectOption key={zone} value={zone}>
                          {zone}
                        </NativeSelectOption>
                      ))}
                    </NativeSelectOptGroup>
                  ))}
                </NativeSelect>
              )}
            </Hinted>
          )}
        />
        <StaffField
          name="locale"
          label={t('language')}
          render={(field) => (
            <ChoiceSelect field={field} choices={choices.languages} stored={values.locale} />
          )}
        />
        <StaffField
          name="currency"
          label={t('currency')}
          render={(field) => (
            <ChoiceSelect field={field} choices={choices.currencies} stored={values.currency} />
          )}
        />
        <StaffField
          name="country"
          label={t('country')}
          render={(field) => (
            <Hinted field={field} hint={t('countryHint')}>
              {(control) => (
                <ChoiceSelect field={control} choices={choices.countries} stored={values.country} />
              )}
            </Hinted>
          )}
        />
      </div>
    </StaffForm>
  );
}

/** A select of choices, the stored one chosen; keyed by it, as the form's comment says. */
function ChoiceSelect({
  field,
  choices,
  stored,
}: {
  field: FieldControlProps;
  choices: Choice[];
  stored: string;
}) {
  return (
    <NativeSelect key={stored} {...field} defaultValue={stored}>
      {choices.map((choice) => (
        <NativeSelectOption key={choice.value} value={choice.value}>
          {choice.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/**
 * A control with a line under it, read with it, after its problem when it has one (as the
 * new-patient form's guardian line).
 */
function Hinted({
  field,
  hint,
  children,
}: {
  field: FieldControlProps;
  hint: string;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const hintId = `${field.id}-hint`;
  const describedBy = [field['aria-describedby'], hintId].filter(Boolean).join(' ');
  return (
    <>
      {children({ ...field, 'aria-describedby': describedBy })}
      <p id={hintId} className="text-small text-muted">
        {hint}
      </p>
    </>
  );
}
