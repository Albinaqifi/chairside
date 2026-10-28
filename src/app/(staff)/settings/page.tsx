import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { currentStaff } from '@/app/_lib/auth';
import { PageClinic } from '@/app/_lib/frame-clinic';
import { can } from '@/modules/auth';
import { phoneWithCountryCode } from '@/modules/patients';
import * as tenancy from '@/modules/tenancy';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs';
import { membershipExtras } from '../navigation';
import { readClinicSettings, readClosedDays, readOpeningHours } from './actions';
import { countryChoices, currencyChoices, languageChoices, zoneChoices } from './clinic-choices';
import { ClinicDetailsForm } from './clinic-details-form';
import { ClosedDays } from './closed-days';
import { weekValues } from './opening-hours';
import { OpeningHoursForm } from './opening-hours-form';
import { readProviders } from './provider-actions';
import { Providers } from './providers';
import { readTreatmentTypes } from './treatment-type-actions';
import { TreatmentTypes } from './treatment-types';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('shell.pageTitle', { page: t('nav.settings') }) };
}

/**
 * Settings (E01-T08a, demo lines 746–757): the owner's alone (settings.manage, scope-v1.md). Anyone
 * else is answered "not found", as the new-patient page answers; the reads and the saves check the
 * permission themselves too (security-privacy.md, section 2). Its tabs hold four now, Clinic,
 * Opening hours (E01-T08b), whose closed days stand under the week, outside its form (E01-T08c),
 * Providers (E01-T09b) and Treatment types (E01-T09a): each later tab comes with its task (Staff
 * E04-T02, Message channels E03-T06), none shown before.
 *
 * Everything the forms start with is made here, on the server: the phone with its country code
 * (D-111), so a phone country changed in the same save leaves the number as it was, and the
 * countries, which the phone package gives (D-097), and every name the selects show. Each form is
 * keyed by the clinic the page was rendered for (D-098): a render for another clinic, after another
 * tab chose one, starts a form filled with that clinic's rows, never one holding the first's.
 */
export default async function SettingsPage() {
  const staff = await currentStaff();
  if (!can(staff.clinic.role, membershipExtras(staff.clinic), 'settings.manage')) notFound();
  const read = await readClinicSettings.forPage({});
  if (!read.ok) throw new Error(`The clinic's settings could not be read (${read.error.code}).`);
  const { details, timeZones } = read.value;
  const hours = await readOpeningHours.forPage({});
  if (!hours.ok) throw new Error(`The opening hours could not be read (${hours.error.code}).`);
  const closedDays = await readClosedDays.forPage({});
  if (!closedDays.ok) {
    throw new Error(`The closed days could not be read (${closedDays.error.code}).`);
  }
  const providers = await readProviders.forPage({});
  if (!providers.ok) {
    throw new Error(`The providers could not be read (${providers.error.code}).`);
  }
  const catalogue = await readTreatmentTypes.forPage({});
  if (!catalogue.ok) {
    throw new Error(`The treatment types could not be read (${catalogue.error.code}).`);
  }
  const [nav, t, languageName, locale] = await Promise.all([
    getTranslations('nav'),
    getTranslations('settings'),
    getTranslations('languages'),
    getLocale(),
  ]);
  return (
    <div className="max-w-245 motion-safe:animate-enter">
      <PageClinic clinicId={staff.clinic.clinicId} />
      <h1 className="mb-4.5 font-serif text-heading tracking-heading">{nav('settings')}</h1>
      <Tabs defaultValue="clinic">
        <TabsList aria-label={t('sections')}>
          <TabsTrigger value="clinic">{t('clinic.tab')}</TabsTrigger>
          <TabsTrigger value="hours">{t('hours.tab')}</TabsTrigger>
          <TabsTrigger value="providers">{t('providers.tab')}</TabsTrigger>
          <TabsTrigger value="treatments">{t('treatmentTypes.tab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="clinic">
          <div className="rounded-card border border-border bg-surface px-5.5 py-5">
            <ClinicDetailsForm
              key={staff.clinic.clinicId}
              values={{
                name: details.name,
                phone: details.phone === null ? '' : phoneWithCountryCode(details.phone),
                address: details.address ?? '',
                email: details.email ?? '',
                timeZone: details.timeZone,
                locale: details.locale,
                currency: details.currency,
                country: details.country,
              }}
              choices={{
                timeZones: zoneChoices(timeZones, details.timeZone),
                languages: languageChoices(tenancy.CLINIC_LOCALES, details.locale, (code) =>
                  languageName(code),
                ),
                currencies: currencyChoices(
                  tenancy.clinicCurrencies(),
                  details.currency,
                  locale,
                  (name, code) => t('clinic.currencyChoice', { name, code }),
                ),
                countries: countryChoices(tenancy.clinicCountries(), details.country, locale),
              }}
            />
          </div>
        </TabsContent>
        <TabsContent value="hours">
          <div className="rounded-card border border-border bg-surface px-5.5 py-5">
            <OpeningHoursForm key={staff.clinic.clinicId} week={weekValues(hours.value)} />
          </div>
          <div className="mt-4 rounded-card border border-border bg-surface px-5.5 py-5">
            <ClosedDays key={staff.clinic.clinicId} days={closedDays.value} />
          </div>
        </TabsContent>
        <TabsContent value="providers">
          <div className="rounded-card border border-border bg-surface px-5.5 py-5">
            <Providers key={staff.clinic.clinicId} providers={providers.value} />
          </div>
        </TabsContent>
        <TabsContent value="treatments">
          <div className="rounded-card border border-border bg-surface px-5.5 py-5">
            <TreatmentTypes
              key={staff.clinic.clinicId}
              types={catalogue.value.types}
              currency={catalogue.value.currency}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
