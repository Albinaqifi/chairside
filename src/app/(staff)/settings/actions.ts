'use server';

import { refresh } from 'next/cache';
import { z } from 'zod';
import { refuse, staffAction, staffRead } from '@/app/_lib/actions';
import { isCalendarDay } from '@/lib/calendar-day';
import * as patients from '@/modules/patients';
import * as tenancy from '@/modules/tenancy';
import { hoursFieldNames, minutesOfTimeValue, WEEKDAY_FIELDS } from './opening-hours';

/*
 * Settings (E01-T08a): the owner's alone (settings.manage, scope-v1.md). The page reads the clinic's
 * details with readClinicSettings; the Clinic tab's form sends saveClinicDetails. What the input
 * alone settles is checked here and shown at its field (D-098): tenancy.newClinicProblems(), the one
 * check `pnpm clinic:create` makes, for the name, the zone, the country, the currency and the
 * language; and the phone, read with the form's own country (D-097). Whether the database knows the
 * zone needs the transaction: that is the handler's refusal, shown above the button (D-110).
 */

/** The longest each field may be, in characters (RFC 5321's email). */
const NAME_MAX = 200;
const ADDRESS_MAX = 500;
const PHONE_MAX = 40;
const EMAIL_MAX = 254;
/** A select's value: a zone's name is at most 30 characters, a code 2 or 3. */
const CHOICE_MAX = 64;

/**
 * A field the form may leave empty: a form sends '' for it, which is none (null), never "Fill this
 * in."; so is blank text, and a field not sent at all.
 */
function optional<S extends z.ZodType>(field: S) {
  return z.preprocess(
    (value) =>
      value === undefined || (typeof value === 'string' && value.trim() === '') ? null : value,
    field.nullable(),
  );
}

const clinicDetails = z
  .object({
    /** Trimmed, then not empty: newClinicProblems() says so, below. */
    name: z.string().trim().max(NAME_MAX),
    /** As typed: read below with the form's own country. */
    phone: optional(z.string().trim().max(PHONE_MAX)),
    address: optional(z.string().trim().max(ADDRESS_MAX)),
    /** Trimmed and lower-cased, then checked. */
    email: optional(z.string().trim().toLowerCase().max(EMAIL_MAX).pipe(z.email())),
    timeZone: z.string().max(CHOICE_MAX),
    locale: z.string().max(CHOICE_MAX),
    currency: z.string().max(CHOICE_MAX),
    country: z.string().max(CHOICE_MAX),
  })
  // Runs when a field above has a problem of its value too (a type's stops it), so the form shows
  // every problem at once.
  .superRefine((details, ctx) => {
    const problems = tenancy.newClinicProblems(details);
    for (const field of problems) ctx.addIssue({ code: 'custom', path: [field], message: field });
    // A phone is read with a country the phone package knows, or not at all: the country's own
    // problem is shown then. A phone too long has its own.
    if (
      details.phone !== null &&
      details.phone.length <= PHONE_MAX &&
      !problems.includes('country') &&
      patients.readPhone(details.phone, details.country) === null
    ) {
      ctx.addIssue({ code: 'invalid_format', format: 'phone', path: ['phone'], message: 'phone' });
    }
  })
  // Runs only when nothing above had a problem, so the phone reads as the check above read it.
  .transform((details) => ({
    ...details,
    phone: details.phone === null ? null : patients.readPhone(details.phone, details.country),
  }));

/**
 * The clinic's details, for the Settings page (forPage), and every zone a clinic may have, as the
 * database spells them, for its select. Nothing in it is a patient's: no audit row.
 */
export const readClinicSettings = staffRead(
  { permission: 'settings.manage', input: z.object({}) },
  async ({ tx }) => ({
    details: await tenancy.clinicDetails(tx),
    timeZones: await tenancy.clinicTimeZones(tx),
  }),
);

/**
 * Saves the clinic's eight details (tenancy.saveClinicDetails: never its status or settings), with
 * one audit row, clinic.updated, about the clinic, whose metadata names the fields that changed,
 * never their values. A zone the database does not know is refused as time_zone_unknown, with
 * nothing written. When it is done, the page the owner is on is rendered again (refresh()), its
 * frame too: the sidebar names the clinic by its new name, and every time is in the new zone.
 */
export const saveClinicDetails = staffAction(
  {
    permission: 'settings.manage',
    input: clinicDetails,
    audit: {
      action: 'clinic.updated',
      entityType: 'clinic',
      entityId: ({ staff }) => staff.clinic.clinicId,
      metadata: { result: 'changes' },
    },
  },
  async ({ input, tx, now }) => {
    const saved = await tenancy.saveClinicDetails(tx, input, now);
    if (!saved.ok) return refuse(saved.code);
    refresh();
    return { changes: { fields: saved.changed } };
  },
);

/*
 * The Opening hours tab (E01-T08b): three flat fields a weekday (./opening-hours.ts), each declared,
 * so a problem shows at its field. Every check is the input's alone, so all are the schema's (D-098):
 * an open weekday needs both times, each a time of the day, the closing after the opening. A closed
 * weekday's times are not read, whatever was sent for them: its selects are disabled, so a browser
 * sends none.
 */

/** A switch's field: Radix's hidden checkbox sends "on" when on, nothing when off. */
const switchField = z.literal('on').optional();
/**
 * A time's field: read only for an open weekday, below, so anything is taken here, and nothing too
 * (a disabled select is not sent).
 */
const timeField = z.unknown().optional();

const openingHoursInput = z
  .object(
    Object.fromEntries(
      WEEKDAY_FIELDS.flatMap(({ key }) => {
        const names = hoursFieldNames(key);
        return [
          [names.open, switchField],
          [names.opens, timeField],
          [names.closes, timeField],
        ] as const;
      }),
    ),
  )
  .transform((sent, ctx) => {
    const week: tenancy.OpeningHours[] = [];
    for (const { weekday, key } of WEEKDAY_FIELDS) {
      const names = hoursFieldNames(key);
      if (sent[names.open] !== 'on') continue;
      const opens = timeOf(sent[names.opens], names.opens, ctx);
      const closes = timeOf(sent[names.closes], names.closes, ctx);
      if (opens === null || closes === null) continue;
      if (closes <= opens) {
        ctx.addIssue({ code: 'custom', path: [names.closes], message: names.closes });
        continue;
      }
      week.push({ weekday, opens, closes });
    }
    return week;
  });

/**
 * An open weekday's time, in minutes from midnight; or null, with the problem at its field: none
 * chosen, '' or not sent (the form shows "Fill this in."), or no time of the day.
 */
function timeOf(value: unknown, field: string, ctx: z.RefinementCtx): number | null {
  if (value === undefined || value === '') {
    ctx.addIssue({ code: 'custom', path: [field], message: field });
    return null;
  }
  const minutes = typeof value === 'string' ? minutesOfTimeValue(value) : null;
  if (minutes === null) {
    ctx.addIssue({ code: 'invalid_format', format: 'time', path: [field], message: field });
  }
  return minutes;
}

/**
 * The clinic's opening hours, for the Settings page (forPage): a row per weekday it opens, by
 * weekday. Nothing in it is a patient's: no audit row.
 */
export const readOpeningHours = staffRead(
  { permission: 'settings.manage', input: z.object({}) },
  async ({ tx }) => tenancy.openingHours(tx),
);

/**
 * Saves the week's opening hours (tenancy.saveOpeningHours: the hours and nothing else), with one
 * audit row, clinic.hours_updated, about the clinic, whose metadata names the weekdays changed (ISO
 * numbers), never their times. When it is done, the page the owner is on is rendered again
 * (refresh()), and the calendar's next read shows the new hours.
 */
export const saveOpeningHours = staffAction(
  {
    permission: 'settings.manage',
    input: openingHoursInput,
    audit: {
      action: 'clinic.hours_updated',
      entityType: 'clinic',
      entityId: ({ staff }) => staff.clinic.clinicId,
      metadata: { result: 'changes' },
    },
  },
  async ({ input, tx, now }) => {
    const saved = await tenancy.saveOpeningHours(tx, input, now);
    refresh();
    return { changes: { weekdays: saved.changed } };
  },
);

/*
 * Closed days (E01-T08c), on the Opening hours tab under the week: the clinic's closed days from its
 * today on, an add (a date and a label), and a Remove for each, every one its own StaffForm. What the
 * input alone settles is the schema's, shown at its field (D-098): a date that is no date, a label
 * empty or too long. What needs the clinic's zone or rows is the module's refusal, shown above the
 * button: a date before the clinic's today (in_the_past), one closed already (already_closed), a
 * Remove of a day no longer closed (not_closed). Each change is audited about the clinic, with the
 * date and never the label, which is free text.
 */

/**
 * A closed day's date: a date of the calendar, `YYYY-MM-DD` (isCalendarDay: 2026-02-30 is none). The
 * browser's date field sends '' for a date it cannot read, half typed: the form says "Fill this in.".
 */
const closedDate = z.string().superRefine((value, ctx) => {
  if (!isCalendarDay(value)) {
    ctx.addIssue({ code: 'invalid_format', format: 'date', message: 'date' });
  }
});

/** A closed day's label: trimmed, then not empty, at most CLOSED_DAY_LABEL_MAX characters. */
const closedLabel = z.string().trim().min(1).max(tenancy.CLOSED_DAY_LABEL_MAX);

/**
 * The clinic's closed days from its today on, by date, for the Settings page (forPage). Nothing in
 * them is a patient's: no audit row.
 */
export const readClosedDays = staffRead(
  { permission: 'settings.manage', input: z.object({}) },
  async ({ tx, now }) => tenancy.closedDaysAhead(tx, now),
);

/**
 * Closes the clinic on a day (tenancy.addClosedDay), with one audit row, clinic.closed_day_added,
 * about the clinic, whose metadata is the date. A date before the clinic's today, or one it is closed
 * on already, is refused, with nothing written. When it is done, the page is rendered again
 * (refresh()): the list, and the calendar's next read shows the day closed.
 */
export const addClosedDay = staffAction(
  {
    permission: 'settings.manage',
    input: z.object({ date: closedDate, label: closedLabel }),
    audit: {
      action: 'clinic.closed_day_added',
      entityType: 'clinic',
      entityId: ({ staff }) => staff.clinic.clinicId,
      metadata: ({ input }) => ({ date: input.date }),
    },
  },
  async ({ input, tx, now }) => {
    const added = await tenancy.addClosedDay(tx, input, now);
    if (!added.ok) return refuse(added.code);
    refresh();
    return { date: input.date };
  },
);

/**
 * Opens a closed day again (tenancy.removeClosedDay), sent by its Remove with the date hidden, with
 * one audit row, clinic.closed_day_removed, about the clinic, whose metadata is the date. A day no
 * longer closed, or one before the clinic's today, is refused, with nothing written. When it is done,
 * the page is rendered again (refresh()), as after an add.
 */
export const removeClosedDay = staffAction(
  {
    permission: 'settings.manage',
    input: z.object({ date: closedDate }),
    audit: {
      action: 'clinic.closed_day_removed',
      entityType: 'clinic',
      entityId: ({ staff }) => staff.clinic.clinicId,
      metadata: ({ input }) => ({ date: input.date }),
    },
  },
  async ({ input, tx, now }) => {
    const removed = await tenancy.removeClosedDay(tx, input.date, now);
    if (!removed.ok) return refuse(removed.code);
    refresh();
    return { date: input.date };
  },
);
