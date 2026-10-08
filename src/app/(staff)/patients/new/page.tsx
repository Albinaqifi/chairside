import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { currentStaff } from '@/app/_lib/auth';
import { PageClinic } from '@/app/_lib/frame-clinic';
import { can } from '@/modules/auth';
import { membershipExtras } from '../../navigation';
import { NewPatientForm } from './new-patient-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('shell.pageTitle', { page: t('newPatient.title') }) };
}

/**
 * New patient (E01-T02b), opened by "New patient" on the patient list: a page, not a drawer
 * (E01-T05's booking drawer is the quick way while booking). For whoever has patients.manage, every
 * member (scope-v1.md); its action checks that itself. The form is keyed by the clinic the page was
 * rendered for (D-098): a render for another clinic, after another tab chose one, starts an empty
 * form, never one holding what was typed for the first clinic.
 */
export default async function NewPatientPage() {
  const staff = await currentStaff();
  if (!can(staff.clinic.role, membershipExtras(staff.clinic), 'patients.manage')) notFound();
  const t = await getTranslations('newPatient');
  return (
    <div className="motion-safe:animate-enter">
      <PageClinic clinicId={staff.clinic.clinicId} />
      <div className="mb-4.5">
        <h1 className="font-serif text-heading tracking-heading">{t('title')}</h1>
        <p className="text-small text-muted">{t('intro')}</p>
      </div>
      <NewPatientForm key={staff.clinic.clinicId} />
    </div>
  );
}
