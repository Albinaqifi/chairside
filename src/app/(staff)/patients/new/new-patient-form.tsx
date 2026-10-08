'use client';

import { useRouter } from 'next/navigation';
import { useFormatter, useMessages, useTranslations } from 'next-intl';
import { startTransition, useRef, useState, type FocusEvent } from 'react';
import { useFrameClinic } from '@/app/_lib/frame-clinic';
import { StaffField, StaffForm } from '@/app/_lib/staff-form';
import type messages from '@/i18n/en.json';
import type { LikelyDuplicate } from '@/modules/patients';
import { Input } from '@/ui/input';
import { NativeSelect, NativeSelectOption } from '@/ui/native-select';
import { Textarea } from '@/ui/textarea';
import { createPatient, findLikelyDuplicates } from './actions';
import { sendCheck, typedOf } from './duplicate-answer';

/** A code of the message file's `languages` group: a language a patient's messages are written in. */
type Language = keyof typeof messages.languages;

/** A date of birth is a calendar date: shown on its own day in every zone, "Jan 1, 1990" (D-098). */
const BIRTH_DATE = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' } as const;

/**
 * The new-patient form (E01-T02b): a StaffForm with the patient's names, date of birth, language,
 * phone and email, a guardian's name and notes. It sends the frame's clinic (D-092) and keeps
 * nothing in the browser: no field sets an `autocomplete` of its own, so StaffForm's "off" holds for
 * each (D-093, D-095). The language is the browser's own select of the message file's `languages`,
 * the first one chosen (D-053). As a field the check reads is left, the form asks who the patient
 * may already be, and names them above the button; the button still saves (D-033).
 *
 * When the patient is added, the form goes to the list, and stays disabled until it is gone: the
 * button is enabled again as soon as the action answers, while the list is still on its way, and a
 * second click would add the patient twice. Its page keys it by the clinic (D-098).
 */
export function NewPatientForm() {
  const t = useTranslations('newPatient');
  const languageName = useTranslations('languages');
  const languages = Object.keys(useMessages().languages) as Language[];
  const router = useRouter();
  const clinicId = useFrameClinic();
  const [added, setAdded] = useState(false);
  const [duplicates, setDuplicates] = useState<readonly LikelyDuplicate[]>([]);
  const checked = useRef('');
  const sent = useRef(0);

  /**
   * As a field the check reads is left: what is typed, sent once for each change; an answer that
   * comes after a later check was sent is dropped. In a transition, so Next.js's redirect after an
   * ended session reaches its boundary.
   */
  function check(event: FocusEvent<HTMLInputElement>) {
    const form = event.currentTarget.form;
    if (!form) return;
    const typed = typedOf(new FormData(form));
    const key = JSON.stringify(typed);
    if (key === checked.current) return;
    checked.current = key;
    const ticket = ++sent.current;
    startTransition(async () => {
      const found = await sendCheck(findLikelyDuplicates, clinicId, typed);
      if (ticket === sent.current) setDuplicates(found);
    });
  }

  return (
    <fieldset disabled={added} className="min-w-0">
      <StaffForm
        action={createPatient}
        doneMessage={t('added')}
        onDone={() => {
          setAdded(true);
          router.push('/patients');
        }}
        refusals={{ phone_impossible: t('phoneImpossible') }}
        submitLabel={t('add')}
        pendingLabel={t('adding')}
        className="max-w-2xl"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <StaffField
            name="firstName"
            label={t('firstName')}
            render={(field) => <Input {...field} onBlur={check} />}
          />
          <StaffField
            name="lastName"
            label={t('lastName')}
            render={(field) => <Input {...field} onBlur={check} />}
          />
          <StaffField
            name="dateOfBirth"
            label={t('dateOfBirth')}
            render={(field) => <Input {...field} type="date" onBlur={check} />}
          />
          <StaffField
            name="language"
            label={t('language')}
            render={(field) => (
              <NativeSelect {...field} defaultValue={languages[0]}>
                {languages.map((code) => (
                  <NativeSelectOption key={code} value={code}>
                    {languageName(code)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          />
          <StaffField
            name="phone"
            label={t('phone')}
            render={(field) => <Input {...field} type="tel" onBlur={check} />}
          />
          <StaffField
            name="email"
            label={t('email')}
            render={(field) => <Input {...field} type="email" onBlur={check} />}
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
                <Input {...field} aria-describedby={describedBy} />
                <p id={hint} className="text-small text-muted">
                  {t('guardianHint')}
                </p>
              </>
            );
          }}
        />
        <div>
          <StaffField name="notes" label={t('notes')} render={(field) => <Textarea {...field} />} />
          <DuplicateWarning duplicates={duplicates} />
        </div>
      </StaffForm>
    </fieldset>
  );
}

/**
 * The patients the one being typed may already be (D-033), by name and date of birth, above the
 * form's button. A polite live region that is always there, so a screen reader reads the warning
 * when it appears; empty, it takes no room.
 */
export function DuplicateWarning({ duplicates }: { duplicates: readonly LikelyDuplicate[] }) {
  const t = useTranslations('newPatient.duplicate');
  const names = useTranslations('patients');
  const format = useFormatter();
  return (
    <div role="status">
      {duplicates.length > 0 && (
        <div className="mt-4 grid gap-1 rounded-control border border-warn-border bg-warn-bg px-3 py-2">
          <p className="font-medium">{t('heading')}</p>
          <ul>
            {duplicates.map((patient) => {
              const name = names('fullName', { first: patient.firstName, last: patient.lastName });
              return (
                <li key={patient.id}>
                  {patient.dateOfBirth === null
                    ? t('noBirthDate', { name })
                    : t('born', {
                        name,
                        born: format.dateTime(new Date(patient.dateOfBirth), BIRTH_DATE),
                      })}
                </li>
              );
            })}
          </ul>
          <p>{t('addAnyway')}</p>
        </div>
      )}
    </div>
  );
}
