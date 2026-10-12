'use server';

import { refresh } from 'next/cache';
import { z } from 'zod';
import { refuse, staffAction, staffRead } from '@/app/_lib/actions';
import * as patients from '@/modules/patients';
import * as tenancy from '@/modules/tenancy';

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
