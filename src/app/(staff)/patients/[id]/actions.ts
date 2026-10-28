'use server';

import { z } from 'zod';
import { refuse, staffRead } from '@/app/_lib/actions';
import * as patients from '@/modules/patients';
import * as scheduling from '@/modules/scheduling';

/** One visit as the profile shows it: moments are ISO strings, as a component takes them. */
export interface ProfileVisit {
  id: string;
  startsAt: string;
  /** The treatment type's name, or the appointment's own label when it has none. */
  what: string;
  providerName: string;
}

export interface ProfileRead {
  profile: patients.PatientProfile;
  /** The next booked or confirmed visit that has not ended, or null. */
  next: ProfileVisit | null;
  /** Completed visits, newest first, at most scheduling.HISTORY_LIMIT. */
  history: ProfileVisit[];
}

/**
 * A patient's profile (E01-T03a): the patient's record and their visits, composed here as the
 * modules read no table of one another (module rule 1). A view of a patient record: the read
 * declares it, so the wrapper writes one `patient.viewed` row (the patient's id and the entity, nothing
 * else) in this transaction, for each time the page is rendered, and none when the read refuses
 * (security-privacy.md section 10). A list, a search or a hover is no view and writes none. Every
 * member of a clinic sees every patient of it (Q-11, D-096). An id the clinic has no patient by,
 * another clinic's too, is `not_found`: the page answers 404.
 */
export const readPatient = staffRead(
  {
    permission: 'every_member',
    // Lower case: Postgres reads a uuid in any case, but the audit row stores the text, and a later
    // "who viewed this patient" (`entity_id = <id>`) must find a view however the address was typed.
    input: z.object({ patientId: z.uuid().transform((id) => id.toLowerCase()) }),
    audit: {
      action: 'patient.viewed',
      entityType: 'patient',
      entityId: ({ input }) => input.patientId,
    },
  },
  async ({ input, tx, now }) => {
    const profile = await patients.patientProfile(tx, input.patientId, now);
    if (!profile) return refuse('not_found');
    const visits = await scheduling.patientVisits(tx, input.patientId, now);
    const shown = (visit: scheduling.PatientVisit): ProfileVisit => ({
      id: visit.id,
      startsAt: visit.startsAt.toISOString(),
      what: visit.treatmentName ?? visit.title,
      providerName: visit.providerName,
    });
    return { profile, next: visits.next && shown(visits.next), history: visits.history.map(shown) };
  },
);
