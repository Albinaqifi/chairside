CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_provider_id_account_id_key" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"extra_permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "memberships_clinic_id_user_id_key" UNIQUE("clinic_id","user_id"),
	CONSTRAINT "memberships_role_check" CHECK ("memberships"."role" in ('owner', 'dentist', 'hygienist', 'front_desk')),
	CONSTRAINT "memberships_status_check" CHECK ("memberships"."status" in ('active', 'disabled')),
	CONSTRAINT "memberships_extra_permissions_check" CHECK ("memberships"."extra_permissions" <@ array['import', 'export']::text[])
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_check" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
-- E00-T02, hand-written from here: Row-Level Security, grants and one cross-clinic function.
-- memberships is a tenant table: visible and writable only inside its own clinic's transaction.
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "memberships_tenant_isolation" ON "memberships"
  USING ("clinic_id" = current_clinic_id())
  WITH CHECK ("clinic_id" = current_clinic_id());
--> statement-breakpoint
-- Grants for the app role (chairside_app): what the auth library needs on its global tables
-- (tests/integration/tenant-allow-list.ts), no more. The app never deletes users (E07 anonymises).
GRANT SELECT, INSERT, UPDATE ON "users" TO chairside_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sessions" TO chairside_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "accounts" TO chairside_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "verifications" TO chairside_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "rate_limits" TO chairside_app;
--> statement-breakpoint
-- The app only reads memberships in E00-T02. Creating and changing them comes with the seed and
-- the operator script (E00-T05) and with staff management (E04), each with its own grants.
GRANT SELECT ON "memberships" TO chairside_app;
--> statement-breakpoint
-- The one cross-clinic lookup of this task (security-privacy.md section 1, D-062): the clinics a
-- user may enter, needed before any clinic is set. SECURITY DEFINER: it runs with the rights of
-- the migration role, which owns the tables and is not limited by the policies. It takes one user
-- id and returns that user's active memberships, nothing else. It is on the allow-list in
-- tests/integration/tenant-allow-list.ts; the meta-test refuses every other SECURITY DEFINER
-- function. search_path is fixed, so nothing can put another "memberships" in front of ours.
CREATE FUNCTION clinics_for_user(p_user_id uuid)
  RETURNS TABLE (
    membership_id uuid,
    clinic_id uuid,
    clinic_name text,
    role text,
    extra_permissions text[]
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT m.id, m.clinic_id, c.name, m.role, m.extra_permissions
    FROM memberships m
    JOIN clinics c ON c.id = m.clinic_id
    WHERE m.user_id = p_user_id AND m.status = 'active'
    ORDER BY c.name, m.clinic_id
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION clinics_for_user(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION clinics_for_user(uuid) TO chairside_app;
