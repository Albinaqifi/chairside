import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/app/_lib/auth';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Log in · Chairside' };

export default async function LoginPage() {
  if (await currentUser()) redirect('/');
  return (
    <main style={{ maxWidth: '24rem', margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Chairside</h1>
      <LoginForm />
    </main>
  );
}
