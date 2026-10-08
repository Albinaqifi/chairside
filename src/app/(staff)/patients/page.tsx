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
 *
 * The list is keyed by the clinic the page was rendered for. After another tab chose another
 * clinic, Patients clicked on /patients renders this page again in place, and React keeps a
 * component's state while its element keeps its type, its place and its key: without the key the
 * list kept the first clinic's count and rows under the other clinic's name. With it, a render for
 * another clinic starts a new list: that clinic's count and rows, and an empty box.
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
      <PatientList key={staff.clinic.clinicId} initial={first.value} canImport={canImport} />
    </div>
  );
}
