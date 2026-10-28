import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/ui/badge';
import type { ProfileRead, ProfileVisit } from './actions';

/** A visit's day and time, "Fri, Oct 9, 10:00": the time on the 24-hour clock the locale sets. */
const VISIT_WHEN = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
} as const;
/** A visit of the history, "Mar 12, 2026". */
const VISIT_DAY = { day: 'numeric', month: 'short', year: 'numeric' } as const;
/** "Patient since": the day the record was made, in the clinic's zone (the provider's). */
const SINCE = { day: 'numeric', month: 'long', year: 'numeric' } as const;
/**
 * A date of birth is a calendar date, no moment: it is read as UTC midnight and shown in UTC, so no
 * zone moves it to the day before (D-098).
 */
const BORN = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' } as const;

const SECTION = 'rounded-card border border-border bg-surface px-5 py-4.5';

/**
 * The patient profile (E01-T03a, demo lines 348–446): the header, then two columns, one on a phone.
 * On the left, what the clinic knows of the patient, the guardian and the note ("Not a clinical
 * record"); on the right, the next appointment and the history of completed visits. The sections the
 * demo shows for later epics are not drawn, not even empty (Messages, Communication, Care plan,
 * Treatment plan, Send plan, Book appointment): a card with nothing behind it tells the front desk
 * something is there. A value the patient has none of reads as plain text, never a made-up value.
 * Moments go through the formatter and the clinic's zone (src/i18n/request.ts).
 */
export function PatientProfileView({ read }: { read: ProfileRead }) {
  const t = useTranslations('patientProfile');
  const tPatients = useTranslations('patients');
  const format = useFormatter();
  const locale = useLocale();
  const { profile, next, history } = read;
  return (
    <div className="max-w-310">
      <Link
        href="/patients"
        className="mb-3 inline-block font-medium text-link hover:text-link-hover"
      >
        {t('back')}
      </Link>
      <div className="mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-heading tracking-heading">
            {tPatients('fullName', { first: profile.firstName, last: profile.lastName })}
          </h1>
          {profile.status !== 'active' && (
            <Badge variant={profile.status}>{tPatients(profile.status)}</Badge>
          )}
        </div>
        <ul className="mt-1 flex flex-wrap gap-x-4 text-muted">
          {profile.age !== null && <li>{t('age', { age: profile.age })}</li>}
          <li>{profile.phone ?? t('noPhone')}</li>
          <li>{profile.email ?? t('noEmail')}</li>
          <li>{t('since', { date: format.dateTime(new Date(profile.createdAt), SINCE) })}</li>
        </ul>
        {profile.guardianName !== null && (
          <p className="mt-1 text-small text-muted">
            {t('guardianContact', { name: profile.guardianName })}
          </p>
        )}
      </div>
      <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid gap-5">
          <section className={SECTION} aria-labelledby="profile-details">
            <h2 id="profile-details" className="mb-2 text-section font-semibold">
              {t('details')}
            </h2>
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2">
              <dt className="text-muted">{t('dateOfBirth')}</dt>
              <dd>
                {profile.dateOfBirth === null
                  ? t('noDateOfBirth')
                  : format.dateTime(new Date(profile.dateOfBirth), BORN)}
              </dd>
              <dt className="text-muted">{t('language')}</dt>
              <dd>{languageName(profile.language, locale)}</dd>
              {profile.guardianName !== null && (
                <>
                  <dt className="text-muted">{t('guardian')}</dt>
                  <dd>{profile.guardianName}</dd>
                </>
              )}
            </dl>
          </section>
          <section className={SECTION} aria-labelledby="profile-notes">
            <h2 id="profile-notes" className="text-section font-semibold">
              {t('notes')}
            </h2>
            <p className="mb-2 text-caption text-muted">{t('notesLabel')}</p>
            {profile.notes === '' ? (
              <p className="text-muted">{t('noNotes')}</p>
            ) : (
              <p className="whitespace-pre-wrap">{profile.notes}</p>
            )}
          </section>
        </div>
        <div className="grid gap-5">
          <section
            className="rounded-card border border-primary-soft bg-primary-soft/40 px-4.5 py-4"
            aria-labelledby="profile-next"
          >
            <h2 id="profile-next" className="text-small text-muted">
              {t('next')}
            </h2>
            {next === null ? (
              <p className="mt-0.5 text-muted">{t('noNext')}</p>
            ) : (
              <>
                <p className="mt-0.5 text-section font-semibold">
                  {format.dateTime(new Date(next.startsAt), VISIT_WHEN)}
                </p>
                <p className="text-small text-muted">
                  {t('visitWith', { what: next.what, provider: next.providerName })}
                </p>
              </>
            )}
          </section>
          <section className={SECTION} aria-labelledby="profile-history">
            <h2 id="profile-history" className="mb-1.5 text-section font-semibold">
              {t('history')}
            </h2>
            {history.length === 0 ? (
              <p className="text-muted">{t('noHistory')}</p>
            ) : (
              <ul>
                {history.map((visit) => (
                  <HistoryRow key={visit.id} visit={visit} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ visit }: { visit: ProfileVisit }) {
  const t = useTranslations('patientProfile');
  const format = useFormatter();
  return (
    <li className="flex justify-between gap-2.5 border-t border-border py-2.25 first:border-t-0">
      <div className="min-w-0">
        <p className="font-medium">{visit.what}</p>
        <p className="text-caption text-muted">
          {t('byProvider', { provider: visit.providerName })}
        </p>
      </div>
      <p className="text-small whitespace-nowrap text-muted">
        {format.dateTime(new Date(visit.startsAt), VISIT_DAY)}
      </p>
    </li>
  );
}

/** A language's name in the page's language ("Macedonian"); its code when the browser knows no name. */
function languageName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames(locale, { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
