import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { currentStaff } from '@/app/_lib/auth';
import { PageClinic } from '@/app/_lib/frame-clinic';
import { can } from '@/modules/auth';
import { phoneAsWritten } from '@/modules/patients';
import * as tenancy from '@/modules/tenancy';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs';
import { membershipExtras } from '../navigation';
import { readClinicSettings } from './actions';
import { countryChoices, currencyChoices, languageChoices, zoneChoices } from './clinic-choices';
import { ClinicDetailsForm } from './clinic-details-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('shell.pageTitle', { page: t('nav.settings') }) };
}

/**
 * Settings (E01-T08a, demo lines 746–757): the owner's alone (settings.manage, scope-v1.md). Anyone
 * else is answered "not found", as the new-patient page answers; the read and the save check the
 * permission themselves too (security-privacy.md, section 2). Its tabs hold one now, Clinic: each
 * later tab comes with its task (Opening hours E01-T08b, Providers and Treatment types E01-T09, Staff
 * E04-T02, Message channels E03-T06), none shown before.
 *
 * Everything the form starts with is made here, on the server: the phone as the clinic writes it and
 * the countries, which the phone package gives (D-097), and every name the selects show. The form is
 * keyed by the clinic the page was rendered for (D-098): a render for another clinic, after another
 * tab chose one, starts a form filled with that clinic's row, never one holding the first's.
 */
export default async function SettingsPage() {
  const staff = await currentStaff();
  if (!can(staff.clinic.role, membershipExtras(staff.clinic), 'settings.manage')) notFound();
  const read = await readClinicSettings.forPage({});
  if (!read.ok) throw new Error(`The clinic's settings could not be read (${read.error.code}).`);
  const { details, timeZones } = read.value;
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
        </TabsList>
        <TabsContent value="clinic">
          <div className="rounded-card border border-border bg-surface px-5.5 py-5">
            <ClinicDetailsForm
              key={staff.clinic.clinicId}
              values={{
                name: details.name,
                phone: details.phone === null ? '' : phoneAsWritten(details.phone, details.country),
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
      </Tabs>
    </div>
  );
}
