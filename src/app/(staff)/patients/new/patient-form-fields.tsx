'use client';

import { useLocale, useMessages, useTranslations } from 'next-intl';
import type { FocusEvent, ReactNode } from 'react';
import { StaffField } from '@/app/_lib/staff-form';
import type messages from '@/i18n/en.json';
import { Input } from '@/ui/input';
import { NativeSelect, NativeSelectOption } from '@/ui/native-select';
import { Textarea } from '@/ui/textarea';

/** A code of the message file's `languages` group: a language a patient's messages are written in. */
type Language = keyof typeof messages.languages;

/** What the fields start with: the patient being edited. Left out, the new-patient page's blanks. */
export interface PatientValues {
  firstName: string;
  lastName: string;
  /** `YYYY-MM-DD`, or '' for none. */
  dateOfBirth: string;
  language: string;
  phone: string;
  email: string;
  guardianName: string;
  notes: string;
}

/**
 * A patient's fields, as the new-patient page and the edit page both show them (E01-T02b,
 * E01-T03b): names, date of birth, language, phone and email, the guardian's name and notes, each a
 * StaffField of the form around it. It keeps nothing in the browser: no field sets an
 * `autocomplete` of its own, so StaffForm's "off" holds for each (D-093, D-095). The language is
 * the browser's own select of the message file's `languages`; new, the first one is chosen (D-053).
 * Texts are the `newPatient` group's. `onBlur` is called as a field the duplicate check reads is
 * left (the new-patient page's); `children` stand under the notes, where its warning goes.
 */
export function PatientFormFields({
  values,
  onBlur,
  children,
}: {
  values?: PatientValues;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  children?: ReactNode;
}) {
  const t = useTranslations('newPatient');
  const languageName = useTranslations('languages');
  const locale = useLocale();
  const offered: string[] = Object.keys(useMessages().languages);
  // A patient whose language the message file does not offer (a code another route stored) keeps
  // it: the select would otherwise show the first language, and a save would change it unasked.
  const languages =
    values && !offered.includes(values.language) ? [...offered, values.language] : offered;
  const nameOf = (code: string) =>
    offered.includes(code) ? languageName(code as Language) : displayName(code, locale);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <StaffField
          name="firstName"
          label={t('firstName')}
          render={(field) => <Input {...field} defaultValue={values?.firstName} onBlur={onBlur} />}
        />
        <StaffField
          name="lastName"
          label={t('lastName')}
          render={(field) => <Input {...field} defaultValue={values?.lastName} onBlur={onBlur} />}
        />
        <StaffField
          name="dateOfBirth"
          label={t('dateOfBirth')}
          render={(field) => (
            <Input {...field} type="date" defaultValue={values?.dateOfBirth} onBlur={onBlur} />
          )}
        />
        <StaffField
          name="language"
          label={t('language')}
          render={(field) => (
            <NativeSelect {...field} defaultValue={values?.language ?? languages[0]}>
              {languages.map((code) => (
                <NativeSelectOption key={code} value={code}>
                  {nameOf(code)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        />
        <StaffField
          name="phone"
          label={t('phone')}
          render={(field) => (
            <Input {...field} type="tel" defaultValue={values?.phone} onBlur={onBlur} />
          )}
        />
        <StaffField
          name="email"
          label={t('email')}
          render={(field) => (
            <Input {...field} type="email" defaultValue={values?.email} onBlur={onBlur} />
          )}
        />
      </div>
      <StaffField
        name="guardianName"
        label={t('guardianName')}
        render={(field) => {
          // The line under the field, read with it, after its problem when it has one.
          const hint = `${field.id}-hint`;
          const describedBy = [field['aria-describedby'], hint].filter(Boolean).join(' ');
          return (
            <>
              <Input
                {...field}
                defaultValue={values?.guardianName}
                aria-describedby={describedBy}
              />
              <p id={hint} className="text-small text-muted">
                {t('guardianHint')}
              </p>
            </>
          );
        }}
      />
      <div>
        <StaffField
          name="notes"
          label={t('notes')}
          render={(field) => <Textarea {...field} defaultValue={values?.notes} />}
        />
        {children}
      </div>
    </>
  );
}

/** A language's name in the page's language; its code when the browser knows no name. */
function displayName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames(locale, { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
