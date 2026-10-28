'use server';

import { refresh } from 'next/cache';
import { z } from 'zod';
import { staffAction, staffRead } from '@/app/_lib/actions';
import * as scheduling from '@/modules/scheduling';

/*
 * The Providers tab (E01-T09b): the owner's alone (settings.manage, scope-v1.md), as every Settings
 * action. The input alone settles every check, so each is the schema's, shown at its field (D-098):
 * a name, short name or chair empty or too long, a kind the select does not offer, a hue that is no
 * whole number of degrees from 0 to 359. No handler refusal: a provider's name may repeat, as two
 * people may share one. The add writes one audit row about the provider, of ids alone: a provider's
 * name and chair are no patient's, and never logged either.
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
