import { describe, expect, it } from 'vitest';
import type { PatientList } from '@/modules/patients';
import { afterPageRender, type ShownList } from './shown-list';

// E01-T02b (E01-T02a critical review, `slice`): what the patient list shows once its page renders
// again for the same clinic, Patients clicked again or a refresh in place. The list component keeps
// this state; the tester clicks Patients again in a browser (acceptance 8). Synthetic ids only.

function list(total: number, ids: string[]): PatientList {
  return {
    total,
    more: false,
    rows: ids.map((id) => ({
      id,
      firstName: 'Ana',
      lastName: 'Kodra',
      status: 'active',
      age: null,
      phone: null,
      lastVisit: null,
      nextVisit: null,
    })),
  };
}

const FIRST = list(1, ['01970000-0000-7000-8000-000000000a01']);
const LATER = list(2, [
  '01970000-0000-7000-8000-000000000a01',
  '01970000-0000-7000-8000-000000000a02',
]);

describe('afterPageRender', () => {
  it("with nothing typed: the later render's count and rows, at once", () => {
    const shown: ShownList = { query: '', list: FIRST };
    expect(afterPageRender(shown, LATER)).toEqual({ query: '', list: LATER });
  });

  it("with a search's rows shown: they stay, until the search sent again answers", () => {
    const searched: ShownList = { query: 'Kodra', list: FIRST };
    expect(afterPageRender(searched, LATER)).toBe(searched);
  });
});
