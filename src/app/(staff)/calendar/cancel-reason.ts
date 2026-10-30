/**
 * The longest reason a cancel takes, the cancel dialog's textarea `maxLength` (E01-T06e). The same
 * number as the module's `CANCEL_REASON_MAX`, which the action's schema checks: written here because
 * a client component cannot import the scheduling module (its index reaches the database), and
 * ./cancel-dialog.test.ts holds the two together.
 */
export const CANCEL_REASON_LIMIT = 200;
