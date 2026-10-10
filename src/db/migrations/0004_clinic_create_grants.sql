-- E00-T05b (owner, D-101): `pnpm clinic:create` (src/db/clinic-create.ts) writes a new clinic and its
-- first owner's membership as the app role, never as the migration role, inside withTenant for the
-- new clinic's id, so Row-Level Security binds it as it binds every page. The policies let that
-- transaction add only its own clinic (clinics: "id" = current_clinic_id()) and memberships of that
-- clinic. A page or an action cannot add a clinic with it: its withTenant is for its own clinic,
-- which exists already. INSERT only, on these two tables, nothing more: no DELETE (the app never
-- deletes a clinic or a membership), no UPDATE on memberships (staff management, E04, brings its own).
-- Hand-written: no schema.ts changes (drizzle-kit's --custom).
GRANT INSERT ON "clinics" TO chairside_app;
--> statement-breakpoint
GRANT INSERT ON "memberships" TO chairside_app;
