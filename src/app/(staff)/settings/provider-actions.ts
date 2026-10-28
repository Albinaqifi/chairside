'use server';

import { refresh } from 'next/cache';
import { z } from 'zod';
import { refuse, staffAction, staffRead } from '@/app/_lib/actions';
import * as auth from '@/modules/auth';
import * as scheduling from '@/modules/scheduling';

/*
 * The Providers tab (E01-T09b, E01-T09d, E01-T09c): the owner's alone (settings.manage, scope-v1.md), as every
 * Settings action. What the input alone settles is the schema's, shown at its field (D-098): a name,
 * short name or chair empty or too long, a kind the select does not offer, a hue that is no whole
 * number of degrees from 0 to 359. A provider's name may repeat, as two people may share one. What
 * needs the clinic's rows is the handler's refusal, shown above the button: a kind changed on a
 * provider linked to a login (provider_linked), a provider not there (not_found), a state it has
 * already (already_inactive, already_active), a move with no place that way (already_first,
 * already_last). Each change writes one audit row about the provider, of
 * ids alone: a provider's name and chair are no patient's, and never logged either.
 */

/** A text of the form: trimmed, then not empty, at most `max` characters. */
const requiredText = (max: number) => z.string().trim().min(1).max(max);

/**
 * The colour: the range's value, a text of whole digits, read as a number of degrees from 0 to 359
 * (D-118: no number field), as the treatment types' length is read (treatment-type-actions.ts). A
 * text that is no whole number ("12.5", "-1", "abc", "") is a problem at the field, and one above 359
 * too; nothing here throws (CLAUDE.md, Logs).
 */
const colorHue = z
  .string()
  .regex(/^\d{1,3}$/)
  .transform(Number)
  .pipe(z.number().int().min(0).max(scheduling.PROVIDER_HUE_MAX));

const providerFields = z.object({
  name: requiredText(scheduling.PROVIDER_NAME_MAX),
  shortName: requiredText(scheduling.PROVIDER_SHORT_NAME_MAX),
  kind: z.enum(scheduling.PROVIDER_KINDS),
  chairLabel: requiredText(scheduling.PROVIDER_CHAIR_MAX),
  colorHue,
});

/**
 * The clinic's providers, active or not, with their kinds, in the calendar's order, for the Settings
 * page (forPage). Nothing in them is a patient's: no audit row.
 */
export const readProviders = staffRead(
  { permission: 'settings.manage', input: z.object({}) },
  async ({ tx }) => scheduling.clinicProviders(tx),
);

/**
 * Adds a provider (scheduling.addProvider), active and last in the calendar's order, with one audit
 * row, provider.created, about the new provider. When it is done, the page is rendered again
 * (refresh()): the list; and the calendar's next read shows the provider as a column, and the booking
 * drawer offers it, through what they read today (listProviders).
 */
export const addProvider = staffAction(
  {
    permission: 'settings.manage',
    input: providerFields,
    audit: { action: 'provider.created', entityType: 'provider', entityId: { result: 'id' } },
  },
  async ({ input, tx, now }) => {
    const added = await scheduling.addProvider(tx, input, now);
    refresh();
    return { id: added.id };
  },
);

/** A row's form: the provider's id, hidden. */
const providerId = z.object({ providerId: z.uuid() });

/**
 * The clinic's providers a login is linked to, by id, for the Settings page (forPage): the Edit
 * dialog locks their kind. Ids alone, nothing of the memberships; no audit row.
 */
export const readLinkedProviders = staffRead(
  { permission: 'settings.manage', input: z.object({}) },
  async ({ tx }) => auth.linkedProviderIds(tx),
);

/**
 * Changes a provider's name, short name, kind, chair and colour (scheduling.changeProvider), active
 * or not, with one audit row, provider.updated. Whether a login is linked to it is read again here,
 * in this transaction, so a crafted request cannot skip the lock of its kind: a linked provider's
 * kind other than its own is refused as provider_linked (D-051; owner, D-118), and its own saves with
 * the other fields (the dialog sends it in a hidden field beside the disabled select). Refused, with
 * nothing written: provider_linked, not_found (no provider of the clinic by that id). The calendar's
 * next read and the booking drawer show the change through what they read today (listProviders).
 */
export const changeProvider = staffAction(
  {
    permission: 'settings.manage',
    input: providerFields.extend(providerId.shape),
    audit: {
      action: 'provider.updated',
      entityType: 'provider',
      entityId: ({ input }) => input.providerId,
    },
  },
  async ({ input, tx, now }) => {
    const { providerId: id, ...fields } = input;
    const kindLocked = (await auth.linkedProviderIds(tx)).includes(id);
    const changed = await scheduling.changeProvider(tx, id, fields, now, { kindLocked });
    if (!changed.ok) return refuse(changed.code);
    refresh();
    return { id };
  },
);

/**
 * Makes a provider inactive (scheduling.setProviderActive), sent by its row's Make inactive with the
 * id hidden, with one audit row, provider.deactivated. Its appointments stay, its visits ahead still
 * booked and on the calendar, and a login linked to it keeps its access; no new booking takes it.
 * The answer carries how many visits ahead stay booked (scheduling.visitsAhead), which the row's
 * toast names (owner, D-118). Refused, with nothing written: not_found, already_inactive.
 */
export const deactivateProvider = staffAction(
  {
    permission: 'settings.manage',
    input: providerId,
    audit: {
      action: 'provider.deactivated',
      entityType: 'provider',
      entityId: ({ input }) => input.providerId,
    },
  },
  async ({ input, tx, now }) => {
    const set = await scheduling.setProviderActive(tx, input.providerId, false, now);
    if (!set.ok) return refuse(set.code);
    const visitsAhead = await scheduling.visitsAhead(tx, input.providerId, now);
    refresh();
    return { id: input.providerId, visitsAhead };
  },
);

/**
 * Moves a provider one place up or down the order (scheduling.moveProvider), sent by its row's Up or
 * Down with the id and the direction hidden, with one audit row, provider.moved, about the provider
 * (metadata: the direction). Inactive providers move as active ones do. The calendar's columns, the
 * filter chips and the booking drawer's select read the same order (listProviders), so they follow.
 * Refused, with nothing written: not_found, already_first (Up on the first), already_last (Down on
 * the last).
 */
export const moveProvider = staffAction(
  {
    permission: 'settings.manage',
    input: providerId.extend({ direction: z.enum(scheduling.PROVIDER_DIRECTIONS) }),
    audit: {
      action: 'provider.moved',
      entityType: 'provider',
      entityId: ({ input }) => input.providerId,
      metadata: ({ input }) => ({ direction: input.direction }),
    },
  },
  async ({ input, tx, now }) => {
    const moved = await scheduling.moveProvider(tx, input, now);
    if (!moved.ok) return refuse(moved.code);
    refresh();
    return { id: input.providerId };
  },
);

/**
 * Makes an inactive provider active again, with one audit row, provider.activated: a column and a
 * booking choice again. Refused, with nothing written: not_found, already_active.
 */
export const activateProvider = staffAction(
  {
    permission: 'settings.manage',
    input: providerId,
    audit: {
      action: 'provider.activated',
      entityType: 'provider',
      entityId: ({ input }) => input.providerId,
    },
  },
  async ({ input, tx, now }) => {
    const set = await scheduling.setProviderActive(tx, input.providerId, true, now);
    if (!set.ok) return refuse(set.code);
    refresh();
    return { id: input.providerId };
  },
);
