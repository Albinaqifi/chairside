/**
 * The demo select's choices on /dev/components (E00-T04d), by the value each sends; their texts are
 * under devComponents.choices in the message file. The demo action takes only these (./actions.ts),
 * which as a 'use server' file can export nothing but its actions.
 */
export const DEMO_CHOICES = ['first', 'second', 'third'] as const;
