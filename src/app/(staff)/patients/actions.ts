'use server';

import { z } from 'zod';
import { staffRead } from '@/app/_lib/actions';
import { listPatients } from '@/modules/patients';
import { SEARCH_MAX_LENGTH } from './search-answer';

/**
 * The patient list and its search (E01-T02a): the page reads the first rows with forPage, and the
 * search box sends what is typed here, in the request's body, never in the page's address, which
 * the browser's history and the host's request log keep (D-095). Every member of a clinic sees
 * every patient of it (Q-11, D-096). No audit row: a list is not a patient record view
 * (security-privacy.md section 10); the profile, E01-T03, is.
 */
export const searchPatients = staffRead(
  {
    permission: 'every_member',
    input: z.object({ query: z.string().max(SEARCH_MAX_LENGTH) }),
  },
  async ({ input, tx, now }) => listPatients(tx, input.query, now),
);
