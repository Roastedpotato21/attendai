-- Read-only catalog verification for a linked AttendAI database.
-- Missing or unsafe Phase 2 multi-tenant objects raise an exception.

DO $$
DECLARE
  missing TEXT;
BEGIN
  SELECT string_agg(expected.name, ', ')
  INTO missing
  FROM (VALUES
    ('institutions'), ('profiles'), ('profile_institutions'), ('roles'),
    ('profile_roles'), ('classes'), ('parents'), ('students'),
    ('student_parents'), ('faculty'), ('class_faculty'),
    ('attendance_sessions'), ('attendance_records'), ('qr_sessions'),
    ('qr_check_ins'), ('communications'), ('interventions'), ('escalations'),
    ('audit_logs')
  ) AS expected(name)
  LEFT JOIN pg_catalog.pg_class relation
    ON relation.relname = expected.name
   AND relation.relnamespace = 'public'::regnamespace
   AND relation.relkind IN ('r', 'p')
  WHERE relation.oid IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing Phase 2 tables: %', missing;
  END IF;

  SELECT string_agg(expected.name, ', ')
  INTO missing
  FROM (VALUES
    ('profile_roles'), ('classes'), ('parents'), ('students'), ('faculty'),
    ('class_faculty'), ('student_parents'), ('attendance_sessions'),
    ('attendance_records'), ('qr_sessions'), ('qr_check_ins'),
    ('communications'), ('interventions'), ('escalations'), ('audit_logs')
  ) AS expected(name)
  LEFT JOIN information_schema.columns column_record
    ON column_record.table_schema = 'public'
   AND column_record.table_name = expected.name
   AND column_record.column_name = 'institution_id'
   AND column_record.udt_name = 'uuid'
   AND column_record.is_nullable = 'NO'
  WHERE column_record.column_name IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing/non-required tenant keys: %', missing;
  END IF;

  SELECT string_agg(expected.name, ', ')
  INTO missing
  FROM (VALUES
    ('institutions'), ('profiles'), ('profile_institutions'), ('roles'),
    ('profile_roles'), ('classes'), ('parents'), ('students'),
    ('student_parents'), ('faculty'), ('class_faculty'),
    ('attendance_sessions'), ('attendance_records'), ('qr_sessions'),
    ('qr_check_ins'), ('communications'), ('interventions'), ('escalations'),
    ('audit_logs')
  ) AS expected(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint constraint_record
    WHERE constraint_record.conrelid = ('public.' || expected.name)::regclass
      AND constraint_record.contype = 'p'
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'tables without primary keys: %', missing;
  END IF;

  SELECT string_agg(expected.name, ', ')
  INTO missing
  FROM (VALUES
    ('profile_roles_membership_fkey'),
    ('profile_roles_assigner_membership_fkey'),
    ('parents_membership_fkey'),
    ('students_parent_tenant_fkey'),
    ('students_class_tenant_fkey'),
    ('faculty_membership_fkey'),
    ('class_faculty_faculty_tenant_fkey'),
    ('class_faculty_class_tenant_fkey'),
    ('student_parents_student_tenant_fkey'),
    ('student_parents_parent_tenant_fkey'),
    ('attendance_sessions_class_tenant_fkey'),
    ('attendance_sessions_submitter_membership_fkey'),
    ('attendance_records_session_tenant_fkey'),
    ('attendance_records_student_tenant_fkey'),
    ('communications_student_tenant_fkey'),
    ('communications_parent_tenant_fkey'),
    ('interventions_student_tenant_fkey'),
    ('interventions_owner_membership_fkey'),
    ('interventions_communication_tenant_fkey'),
    ('escalations_student_tenant_fkey'),
    ('escalations_class_tenant_fkey'),
    ('escalations_intervention_tenant_fkey'),
    ('escalations_owner_membership_fkey'),
    ('audit_logs_actor_membership_fkey')
  ) AS expected(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint constraint_record
    WHERE constraint_record.conname = expected.name
      AND constraint_record.contype = 'f'
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing tenant-qualified foreign keys: %', missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.profile_roles'::regclass
      AND contype = 'p'
      AND pg_get_constraintdef(oid) = 'PRIMARY KEY (profile_id, institution_id, role_code)'
  ) THEN
    RAISE EXCEPTION 'profile_roles primary key is not institution scoped';
  END IF;

  SELECT string_agg(expected.name, ', ')
  INTO missing
  FROM (VALUES
    ('idx_classes_tenant_year_name_section'),
    ('idx_parents_tenant_email'),
    ('idx_students_tenant_admission'),
    ('idx_students_tenant_class_status'),
    ('idx_faculty_tenant_employee'),
    ('idx_attendance_sessions_tenant_class_date'),
    ('idx_attendance_sessions_tenant_date'),
    ('idx_attendance_sessions_tenant_submitter_date'),
    ('idx_communications_tenant_student_created'),
    ('idx_communications_tenant_scheduled'),
    ('idx_interventions_tenant_student_status'),
    ('idx_interventions_tenant_status_created'),
    ('idx_escalations_tenant_student_status'),
    ('idx_escalations_tenant_status_created'),
    ('idx_audit_logs_tenant_created'),
    ('idx_audit_logs_tenant_actor_created'),
    ('idx_audit_logs_tenant_entity'),
    ('idx_profile_institutions_tenant_status'),
    ('idx_profile_roles_tenant_role'),
    ('idx_qr_sessions_tenant_class_active'),
    ('idx_qr_sessions_tenant_faculty_date'),
    ('idx_qr_check_ins_tenant_student')
  ) AS expected(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes index_record
    WHERE index_record.schemaname = 'public'
      AND index_record.indexname = expected.name
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing tenant-aware indexes: %', missing;
  END IF;

  SELECT string_agg(expected.name, ', ')
  INTO missing
  FROM (VALUES
    ('institutions'), ('profiles'), ('profile_institutions'), ('roles'),
    ('profile_roles'), ('classes'), ('parents'), ('students'),
    ('student_parents'), ('faculty'), ('class_faculty'),
    ('attendance_sessions'), ('attendance_records'), ('qr_sessions'),
    ('qr_check_ins'), ('communications'), ('interventions'), ('escalations'),
    ('audit_logs')
  ) AS expected(name)
  JOIN pg_catalog.pg_class relation
    ON relation.relname = expected.name
   AND relation.relnamespace = 'public'::regnamespace
  WHERE NOT relation.relrowsecurity;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'RLS is disabled on: %', missing;
  END IF;

  SELECT string_agg(expected.name, ', ')
  INTO missing
  FROM (VALUES
    ('institutions'), ('profiles'), ('profile_institutions'), ('roles'),
    ('profile_roles'), ('classes'), ('parents'), ('students'),
    ('student_parents'), ('faculty'), ('class_faculty'),
    ('attendance_sessions'), ('attendance_records'), ('qr_sessions'),
    ('qr_check_ins'), ('communications'), ('interventions'), ('escalations'),
    ('audit_logs')
  ) AS expected(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies policy
    WHERE policy.schemaname = 'public' AND policy.tablename = expected.name
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'tables without RLS policies: %', missing;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies policy
    WHERE policy.schemaname = 'public'
      AND ('anon' = ANY(policy.roles) OR 'public' = ANY(policy.roles))
  ) THEN
    RAISE EXCEPTION 'public or anon RLS policy detected';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename IN (
        'institutions', 'profile_institutions', 'profiles', 'roles',
        'profile_roles', 'faculty', 'class_faculty', 'audit_logs'
      )
      AND policy.cmd <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'browser mutation policy detected on trusted-provisioning tables';
  END IF;

  SELECT string_agg(expected.name, ', ')
  INTO missing
  FROM (VALUES
    ('is_institution_member'), ('has_institution_role'), ('can_view_profile'),
    ('can_manage_class'), ('can_manage_student'), ('can_view_student'),
    ('can_view_attendance_session')
  ) AS expected(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc function_record
    JOIN pg_catalog.pg_namespace namespace_record
      ON namespace_record.oid = function_record.pronamespace
    WHERE namespace_record.nspname = 'public'
      AND function_record.proname = expected.name
      AND function_record.prosecdef
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing SECURITY DEFINER tenant helpers: %', missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.attendance_records'::regclass
      AND tgname = 'attendance_records_inherit_institution'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'tenant inheritance trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.audit_logs'::regclass
      AND tgname = 'set_audit_actor_before_insert'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'audit actor trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.audit_logs'::regclass
      AND tgname = 'validate_audit_entity_tenant_before_write'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'audit tenant target trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_attendance_sessions_tenant_class_date'
      AND indexdef LIKE 'CREATE UNIQUE INDEX%'
  ) THEN
    RAISE EXCEPTION 'tenant daily-attendance uniqueness is missing';
  END IF;
END;
$$;

SELECT
  relation.relname AS table_name,
  relation.relrowsecurity AS rls_enabled,
  count(DISTINCT policy.policyname) AS policy_count,
  count(DISTINCT constraint_record.oid) AS constraint_count,
  count(DISTINCT index_record.indexrelid) AS index_count
FROM pg_catalog.pg_class relation
LEFT JOIN pg_catalog.pg_policies policy
  ON policy.schemaname = 'public' AND policy.tablename = relation.relname
LEFT JOIN pg_catalog.pg_constraint constraint_record
  ON constraint_record.conrelid = relation.oid
LEFT JOIN pg_catalog.pg_index index_record
  ON index_record.indrelid = relation.oid
WHERE relation.relnamespace = 'public'::regnamespace
  AND relation.relkind IN ('r', 'p')
GROUP BY relation.relname, relation.relrowsecurity
ORDER BY relation.relname;
