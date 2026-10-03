import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireUser } from '@/app/_lib/auth';
import { LogoutButton } from '@/app/_lib/logout-button';
import { clinicsForUser, ROLE_LABELS } from '@/modules/auth';
import { chooseClinic } from './actions';

export const metadata: Metadata = { title: 'Choose a clinic · Chairside' };

/** Shown to a signed-in user who belongs to several clinics, or to none. */
export default async function ChooseClinicPage() {
  const user = await requireUser();
  const choices = await clinicsForUser(user.id);
  if (choices.length === 1) redirect('/');
  return (
    <main style={{ maxWidth: '24rem', margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Chairside</h1>
      {choices.length === 0 ? (
        <p>Your account is not a member of any clinic. Ask your clinic&apos;s owner to add you.</p>
      ) : (
        <>
          <p>Choose the clinic to work in.</p>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.5rem' }}>
            {choices.map((choice) => (
              <li key={choice.clinicId}>
                <form action={chooseClinic}>
                  <input type="hidden" name="clinicId" value={choice.clinicId} />
                  <button type="submit">{choice.clinicName}</button> {ROLE_LABELS[choice.role]}
                </form>
              </li>
            ))}
          </ul>
        </>
      )}
      <p>
        <LogoutButton />
      </p>
    </main>
  );
}
