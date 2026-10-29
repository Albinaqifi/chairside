import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { currentStaff } from '@/app/_lib/auth';
import { PageClinic } from '@/app/_lib/frame-clinic';
import { can } from '@/modules/auth';
import { membershipExtras } from '../../../navigation';
import { readPatient } from '../actions';
import { EditPatientForm } from './edit-patient-form';
import { editValuesOf } from './edit-values';

/** A generic title: a patient's name does not go in the tab, the browser's history or a bookmark. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('shell.pageTitle', { page: t('editPatient.title') }) };
}

/**
 * Edit a patient (E01-T03b), opened by Edit on the profile. For whoever has patients.manage, every
 * member (scope-v1.md); its action checks that itself. The page reads the patient with the
 * profile's own audited read, so opening it is one `patient.viewed` row, and an id that is no UUID,
 * or no patient of this clinic (another clinic's too), is a 404 and writes none. The form is filled
 * with the stored values, the phone as the clinic writes it (D-097), and keyed by the clinic and the
 * patient (D-098): a render for another clinic, after another tab chose one, starts a form holding
 * nothing that was typed for the first.
 */
export default async function EditPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await currentStaff();
  if (!can(staff.clinic.role, membershipExtras(staff.clinic), 'patients.manage')) notFound();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const read = await readPatient.forPage({ patientId: id });
  if (!read.ok) {
    if (read.error.code === 'not_found') notFound();
    throw new Error(`The patient could not be read (${read.error.code}).`);
  }
  const { profile } = read.value;
  const t = await getTranslations('editPatient');
  return (
    <div className="motion-safe:animate-enter">
      <PageClinic clinicId={staff.clinic.clinicId} />
      <Link
        href={`/patients/${profile.id}`}
        prefetch={false}
        className="mb-3 inline-block font-medium text-link hover:text-link-hover"
      >
        {t('back')}
      </Link>
      <div className="mb-4.5">
        <h1 className="font-serif text-heading tracking-heading">{t('title')}</h1>
        <p className="text-small text-muted">{t('intro')}</p>
      </div>
      <EditPatientForm
        key={`${staff.clinic.clinicId}:${profile.id}`}
        patientId={profile.id}
        status={profile.status}
        values={editValuesOf(profile)}
      />
    </div>
  );
}
