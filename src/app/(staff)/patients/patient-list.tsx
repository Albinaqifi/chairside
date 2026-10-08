'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { useFrameClinic } from '@/app/_lib/frame-clinic';
import type { PatientList as List, PatientRow } from '@/modules/patients';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { Input } from '@/ui/input';
import { searchPatients } from './actions';
import { SEARCH_MAX_LENGTH, sendSearch, type SearchAnswer } from './search-answer';

/** How long the list waits after the last key before it searches. */
const SEARCH_DELAY_MS = 250;

/** A last visit: its day, "Mar 12, 2026". A next visit: its day and time, "Fri, Oct 9, 10:00 AM". */
const LAST_VISIT = { day: 'numeric', month: 'short', year: 'numeric' } as const;
const NEXT_VISIT = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
} as const;

/**
 * The patient list (E01-T02a, demo lines 316–347): the count of the clinic's patients, Import from
 * Excel for whoever the sidebar shows Import to, the search box, the filter All (the others come
 * with their epics), and the rows. The rows come first from the page; what is typed then goes, a
 * moment after the last key, to the patients' read with the frame's clinic (D-092): in the
 * request's body, never in the page's address (D-095). An answer that comes after a later search
 * was sent is dropped. The box is in no form and keeps nothing in the browser (D-095).
 */
export function PatientList({ initial, canImport }: { initial: List; canImport: boolean }) {
  const t = useTranslations();
  const clinicId = useFrameClinic();
  const box = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sent = useRef(0);
  const [shown, setShown] = useState({ query: '', list: initial });
  const [problem, setProblem] = useState<Exclude<SearchAnswer['kind'], 'found'> | null>(null);

  const search = useCallback(
    (typed: string) => {
      clearTimeout(timer.current);
      const ticket = ++sent.current;
      timer.current = setTimeout(() => {
        // In a transition, so Next.js's redirect after an ended session reaches its boundary.
        startTransition(async () => {
          const answer = await sendSearch(searchPatients, clinicId, typed);
          if (ticket !== sent.current) return;
          if (answer.kind === 'found') {
            setShown({ query: typed.trim(), list: answer.list });
            setProblem(null);
          } else {
            setProblem(answer.kind);
          }
        });
      }, SEARCH_DELAY_MS);
    },
    [clinicId],
  );

  // Typed before the page's script ran: React leaves it in the box, and it is searched here.
  useEffect(() => {
    const typed = box.current?.value ?? '';
    if (typed !== '') search(typed);
    return () => clearTimeout(timer.current);
  }, [search]);

  /** Reloads the page, for the clinic chosen in the other tab, with the box emptied first. */
  function reload() {
    if (box.current) box.current.value = '';
    window.location.reload();
  }

  const { list } = shown;
  return (
    <>
      <div className="mb-4.5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-heading tracking-heading">{t('nav.patients')}</h1>
          <p className="text-small text-muted">
            {list.more
              ? t('patients.countAndFirst', { count: list.total, shown: list.rows.length })
              : t('patients.count', { count: list.total })}
          </p>
        </div>
        {canImport && (
          <Button asChild variant="secondary">
            <Link href="/import">{t('patients.import')}</Link>
          </Button>
        )}
      </div>
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <Input
          ref={box}
          type="search"
          aria-label={t('patients.search')}
          placeholder={t('patients.searchPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          maxLength={SEARCH_MAX_LENGTH}
          onChange={(event) => search(event.currentTarget.value)}
          className="max-w-105 min-w-60 flex-1"
        />
        <div role="group" aria-label={t('patients.filters')}>
          <button
            type="button"
            aria-pressed="true"
            className="rounded-pill border border-panel-dark bg-panel-dark px-3 py-1.75 text-small font-medium text-on-primary"
          >
            {t('patients.all')}
          </button>
        </div>
      </div>
      {problem === 'clinic_changed' && (
        <div
          role="alert"
          className="mb-3.5 grid justify-items-start gap-2 rounded-control border border-warn-border bg-warn-bg px-3 py-2"
        >
          <p>{t('patients.clinicChanged')}</p>
          <Button type="button" variant="secondary" onClick={reload}>
            {t('form.reload')}
          </Button>
        </div>
      )}
      {problem === 'failed' && (
        <p role="alert" className="mb-3.5 rounded-control bg-error-bg px-3 py-2 text-error">
          {t('patients.failed')}
        </p>
      )}
      <PatientTable query={shown.query} rows={list.rows} />
    </>
  );
}

/**
 * The rows, as the demo draws them for the columns that exist: the name, with a pill for a patient
 * who is archived or deceased, over the age and the phone; the last visit's day; the next visit's
 * day and time. Moments are shown in the zone next-intl's provider holds, the clinic's
 * (src/i18n/request.ts), whatever the computer's. An empty state when nothing matches.
 */
export function PatientTable({ query, rows }: { query: string; rows: readonly PatientRow[] }) {
  const t = useTranslations('patients');
  const format = useFormatter();
  const cell = 'px-3 py-2.75 first:pl-4.5 last:pr-4.5';
  const heading = cn(cell, 'py-2.5 text-left font-normal');
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-5/12" />
          <col className="w-3/12" />
          <col className="w-4/12" />
        </colgroup>
        <thead className="bg-bg text-caption text-muted">
          <tr>
            <th scope="col" className={heading}>
              {t('name')}
            </th>
            <th scope="col" className={heading}>
              {t('lastVisit')}
            </th>
            <th scope="col" className={heading}>
              {t('nextVisit')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const phone = row.phone ?? t('noPhone');
            return (
              <tr key={row.id} className="border-t border-border">
                <td className={cell}>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-semibold">
                      {t('fullName', { first: row.firstName, last: row.lastName })}
                    </span>
                    {/* -my-0.5: the pill is taller than the line; its row keeps the others' height. */}
                    {row.status !== 'active' && (
                      <Badge variant={row.status} className="-my-0.5">
                        {t(row.status)}
                      </Badge>
                    )}
                  </div>
                  <div className="truncate text-caption text-muted">
                    {row.age === null ? phone : t('ageAndPhone', { age: row.age, phone })}
                  </div>
                </td>
                <td className={cell}>
                  {row.lastVisit === null
                    ? t('none')
                    : format.dateTime(new Date(row.lastVisit), LAST_VISIT)}
                </td>
                <td className={cell}>
                  {row.nextVisit === null
                    ? t('none')
                    : format.dateTime(new Date(row.nextVisit), NEXT_VISIT)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="border-t border-border px-4.5 py-7.5 text-center text-muted">
          {query === '' ? t('noPatients') : t('noMatch', { query })}
        </p>
      )}
    </div>
  );
}
