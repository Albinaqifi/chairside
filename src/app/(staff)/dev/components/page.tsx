import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { currentStaff } from '@/app/_lib/auth';
import { PageClinic } from '@/app/_lib/frame-clinic';
import { Badge, type BadgeVariant } from '@/ui/badge';
import { Button } from '@/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/ui/empty';
import { Field } from '@/ui/field';
import { Input } from '@/ui/input';
import { Logo } from '@/ui/logo';
import { DemoForm, ToastDemo } from './demo-form';

/** Each status pill, with the key of its text under devComponents.badges (the demo's, ST). */
const BADGES = [
  { variant: 'booked', key: 'booked' },
  { variant: 'no-reply', key: 'noReply' },
  { variant: 'confirmed', key: 'confirmed' },
  { variant: 'arrived', key: 'arrived' },
  { variant: 'completed', key: 'completed' },
  { variant: 'cancelled', key: 'cancelled' },
  { variant: 'no-show', key: 'noShow' },
] as const satisfies readonly { variant: BadgeVariant; key: string }[];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('shell.pageTitle', { page: t('devComponents.title') }) };
}

/**
 * /dev/components, outside production only (E00-T04c): every component of src/ui/, and a demo form
 * whose action gives each answer on request, for checks by eye and with the keyboard. In a
 * production build it answers 404 before anything else; its actions refuse there too
 * (./actions.ts). It is no item of the navigation. Like every staff page it starts from
 * currentStaff(), and the demo form sends the clinic the frame names.
 */
export default async function ComponentsPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const staff = await currentStaff();
  const t = await getTranslations('devComponents');

  return (
    <div className="motion-safe:animate-enter">
      <PageClinic clinicId={staff.clinic.clinicId} />
      <h1 className="font-serif text-heading tracking-heading">{t('title')}</h1>
      <p className="mt-1 text-muted">{t('intro')}</p>

      <Section heading={t('buttons.heading')}>
        <div className="flex flex-wrap gap-2">
          <Button type="button">{t('buttons.primary')}</Button>
          <Button type="button" variant="secondary">
            {t('buttons.secondary')}
          </Button>
          <Button type="button" variant="quiet">
            {t('buttons.quiet')}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" disabled>
            {t('buttons.primaryDisabled')}
          </Button>
          <Button type="button" variant="secondary" disabled>
            {t('buttons.secondaryDisabled')}
          </Button>
          <Button type="button" variant="quiet" disabled>
            {t('buttons.quietDisabled')}
          </Button>
        </div>
      </Section>

      <Section heading={t('fields.heading')}>
        <div className="grid max-w-md gap-4">
          <Field label={t('fields.plain')} render={(field) => <Input {...field} />} />
          <Field label={t('fields.disabled')} render={(field) => <Input {...field} disabled />} />
          <Field
            label={t('fields.invalid')}
            error={t('fields.invalidError')}
            render={(field) => <Input {...field} />}
          />
        </div>
      </Section>

      <Section heading={t('badges.heading')}>
        <div className="flex flex-wrap gap-2">
          {BADGES.map(({ variant, key }) => (
            <Badge key={variant} variant={variant}>
              {t(`badges.${key}`)}
            </Badge>
          ))}
        </div>
      </Section>

      <Section heading={t('card.heading')}>
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>{t('card.title')}</CardTitle>
            <CardDescription>{t('card.description')}</CardDescription>
            <CardAction>
              <Button type="button" variant="quiet">
                {t('card.action')}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>{t('card.content')}</CardContent>
          <CardFooter className="border-t border-border">
            <Button type="button" variant="secondary">
              {t('card.footer')}
            </Button>
          </CardFooter>
        </Card>
      </Section>

      <Section heading={t('empty.heading')}>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('empty.title')}</EmptyTitle>
            <EmptyDescription>{t('empty.description')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" variant="secondary">
              {t('empty.action')}
            </Button>
          </EmptyContent>
        </Empty>
      </Section>

      <Section heading={t('logo.heading')}>
        <Logo />
      </Section>

      <Section heading={t('toast.heading')}>
        <ToastDemo />
      </Section>

      <Section heading={t('form.heading')}>
        <p className="mb-4 max-w-xl text-muted">{t('form.intro')}</p>
        <DemoForm />
      </Section>
    </div>
  );
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-4 text-section font-semibold">{heading}</h2>
      {children}
    </section>
  );
}
