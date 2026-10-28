import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import { treatmentTypes } from './schema';

/** A treatment of the clinic's catalogue the desk can book (E01-T05a). */
export interface TreatmentType {
  id: string;
  /** Its name, the title of the appointments booked with it ("Filling"). */
  name: string;
  /** How long it takes, in minutes: the length a booking starts with. */
  minutes: number;
}

/**
 * The clinic's active treatment types, by name: the ones a booking can take (E01-T05a). An
 * inactive one keeps its appointments and gets no new ones, as an inactive provider does.
 */
export async function activeTreatmentTypes(tx: TenantTransaction): Promise<TreatmentType[]> {
  return tx
    .select({
      id: treatmentTypes.id,
      name: treatmentTypes.name,
      minutes: treatmentTypes.defaultDurationMin,
    })
    .from(treatmentTypes)
    .where(eq(treatmentTypes.active, true))
    .orderBy(asc(treatmentTypes.name), asc(treatmentTypes.id));
}

/*
 * The catalogue as Settings keeps it (E01-T09a): every type of the clinic, added, changed, made
 * inactive and active again, never deleted (data-model.md: the app role has no DELETE on the table).
 * A change to a type never touches the appointments booked with it: each copied the type's name into
 * its own title, and its length into its own end, when it was booked (createAppointment).
 *
 * One active type per name, the name trimmed and in any case: "Filling" and " filling " are one name.
 * The table has no unique key on it (data-model.md has none), so the rule is kept here, under a lock
 * of the clinic's catalogue that every add, change and activation takes first (lockCatalogue).
 */

/** The longest a type's name may be, in characters, once trimmed. */
export const TREATMENT_TYPE_NAME_MAX = 100;

/** The highest price a type may have, in minor units: the largest PostgreSQL `integer`, its column. */
export const TREATMENT_PRICE_MAX = 2_147_483_647;

/** One type of the catalogue, as the Settings tab lists it. */
export interface CatalogueType extends TreatmentType {
  /** Its price, an estimate (D-043), in the clinic currency's minor units; null: none. */
  price: number | null;
  needsAftercare: boolean;
  active: boolean;
}

/** What Settings sets of a type: its name, its length, its price and its aftercare flag. */
export interface TreatmentTypeFields {
  /** Trimmed here; not empty, at most TREATMENT_TYPE_NAME_MAX characters. */
  name: string;
  /** Whole minutes above 0. */
  minutes: number;
  /** Minor units, a whole number of at least 0, or null for none. */
  price: number | null;
  needsAftercare: boolean;
}

/** Every type of the clinic, the active ones first, then the inactive, each by name. */
export async function clinicTreatmentTypes(tx: TenantTransaction): Promise<CatalogueType[]> {
  return tx
    .select({
      id: treatmentTypes.id,
      name: treatmentTypes.name,
      minutes: treatmentTypes.defaultDurationMin,
      price: treatmentTypes.defaultPrice,
      needsAftercare: treatmentTypes.needsAftercare,
      active: treatmentTypes.active,
    })
    .from(treatmentTypes)
    .orderBy(desc(treatmentTypes.active), asc(treatmentTypes.name), asc(treatmentTypes.id));
}

/** Why a type was not added: an active type has its name. */
export type AddTreatmentTypeResult = { ok: true; id: string } | { ok: false; code: 'name_taken' };

/**
 * Adds a type to the catalogue of the clinic of this transaction, active, its name trimmed, created
 * and updated at `now`; refused as `name_taken` when an active type has the name (any case), with
 * nothing written. A value the caller's schema should have refused is an Error.
 */
export async function addTreatmentType(
  tx: TenantTransaction,
  fields: TreatmentTypeFields,
  now: Date,
): Promise<AddTreatmentTypeResult> {
  const name = storable(fields, 'addTreatmentType');
  await lockCatalogue(tx);
  if (await activeNameTaken(tx, name, null)) return { ok: false, code: 'name_taken' };
  const [added] = await tx
    .insert(treatmentTypes)
    .values({
      clinicId: sql`current_clinic_id()`,
      name,
      defaultDurationMin: fields.minutes,
      defaultPrice: fields.price,
      needsAftercare: fields.needsAftercare,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: treatmentTypes.id });
  if (!added) throw new Error('addTreatmentType: the type was not written');
  return { ok: true, id: added.id };
}

/**
 * Why a type was not changed: no type of the clinic by that id (Row-Level Security shows no other
 * clinic's), or, for an active one, another active type has the new name.
 */
export type ChangeTreatmentTypeResult =
  { ok: true } | { ok: false; code: 'not_found' | 'name_taken' };

/**
 * Sets a type's name (trimmed), length, price and aftercare flag, and its `updated_at` to `now`. Its
 * `aftercare_priority` and whether it is active stay as they are. An active type may not take a name
 * another active type has (`name_taken`); an inactive one may, as it is offered nowhere, and is then
 * refused when it is made active again. The appointments booked with it keep their title and times.
 */
export async function changeTreatmentType(
  tx: TenantTransaction,
  id: string,
  fields: TreatmentTypeFields,
  now: Date,
): Promise<ChangeTreatmentTypeResult> {
  const name = storable(fields, 'changeTreatmentType');
  await lockCatalogue(tx);
  const [type] = await tx
    .select({ active: treatmentTypes.active })
    .from(treatmentTypes)
    .where(eq(treatmentTypes.id, id));
  if (!type) return { ok: false, code: 'not_found' };
  if (type.active && (await activeNameTaken(tx, name, id))) {
    return { ok: false, code: 'name_taken' };
  }
  await tx
    .update(treatmentTypes)
    .set({
      name,
      defaultDurationMin: fields.minutes,
      defaultPrice: fields.price,
      needsAftercare: fields.needsAftercare,
      updatedAt: now,
    })
    .where(thisType(id));
  return { ok: true };
}

/**
 * Why a type was not made active or inactive: no type of the clinic by that id; one that is so
 * already (a second tab, or a press the list did not drop); or, to make it active, an active type
 * that has its name.
 */
export type SetTreatmentTypeActiveRefusal =
  'not_found' | 'already_active' | 'already_inactive' | 'name_taken';

export type SetTreatmentTypeActiveResult =
  { ok: true } | { ok: false; code: SetTreatmentTypeActiveRefusal };

/**
 * Makes a type active or inactive, its `updated_at` then `now`. An inactive type is offered to no new
 * booking, and keeps every appointment booked with it (data-model.md: never deleted).
 */
export async function setTreatmentTypeActive(
  tx: TenantTransaction,
  id: string,
  active: boolean,
  now: Date,
): Promise<SetTreatmentTypeActiveResult> {
  await lockCatalogue(tx);
  const [type] = await tx
    .select({ name: treatmentTypes.name, active: treatmentTypes.active })
    .from(treatmentTypes)
    .where(eq(treatmentTypes.id, id));
  if (!type) return { ok: false, code: 'not_found' };
  if (type.active === active) {
    return { ok: false, code: active ? 'already_active' : 'already_inactive' };
  }
  if (active && (await activeNameTaken(tx, type.name, id))) {
    return { ok: false, code: 'name_taken' };
  }
  await tx.update(treatmentTypes).set({ active, updatedAt: now }).where(thisType(id));
  return { ok: true };
}

/**
 * Holds the catalogue of the clinic of this transaction until it ends: of two adds, changes or
 * activations at once, the second waits here for the first to commit or roll back, then sees its
 * row, so two types of one name are never both active. A lock of the transaction (pg_advisory_xact_lock),
 * not of a row: a clinic with no type yet has no row to lock, and its first two adds at once would
 * both find the name free. The key is the clinic's id and this table's name, hashed to 64 bits; two
 * clinics that met on one key would only wait for each other, never see each other's rows. A wait
 * longer than the lock timeout (5 s, src/db/tenant.ts) fails loudly. DISCARD ALL (D-061) has nothing
 * to end: the lock goes with the transaction.
 */
async function lockCatalogue(tx: TenantTransaction): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('treatment_types:' || current_clinic_id()::text, 0))`,
  );
}

/**
 * Whether an active type of the clinic other than `except` has this name, trimmed and in any case.
 * Compared here, never by the database's lower(): a database whose collation does not lower Cyrillic
 * would take "Пломба" and "пломба" for two names (E01-T02a).
 */
async function activeNameTaken(
  tx: TenantTransaction,
  name: string,
  except: string | null,
): Promise<boolean> {
  const active = await tx
    .select({ name: treatmentTypes.name })
    .from(treatmentTypes)
    .where(
      except === null
        ? eq(treatmentTypes.active, true)
        : and(eq(treatmentTypes.active, true), ne(treatmentTypes.id, except)),
    );
  const wanted = sameNameKey(name);
  return active.some((type) => sameNameKey(type.name) === wanted);
}

/** A name as one-per-name compares it: trimmed, in lower case. */
function sameNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The name to store, trimmed, when the fields can be stored; an Error naming the function when not:
 * the caller's schema refuses each first, at its field.
 */
function storable(fields: TreatmentTypeFields, caller: string): string {
  const name = fields.name.trim();
  const price = fields.price;
  if (
    name === '' ||
    name.length > TREATMENT_TYPE_NAME_MAX ||
    !Number.isInteger(fields.minutes) ||
    fields.minutes <= 0 ||
    (price !== null && (!Number.isSafeInteger(price) || price < 0 || price > TREATMENT_PRICE_MAX))
  ) {
    throw new Error(`${caller}: the treatment type cannot be stored`);
  }
  return name;
}

/** The type of this id, in the clinic of this transaction: Row-Level Security's, named here too. */
function thisType(id: string) {
  return and(eq(treatmentTypes.clinicId, sql`current_clinic_id()`), eq(treatmentTypes.id, id));
}
