'use server';

import { refresh } from 'next/cache';
import { z } from 'zod';
import { refuse, staffAction, staffRead } from '@/app/_lib/actions';
import type { TenantTransaction } from '@/db/tenant';
import * as scheduling from '@/modules/scheduling';
import * as tenancy from '@/modules/tenancy';
import {
  currencyDigits,
  minorUnits,
  PRICE_TEXT_MAX,
  readPriceText,
  TYPE_LENGTH_MAX,
  type PriceText,
} from './treatment-type-fields';

/*
 * The Treatment types tab (E01-T09a): the owner's alone (settings.manage, scope-v1.md), as every
 * Settings action. What the input alone settles is the schema's, shown at its field (D-098): a name
 * empty or too long, a length that is no whole number of minutes, a price whose form is wrong. What
 * needs the clinic's settings or rows is the handler's refusal, shown above the button: decimals the
 * clinic's currency has none of (price_decimals), a price above what the column holds
 * (price_too_high), an active type of the same name (name_taken). Each change writes one audit row
 * about the type, of ids alone: a type's name and price are no patient's, and never logged either.
 */

/** A type's name: trimmed, then not empty, at most TREATMENT_TYPE_NAME_MAX characters. */
const typeName = z.string().trim().min(1).max(scheduling.TREATMENT_TYPE_NAME_MAX);

/**
 * The length: the select's value, whole minutes from 1 to a day. The select offers 5 to 240 in steps
 * of 5 and the type's own (treatment-type-fields.ts); any other whole length is still one a booking
 * can take, so it is not refused.
 */
const typeLength = z
  .string()
  .regex(/^\d{1,4}$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(TYPE_LENGTH_MAX));

/**
 * The price, optional: '' or blanks are none (null). Otherwise its parts when its form is right
 * (readPriceText: "1500", "12.50", "12,5"), else a problem at the field; its text is never in the
 * issue's message, and nothing here throws (CLAUDE.md, Logs).
 */
const typePrice = z
  .string()
  .max(PRICE_TEXT_MAX)
  .optional()
  .transform((value, ctx): PriceText | null => {
    if (value === undefined || value.trim() === '') return null;
    const price = readPriceText(value);
    if (price === null) {
      ctx.addIssue({ code: 'invalid_format', format: 'price', message: 'price' });
      return z.NEVER;
    }
    return price;
  });

/** "Needs aftercare": Radix's hidden checkbox sends "on" when ticked, nothing when not. */
const aftercareField = z
  .literal('on')
  .optional()
  .transform((value) => value === 'on');

const typeFields = z.object({
  name: typeName,
  minutes: typeLength,
  price: typePrice,
  needsAftercare: aftercareField,
});

/** A row's form: the type's id, hidden. */
const typeId = z.object({ treatmentTypeId: z.uuid() });

/**
 * The fields as the module takes them, the price in the minor units of the clinic's currency, read in
 * this transaction (tenancy.clinicDetails); or the refusal of a price that currency cannot hold.
 */
async function fieldsToStore(
  tx: TenantTransaction,
  fields: z.output<typeof typeFields>,
): Promise<scheduling.TreatmentTypeFields | { refusal: 'price_decimals' | 'price_too_high' }> {
  let price: number | null = null;
  if (fields.price !== null) {
    const { currency } = await tenancy.clinicDetails(tx);
    const minor = minorUnits(fields.price, currencyDigits(currency));
    if (!minor.ok) return { refusal: minor.code };
    price = minor.minor;
  }
  return {
    name: fields.name,
    minutes: fields.minutes,
    price,
    needsAftercare: fields.needsAftercare,
  };
}

/**
 * The clinic's types, the active ones first, each by name, and its currency, for the Settings page
 * (forPage). Nothing in them is a patient's: no audit row.
 */
export const readTreatmentTypes = staffRead(
  { permission: 'settings.manage', input: z.object({}) },
  async ({ tx }) => ({
    types: await scheduling.clinicTreatmentTypes(tx),
    currency: (await tenancy.clinicDetails(tx)).currency,
  }),
);

/**
 * Adds a type (scheduling.addTreatmentType), active, with one audit row, treatment_type.created,
 * about the new type. Refused, with nothing written: price_decimals, price_too_high, name_taken. When
 * it is done, the page is rendered again (refresh()): the list, and the booking drawer's next read
 * offers the type.
 */
export const addTreatmentType = staffAction(
  {
    permission: 'settings.manage',
    input: typeFields,
    audit: {
      action: 'treatment_type.created',
      entityType: 'treatment_type',
      entityId: { result: 'id' },
    },
  },
  async ({ input, tx, now }) => {
    const fields = await fieldsToStore(tx, input);
    if ('refusal' in fields) return refuse(fields.refusal);
    const added = await scheduling.addTreatmentType(tx, fields, now);
    if (!added.ok) return refuse(added.code);
    refresh();
    return { id: added.id };
  },
);

/**
 * Changes a type's name, length, price and aftercare flag (scheduling.changeTreatmentType), with one
 * audit row, treatment_type.updated, about the type. The appointments booked with it stay as they
 * were. Refused, with nothing written: price_decimals, price_too_high, not_found (no type of the
 * clinic by that id), name_taken.
 */
export const changeTreatmentType = staffAction(
  {
    permission: 'settings.manage',
    input: typeFields.extend(typeId.shape),
    audit: {
      action: 'treatment_type.updated',
      entityType: 'treatment_type',
      entityId: ({ input }) => input.treatmentTypeId,
    },
  },
  async ({ input, tx, now }) => {
    const fields = await fieldsToStore(tx, input);
    if ('refusal' in fields) return refuse(fields.refusal);
    const changed = await scheduling.changeTreatmentType(tx, input.treatmentTypeId, fields, now);
    if (!changed.ok) return refuse(changed.code);
    refresh();
    return { id: input.treatmentTypeId };
  },
);

/**
 * Makes a type inactive (scheduling.setTreatmentTypeActive), sent by its row's Make inactive with the
 * id hidden, with one audit row, treatment_type.deactivated. Its appointments stay; no new booking
 * takes it. Refused, with nothing written: not_found, already_inactive.
 */
export const deactivateTreatmentType = staffAction(
  {
    permission: 'settings.manage',
    input: typeId,
    audit: {
      action: 'treatment_type.deactivated',
      entityType: 'treatment_type',
      entityId: ({ input }) => input.treatmentTypeId,
    },
  },
  async ({ input, tx, now }) => {
    const set = await scheduling.setTreatmentTypeActive(tx, input.treatmentTypeId, false, now);
    if (!set.ok) return refuse(set.code);
    refresh();
    return { id: input.treatmentTypeId };
  },
);

/**
 * Makes an inactive type active again, with one audit row, treatment_type.activated. Refused, with
 * nothing written: not_found, already_active, name_taken (an active type has its name).
 */
export const activateTreatmentType = staffAction(
  {
    permission: 'settings.manage',
    input: typeId,
    audit: {
      action: 'treatment_type.activated',
      entityType: 'treatment_type',
      entityId: ({ input }) => input.treatmentTypeId,
    },
  },
  async ({ input, tx, now }) => {
    const set = await scheduling.setTreatmentTypeActive(tx, input.treatmentTypeId, true, now);
    if (!set.ok) return refuse(set.code);
    refresh();
    return { id: input.treatmentTypeId };
  },
);
