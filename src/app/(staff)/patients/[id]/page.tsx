import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { currentStaff } from '@/app/_lib/auth';
import { PageClinic } from '@/app/_lib/frame-clinic';
import { can } from '@/modules/auth';
import { membershipExtras } from '../../navigation';
import { readPatient } from './actions';
import { PatientProfileView } from './patient-profile';

/** A generic title: a patient's name does not go in the tab, the browser's history or a bookmark. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('shell.pageTitle', { page: t('patientProfile.title') }) };
}

/**
 * A patient's profile (E01-T03a), opened from a row of the patient list or by its address. Every
 * member sees every patient of their clinic (Q-11, D-096); the read checks that itself. Opening it
 * is a view of a patient record: each render writes one `patient.viewed` row, so the list's links
 * never prefetch it (prefetch={false}), as a prefetch would write a row nobody opened. An id that
 * is no UUID, or no patient of this clinic (another clinic's too), is a 404 and writes no row.
 * Edit opens the edit page (E01-T03b) for whoever has patients.manage.
 */
export default async function PatientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await currentStaff();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const read = await readPatient.forPage({ patientId: id });
  if (!read.ok) {
    if (read.error.code === 'not_found') notFound();
    throw new Error(`The patient could not be read (${read.error.code}).`);
  }
  return (
    <div className="motion-safe:animate-enter">
      <PageClinic clinicId={staff.clinic.clinicId} />
      <PatientProfileView
        read={read.value}
        canEdit={can(staff.clinic.role, membershipExtras(staff.clinic), 'patients.manage')}
      />
    </div>
  );
}
