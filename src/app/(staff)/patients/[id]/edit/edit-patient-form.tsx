'use client';

import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { StaffField, StaffForm } from '@/app/_lib/staff-form';
import type { PatientStatus } from '@/modules/patients';
import { NativeSelect, NativeSelectOption } from '@/ui/native-select';
import { PatientFormFields, type PatientValues } from '../../new/patient-form-fields';
import { readVisitsAhead, updatePatient, type VisitAheadRow } from './actions';

/** A visit's day and time, "Fri, Oct 9, 10:00": the time on the 24-hour clock the locale sets. */
const VISIT_WHEN = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
} as const;

/** The statuses the select offers, in order; the type makes a status the module adds a compile error. */
const STATUSES = ['active', 'archived', 'deceased'] as const satisfies readonly PatientStatus[];

/**
 * The edit form (E01-T03b): a StaffForm with the patient's fields (PatientFormFields, shared with the
 * new-patient page) filled with what is stored, and the status. It sends the frame's clinic (D-092)
 * and keeps nothing in the browser (D-093, D-095). When the patient is saved, the form goes to their
 * profile and stays disabled until it is there: the button is enabled again as soon as the action
 * answers, while the profile is still on its way. A save the clinic refuses shows its text above the
 * button; archived or deceased with a visit ahead also lists the visits, read when the refusal comes.
 * Its page keys it by the clinic and the patient (D-098).
 */
export function EditPatientForm({
  patientId,
  values,
  status,
}: {
  patientId: string;
  values: PatientValues;
  status: PatientStatus;
}) {
  const t = useTranslations('editPatient');
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [ahead, setAhead] = useState<readonly VisitAheadRow[]>([]);

  /**
   * updatePatient, and on the refusal of an archive, the visits that stand in the way: asked with the
   * clinic the form sends, after the answer. The answer is the action's own, unchanged.
   */
  const save: typeof updatePatient = async (clinicId, input) => {
    const answer = await updatePatient(clinicId, input);
    if (!answer.ok && answer.error.code === 'visits_ahead') {
      const visits = await readVisitsAhead(clinicId, { patientId });
      setAhead(visits.ok ? visits.value : []);
    } else {
      setAhead([]);
    }
    return answer;
  };

  return (
    <fieldset disabled={saved} className="min-w-0">
      <StaffForm
        action={save}
        doneMessage={t('saved')}
        onDone={() => {
          setSaved(true);
          router.push(`/patients/${patientId}`);
        }}
        refusals={{
          phone_impossible: t('phoneImpossible'),
          nothing_changed: t('nothingChanged'),
          visits_ahead: t('visitsAhead'),
          not_found: t('notFound'),
        }}
        submitLabel={t('save')}
        pendingLabel={t('saving')}
        className="max-w-2xl"
      >
        <input type="hidden" name="patientId" value={patientId} />
        <PatientFormFields values={values} />
        <StatusField status={status} />
        <VisitsAhead visits={ahead} />
      </StaffForm>
    </fieldset>
  );
}

/** The patient's status: the browser's own select, as any status may change to any other (D-113). */
function StatusField({ status }: { status: PatientStatus }) {
  const t = useTranslations('editPatient');
  return (
    <StaffField
      name="status"
      label={t('status')}
      render={(field) => (
        <NativeSelect {...field} defaultValue={status}>
          {STATUSES.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {t(`statuses.${option}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    />
  );
}

/**
 * The visits that stand in the way of an archive, above the form's button, with what to do: cancel
 * or move them first. A polite live region that is always there, so a screen reader reads the list
 * when it appears; empty, it takes no room.
 */
export function VisitsAhead({ visits }: { visits: readonly VisitAheadRow[] }) {
  const t = useTranslations('editPatient.ahead');
  const format = useFormatter();
  return (
    <div role="status">
      {visits.length > 0 && (
        <div className="grid gap-1 rounded-control border border-warn-border bg-warn-bg px-3 py-2">
          <p className="font-medium">{t('heading')}</p>
          <ul>
            {visits.map((visit) => (
              <li key={visit.id}>
                {t('visit', {
                  when: format.dateTime(new Date(visit.startsAt), VISIT_WHEN),
                  what: visit.what,
                  provider: visit.providerName,
                })}
              </li>
            ))}
          </ul>
          <p>{t('cancelFirst')}</p>
        </div>
      )}
    </div>
  );
}
