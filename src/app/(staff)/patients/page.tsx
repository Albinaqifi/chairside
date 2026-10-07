import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { currentStaff } from '@/app/_lib/auth';
import { PageClinic } from '@/app/_lib/frame-clinic';
import { membershipExtras, navigationFor } from '../navigation';
import { searchPatients } from './actions';
import { PatientList } from './patient-list';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('shell.pageTitle', { page: t('nav.patients') }) };
}

/**
 * Patients (E01-T02a): the clinic's patients, listed and found. Every member sees every patient of
 * their clinic (Q-11, D-096); the read checks that itself (searchPatients, every_member). The first
 * rows are read here, with nothing typed. Import from Excel shows for whoever the sidebar shows
 * Import to; the import page checks import.run itself (E04).
 */
export default async function PatientsPage() {
  const staff = await currentStaff();
  const first = await searchPatients.forPage({ query: '' });
  if (!first.ok) throw new Error(`The patient list could not be read (${first.error.code}).`);
  const canImport = navigationFor(staff.clinic.role, membershipExtras(staff.clinic)).some(
    (item) => item.key === 'import',
  );
  return (
    <div className="motion-safe:animate-enter">
      <PageClinic clinicId={staff.clinic.clinicId} />
      <PatientList initial={first.value} canImport={canImport} />
    </div>
  );
}
