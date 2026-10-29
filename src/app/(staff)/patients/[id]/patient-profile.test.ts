import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '@/i18n/en.json';
import { LOCALE } from '@/i18n/locale';
import type { PatientProfile } from '@/modules/patients';
import type { ProfileRead } from './actions';
import { PatientProfileView } from './patient-profile';

// E01-T03a, acceptance 1, 2, 5 and 6: the profile as the server sends it, with next-intl's provider
// as the root layout gives it: the message file, the 24-hour locale and the clinic's time zone. The
// database is not here (tests/integration/patient-profile.test.ts reads the rows); the two columns'
// look is a screenshot in the handoff note. Every name and number is invented.

const ANA: PatientProfile = {
  id: '01970000-0000-7000-8000-0000000000a1',
  firstName: 'Ana',
  lastName: 'Brezovska',
  dateOfBirth: '1988-03-14',
  age: 38,
  phone: '070 000 101',
  email: 'ana.brezovska@example.test',
  language: 'mk',
  guardianName: null,
  notes: 'Prefers morning visits.',
  status: 'active',
  // 23:30 on 1 March in UTC: already 2 March in Skopje (+1) and Auckland (+13), still 1 March in Los Angeles.
  createdAt: '2026-03-01T23:30:00.000Z',
};

const VISIT_NEXT = {
  id: '01970000-0000-7000-8000-0000000000b1',
  // 08:05 UTC on Friday 9 October 2026: 10:05 in Skopje, 21:05 in Auckland, 01:05 in Los Angeles.
  startsAt: '2026-10-09T08:05:00.000Z',
  what: 'Filling',
  providerName: 'Elena Planinska',
};
const VISIT_DONE = {
  id: '01970000-0000-7000-8000-0000000000b2',
  startsAt: '2026-03-12T09:00:00.000Z',
  what: 'Check-up',
  providerName: 'Arben Kodra',
};

function render(
  read: Partial<Omit<ProfileRead, 'profile'>> & { profile?: Partial<PatientProfile> },
  zone = 'Europe/Skopje',
  canEdit = true,
) {
  const shown: ProfileRead = {
    profile: { ...ANA, ...read.profile },
    next: read.next === undefined ? null : read.next,
    history: read.history ?? [],
  };
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: LOCALE,
    messages,
    timeZone: zone,
    children: createElement(PatientProfileView, { read: shown, canEdit }),
  };
  return renderToString(createElement(NextIntlClientProvider, provider));
}

const t = messages.patientProfile;

/** The page's text only, as a person reads it: the tags gone, the entities decoded. */
function text(html: string): string {
  return html
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

describe('the profile shows the patient (acceptance 1)', () => {
  const html = render({ next: VISIT_NEXT, history: [VISIT_DONE] });
  const page = text(html);

  it('the header: name, age, phone, email and since', () => {
    expect(page).toContain('Ana Brezovska');
    expect(page).toContain('38 years');
    expect(page).toContain('070 000 101');
    expect(page).toContain('ana.brezovska@example.test');
    expect(page).toContain('Patient since March 2, 2026');
  });

  it('the details: date of birth and the language by name; the note under its label', () => {
    expect(page).toContain('March 14, 1988');
    expect(page).toContain('Macedonian');
    expect(page).toContain(t.notesLabel);
    expect(page).toContain('Prefers morning visits.');
  });

  it('the next appointment with provider and treatment, on the 24-hour clock', () => {
    expect(page).toContain('Fri, Oct 9, 10:05');
    expect(page).toContain('Filling with Elena Planinska');
  });

  it('the history: the treatment, the provider and the day', () => {
    expect(page).toContain('Check-up');
    expect(page).toContain('With Arben Kodra');
    expect(page).toContain('Mar 12, 2026');
  });

  it('a link back to the list, and no form: nothing to send from here', () => {
    expect(html).toContain('href="/patients"');
    expect(html).not.toContain('<form');
  });
});

describe('a child with a guardian (D-033)', () => {
  it('names the guardian, and says the phone and email are theirs', () => {
    const page = text(render({ profile: { guardianName: 'Mimoza Shkëmbi', age: 10 } }));
    expect(page).toContain("The phone and email are the guardian's: Mimoza Shkëmbi.");
    expect(page).toContain(t.guardian);
  });

  it('a patient with no guardian says nothing of one', () => {
    const page = text(render({}));
    expect(page).not.toContain(t.guardian);
    expect(page).not.toContain("the guardian's");
  });
});

describe('a status is marked (acceptance 2)', () => {
  it.each([
    ['archived', 'Archived'],
    ['deceased', 'Deceased'],
  ] as const)('%s: a pill with %s', (status, label) => {
    const html = render({ profile: { status } });
    expect(html).toContain(`data-variant="${status}"`);
    expect(text(html)).toContain(label);
  });

  it('an active patient has no pill', () => {
    expect(render({})).not.toContain('data-slot="badge"');
  });
});

describe('what the patient has none of reads as plain text, never a made-up value', () => {
  const page = text(
    render({
      profile: {
        dateOfBirth: null,
        age: null,
        phone: null,
        email: null,
        guardianName: null,
        notes: '',
      },
    }),
  );

  it.each([t.noPhone, t.noEmail, t.noDateOfBirth, t.noNotes, t.noNext, t.noHistory])(
    '%s',
    (words) => {
      expect(page).toContain(words);
    },
  );

  it('no age is shown without a date of birth', () => {
    expect(page).not.toMatch(/\d+ years?/);
  });
});

describe('sections that later epics fill are not drawn (acceptance 6)', () => {
  it.each([
    'Messages',
    'Communication',
    'Care plan',
    'Treatment plan',
    'Send plan',
    'Book appointment',
  ])('no %s', (words) => {
    const page = text(render({ next: VISIT_NEXT, history: [VISIT_DONE] }));
    expect(page).not.toContain(words);
  });

  it('no button or form control at all', () => {
    const html = render({ next: VISIT_NEXT, history: [VISIT_DONE] });
    for (const tag of ['<button', '<input', '<select', '<textarea'])
      expect(html).not.toContain(tag);
  });
});

describe('moments and the date of birth in a zone behind UTC and one far ahead (D-098, D-099)', () => {
  it.each([
    { zone: 'America/Los_Angeles', since: 'March 1, 2026', visit: 'Fri, Oct 9, 01:05' },
    { zone: 'UTC', since: 'March 1, 2026', visit: 'Fri, Oct 9, 08:05' },
    { zone: 'Europe/Skopje', since: 'March 2, 2026', visit: 'Fri, Oct 9, 10:05' },
    { zone: 'Pacific/Auckland', since: 'March 2, 2026', visit: 'Fri, Oct 9, 21:05' },
    { zone: 'Pacific/Kiritimati', since: 'March 2, 2026', visit: 'Fri, Oct 9, 22:05' },
  ])(
    '$zone: since $since, the next visit $visit, the date of birth the same day',
    ({ zone, since, visit }) => {
      const page = text(render({ next: VISIT_NEXT }, zone));
      expect(page).toContain(`Patient since ${since}`);
      expect(page).toContain(visit);
      // A calendar date is no moment: no zone moves it to the day before or after (D-098).
      expect(page).toContain('March 14, 1988');
    },
  );

  it('a date of birth at the start of a month, in the zone furthest behind UTC', () => {
    const page = text(render({ profile: { dateOfBirth: '2016-02-01' } }, 'Pacific/Pago_Pago'));
    expect(page).toContain('February 1, 2016');
  });
});

describe('the Edit link (E01-T03b)', () => {
  it('opens the edit page of this patient', () => {
    const html = render({});
    expect(html).toContain(`href="/patients/${ANA.id}/edit"`);
    expect(text(html)).toContain(t.edit);
  });

  it('is not drawn for a role without patients.manage', () => {
    const html = render({}, 'Europe/Skopje', false);
    expect(html).not.toContain('/edit"');
    expect(text(html)).not.toContain(t.edit);
  });
});
