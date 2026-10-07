'use server';

import { z } from 'zod';
import { refuse, staffAction } from '@/app/_lib/actions';
import type { Staff } from '@/app/_lib/auth';
import { DEMO_CHOICES } from './demo-choices';

/*
 * The demo form's actions on /dev/components (E00-T04c): each gives the answer the form asks for,
 * so the form pattern's way of showing it can be checked by eye and with the keyboard. Outside
 * production only. A production build still builds them, and anyone who knows an action's id can
 * call it: there, its handler refuses as its first step, so nothing is done, and as a refusal rolls
 * the transaction back, no audit row is written into a real clinic either.
 */

const demoInput = z.object({
  /** Two to forty characters: a short or long one shows a field error. */
  note: z.string().trim().min(2).max(40),
  /** Four digits: anything else shows a field error. */
  code: z.string().regex(/^\d{4}$/),
  /** The textarea (E00-T04d): 1 to 200 characters, so empty or long details show a field error. */
  details: z.string().trim().min(1).max(200),
  /** The select: one of its three choices; its empty choice shows a field error. */
  choice: z.enum(DEMO_CHOICES),
  /** The checkbox and the switch: "on" when they show on; off, the browser sends nothing. */
  checkbox: z.literal('on').optional(),
  switch: z.literal('on').optional(),
  /** The answer the form asks for; forbidden is the owner-only action's (below). */
  answer: z.enum(['done', 'refusal', 'internal', 'forbidden']),
});

const demoAudit = {
  action: 'demo.answered',
  entityType: 'clinic',
  entityId: ({ staff }: { staff: Staff }) => staff.clinic.clinicId,
  metadata: ({ input }: { input: z.output<typeof demoInput> }) => ({ answer: input.answer }),
};

async function answerAsAsked({ input }: { input: z.output<typeof demoInput> }) {
  // A production build: no demo, whatever was asked.
  if (process.env.NODE_ENV === 'production') return refuse('not_found');
  if (input.answer === 'refusal') return refuse('demo_refused');
  if (input.answer === 'internal') throw new Error('The demo action failed, as it was asked to.');
  return { answer: input.answer };
}

/** Every member may: done, a refusal of its own, or something unexpected, as the form asks. */
export const demoAnswer = staffAction(
  { permission: 'every_member', input: demoInput, audit: demoAudit },
  answerAsAsked,
);

/**
 * The same, but it needs settings.manage, which only an owner has (scope-v1.md): anyone else
 * gets forbidden. The demo form sends its "forbidden" answer here.
 */
export const demoOwnerOnly = staffAction(
  { permission: 'settings.manage', input: demoInput, audit: demoAudit },
  answerAsAsked,
);
