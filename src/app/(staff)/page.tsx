import { currentStaff } from '@/app/_lib/auth';

// Placeholder until the app shell exists (E00-T04) and the schedule (E01).
export default async function Home() {
  const staff = await currentStaff();
  return (
    <>
      <h1>Today</h1>
      <p>You are signed in to {staff.clinic.clinicName}. The schedule arrives with E01.</p>
    </>
  );
}
