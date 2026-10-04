/**
 * The audit log (security-privacy.md, section 10): who did what, when, in which clinic. Rows are
 * only ever added; the app's database role may not change or delete them. Public API of the
 * audit module: `import * as audit from '@/modules/audit'`, then `audit.record(tx, entry)`.
 */
export {
  ACTOR_TYPES,
  record,
  type ActorType,
  type AuditEntry,
  type AuditMetadata,
  type AuditValue,
} from './record';
