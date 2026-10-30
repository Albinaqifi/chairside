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
import { Checkbox } from '@/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from '@/ui/dialog';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/ui/empty';
import { Field } from '@/ui/field';
import { Input } from '@/ui/input';
import { Logo } from '@/ui/logo';
import { NativeSelect, NativeSelectOption } from '@/ui/native-select';
import { Sheet, SheetBody, SheetClose, SheetContent, SheetFooter, SheetTrigger } from '@/ui/sheet';
import { Switch } from '@/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs';
import { Textarea } from '@/ui/textarea';
import { DEMO_CHOICES } from './demo-choices';
import { DemoForm, NestedFormDemo, ToastDemo } from './demo-form';

/** Each status pill, with the key of its text under devComponents.badges (the demo's, ST). */
const BADGES = [
  { variant: 'booked', key: 'booked' },
  { variant: 'no-reply', key: 'noReply' },
  { variant: 'confirmed', key: 'confirmed' },
  { variant: 'arrived', key: 'arrived' },
  { variant: 'completed', key: 'completed' },
  { variant: 'cancelled', key: 'cancelled' },
  { variant: 'no-show', key: 'noShow' },
  // E01-T02a: a patient's status, in the patient list.
  { variant: 'archived', key: 'archived' },
  { variant: 'deceased', key: 'deceased' },
] as const satisfies readonly { variant: BadgeVariant; key: string }[];

/** The demo tabs, each with its text under devComponents.tabs. */
const TABS = ['first', 'second', 'third'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('shell.pageTitle', { page: t('devComponents.title') }) };
}

/**
 * /dev/components, outside production only (E00-T04c): every component of src/ui/, and a demo form
 * whose action gives each answer on request, for checks by eye and with the keyboard. In a
 * production build it answers 404 before anything else; its actions refuse there too
 * (./actions.ts). It is no item of the navigation. Like every staff page it starts from
 * currentStaff(), and the demo form sends the clinic the frame names. E00-T04d: each form field
 * alone, plain, disabled and with an error, and a checkbox ticked and a switch on. E00-T04e: three
 * tabs, a drawer at each of its two widths and the dialog, each with a field that takes the first
 * focus.
 */
export default async function ComponentsPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const staff = await currentStaff();
  const t = await getTranslations('devComponents');

  /** The demo select's choices, after an empty one. */
  const choices = (
    <>
      <NativeSelectOption value="">{t('choices.empty')}</NativeSelectOption>
      {DEMO_CHOICES.map((choice) => (
        <NativeSelectOption key={choice} value={choice}>
          {t(`choices.${choice}`)}
        </NativeSelectOption>
      ))}
    </>
  );

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

      <Section heading={t('textarea.heading')}>
        <div className="grid max-w-md gap-4">
          <Field label={t('textarea.plain')} render={(field) => <Textarea {...field} />} />
          <Field
            label={t('textarea.disabled')}
            render={(field) => <Textarea {...field} disabled />}
          />
          <Field
            label={t('textarea.invalid')}
            error={t('fields.invalidError')}
            render={(field) => <Textarea {...field} />}
          />
        </div>
      </Section>

      <Section heading={t('select.heading')}>
        <div className="grid max-w-md gap-4">
          <Field
            label={t('select.plain')}
            render={(field) => (
              <NativeSelect {...field} defaultValue="">
                {choices}
              </NativeSelect>
            )}
          />
          <Field
            label={t('select.disabled')}
            render={(field) => (
              <NativeSelect {...field} defaultValue="second" disabled>
                {choices}
              </NativeSelect>
            )}
          />
          <Field
            label={t('select.invalid')}
            error={t('fields.invalidError')}
            render={(field) => (
              <NativeSelect {...field} defaultValue="">
                {choices}
              </NativeSelect>
            )}
          />
        </div>
      </Section>

      <Section heading={t('checkbox.heading')}>
        <div className="grid max-w-md gap-4">
          <Field
            label={t('checkbox.plain')}
            orientation="horizontal"
            render={(field) => <Checkbox {...field} />}
          />
          <Field
            label={t('checkbox.checked')}
            orientation="horizontal"
            render={(field) => <Checkbox {...field} defaultChecked />}
          />
          <Field
            label={t('checkbox.disabled')}
            orientation="horizontal"
            render={(field) => <Checkbox {...field} disabled />}
          />
          <Field
            label={t('checkbox.invalid')}
            orientation="horizontal"
            error={t('fields.invalidError')}
            render={(field) => <Checkbox {...field} />}
          />
        </div>
      </Section>

      <Section heading={t('switch.heading')}>
        <div className="grid max-w-md gap-4">
          <Field
            label={t('switch.plain')}
            orientation="horizontal"
            render={(field) => <Switch {...field} />}
          />
          <Field
            label={t('switch.on')}
            orientation="horizontal"
            render={(field) => <Switch {...field} defaultChecked />}
          />
          <Field
            label={t('switch.disabled')}
            orientation="horizontal"
            render={(field) => <Switch {...field} disabled />}
          />
          <Field
            label={t('switch.invalid')}
            orientation="horizontal"
            error={t('fields.invalidError')}
            render={(field) => <Switch {...field} />}
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

      <Section heading={t('tabs.heading')}>
        <Tabs defaultValue="first" className="max-w-xl">
          <TabsList aria-label={t('tabs.label')}>
            {TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {t(`tabs.${tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="first" className="grid gap-4">
            <p className="text-muted">{t('tabs.firstContent')}</p>
            <Field
              label={t('tabs.field')}
              render={(field) => <Input {...field} autoComplete="off" />}
            />
          </TabsContent>
          <TabsContent value="second">{t('tabs.secondContent')}</TabsContent>
          <TabsContent value="third">{t('tabs.thirdContent')}</TabsContent>
        </Tabs>
      </Section>

      <Section heading={t('drawer.heading')}>
        <div className="flex flex-wrap gap-2">
          <DemoDrawer width={420} />
          <DemoDrawer width={500} />
        </div>
      </Section>

      <Section heading={t('dialog.heading')}>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">{t('dialog.open')}</Button>
          </DialogTrigger>
          <DialogContent title={t('dialog.title')} description={t('dialog.description')}>
            <Field
              label={t('dialog.field')}
              render={(field) => <Input {...field} autoComplete="off" />}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">{t('dialog.close')}</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      <Section heading={t('nested.heading')}>
        <p className="mb-4 max-w-xl text-muted">{t('nested.intro')}</p>
        <NestedFormDemo />
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

/** A button that opens a drawer of this width: a field for the first focus, a line, a button. */
async function DemoDrawer({ width }: { width: 420 | 500 }) {
  const t = await getTranslations('devComponents.drawer');
  const wide = width === 500;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="secondary">{wide ? t('openWide') : t('open')}</Button>
      </SheetTrigger>
      <SheetContent
        width={width}
        title={wide ? t('titleWide') : t('title')}
        description={wide ? t('descriptionWide') : t('description')}
      >
        <SheetBody>
          <Field label={t('field')} render={(field) => <Input {...field} autoComplete="off" />} />
          <p className="text-muted">{t('body')}</p>
        </SheetBody>
        <SheetFooter>
          <SheetClose asChild>
            <Button variant="secondary">{t('close')}</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
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
