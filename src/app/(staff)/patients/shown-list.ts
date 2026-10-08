import type { PatientList } from '@/modules/patients';

/*
 * What the patient list shows, and what it shows once its page renders again (E01-T02b, from
 * E01-T02a's critical review). No React here, so the rule is unit-tested; ./patient-list.tsx keeps
 * the state.
 */

/** The rows the list shows, and the text (trimmed) whose search found them: '' for nothing typed. */
export interface ShownList {
  query: string;
  list: PatientList;
}

/**
 * What the list shows once its page renders again in place, for the same clinic, with `rendered`
 * (Patients clicked again, a refresh in place): that render's count and rows when the list shows
 * what nothing typed finds. When it shows a search's rows, they stay until the search the list
 * sends again for what is typed answers.
 */
export function afterPageRender(shown: ShownList, rendered: PatientList): ShownList {
  return shown.query === '' ? { query: '', list: rendered } : shown;
}
