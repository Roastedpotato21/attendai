-- Phase 2 multi-tenant foundation.
-- Profiles and role definitions are global. Memberships, role assignments,
-- and every operational record are institution scoped.

BEGIN;

CREATE TABLE public.institutions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT institutions_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT institutions_code_format CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  CONSTRAINT institutions_status_check CHECK (status IN ('active', 'inactive', 'suspended')),
  CONSTRAINT institutions_code_unique UNIQUE (code)
);

-- Existing Phase-2 rows are deterministically assigned to this tenant. The
-- migration fails on any later composite-integrity violation instead of guessing.
INSERT INTO public.institutions (id, name, code)
VALUES ('11111111-1111-4111-8111-111111111111', 'AttendAI Legacy Institution', 'legacy')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.profile_institutions (
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (profile_id, institution_id),
  CONSTRAINT profile_institutions_status_check
    CHECK (status IN ('active', 'inactive', 'suspended'))
);

INSERT INTO public.profile_institutions (profile_id, institution_id)
SELECT id, '11111111-1111-4111-8111-111111111111' FROM public.profiles
ON CONFLICT (profile_id, institution_id) DO NOTHING;

ALTER TABLE public.profile_roles
  ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE RESTRICT;
UPDATE public.profile_roles
SET institution_id = '11111111-1111-4111-8111-111111111111'
WHERE institution_id IS NULL;
ALTER TABLE public.profile_roles
  ALTER COLUMN institution_id SET NOT NULL,
  DROP CONSTRAINT profile_roles_pkey,
  ADD CONSTRAINT profile_roles_pkey PRIMARY KEY (profile_id, institution_id, role_code),
  ADD CONSTRAINT profile_roles_membership_fkey
    FOREIGN KEY (profile_id, institution_id)
    REFERENCES public.profile_institutions(profile_id, institution_id)
    ON DELETE CASCADE,
  ADD CONSTRAINT profile_roles_assigner_membership_fkey
    FOREIGN KEY (assigned_by, institution_id)
    REFERENCES public.profile_institutions(profile_id, institution_id)
    ON DELETE RESTRICT;

ALTER TABLE public.classes ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.parents ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.students ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.faculty ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.class_faculty ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.student_parents ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.attendance_sessions ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.attendance_records ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.qr_sessions ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.qr_check_ins ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.communications ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.interventions ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.escalations ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.audit_logs ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE RESTRICT;

UPDATE public.classes SET institution_id = '11111111-1111-4111-8111-111111111111' WHERE institution_id IS NULL;
UPDATE public.parents SET institution_id = '11111111-1111-4111-8111-111111111111' WHERE institution_id IS NULL;
UPDATE public.students SET institution_id = '11111111-1111-4111-8111-111111111111' WHERE institution_id IS NULL;
UPDATE public.faculty SET institution_id = '11111111-1111-4111-8111-111111111111' WHERE institution_id IS NULL;
UPDATE public.class_faculty SET institution_id = '11111111-1111-4111-8111-111111111111' WHERE institution_id IS NULL;
UPDATE public.student_parents SET institution_id = '11111111-1111-4111-8111-111111111111' WHERE institution_id IS NULL;
UPDATE public.attendance_sessions SET institution_id = '11111111-1111-4111-8111-111111111111' WHERE institution_id IS NULL;
UPDATE public.attendance_records SET institution_id = '11111111-1111-4111-8111-111111111111' WHERE institution_id IS NULL;
UPDATE public.qr_sessions SET institution_id = '11111111-1111-4111-8111-111111111111' WHERE institution_id IS NULL;
UPDATE public.qr_check_ins SET institution_id = '11111111-1111-4111-8111-111111111111' WHERE institution_id IS NULL;
UPDATE public.communications SET institution_id = '11111111-1111-4111-8111-111111111111' WHERE institution_id IS NULL;
UPDATE public.interventions SET institution_id = '11111111-1111-4111-8111-111111111111' WHERE institution_id IS NULL;
UPDATE public.escalations SET institution_id = '11111111-1111-4111-8111-111111111111' WHERE institution_id IS NULL;
UPDATE public.audit_logs SET institution_id = '11111111-1111-4111-8111-111111111111' WHERE institution_id IS NULL;

ALTER TABLE public.classes ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.parents ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.students ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.faculty ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.class_faculty ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.student_parents ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.attendance_sessions ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.attendance_records ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.qr_sessions ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.qr_check_ins ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.communications ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.interventions ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.escalations ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.audit_logs ALTER COLUMN institution_id SET NOT NULL;

-- Composite candidate keys support tenant-aware foreign keys. UUID primary
-- keys remain globally stable while every relationship also proves ownership.
ALTER TABLE public.classes ADD CONSTRAINT classes_institution_id_id_key UNIQUE (institution_id, id);
ALTER TABLE public.parents ADD CONSTRAINT parents_institution_id_id_key UNIQUE (institution_id, id);
ALTER TABLE public.students ADD CONSTRAINT students_institution_id_id_key UNIQUE (institution_id, id);
ALTER TABLE public.faculty ADD CONSTRAINT faculty_institution_id_id_key UNIQUE (institution_id, id);
ALTER TABLE public.attendance_sessions ADD CONSTRAINT attendance_sessions_institution_id_id_key UNIQUE (institution_id, id);
ALTER TABLE public.qr_sessions ADD CONSTRAINT qr_sessions_institution_id_id_key UNIQUE (institution_id, id);
ALTER TABLE public.communications ADD CONSTRAINT communications_institution_id_id_key UNIQUE (institution_id, id);
ALTER TABLE public.interventions ADD CONSTRAINT interventions_institution_id_id_key UNIQUE (institution_id, id);

ALTER TABLE public.parents
  ADD CONSTRAINT parents_membership_fkey
    FOREIGN KEY (user_id, institution_id)
    REFERENCES public.profile_institutions(profile_id, institution_id) ON DELETE RESTRICT;
ALTER TABLE public.students
  ADD CONSTRAINT students_parent_tenant_fkey
    FOREIGN KEY (institution_id, parent_id)
    REFERENCES public.parents(institution_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT students_class_tenant_fkey
    FOREIGN KEY (institution_id, class_id)
    REFERENCES public.classes(institution_id, id) ON DELETE RESTRICT;
ALTER TABLE public.faculty
  ADD CONSTRAINT faculty_membership_fkey
    FOREIGN KEY (user_id, institution_id)
    REFERENCES public.profile_institutions(profile_id, institution_id) ON DELETE RESTRICT;
ALTER TABLE public.class_faculty
  ADD CONSTRAINT class_faculty_faculty_tenant_fkey
    FOREIGN KEY (institution_id, faculty_id)
    REFERENCES public.faculty(institution_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT class_faculty_class_tenant_fkey
    FOREIGN KEY (institution_id, class_id)
    REFERENCES public.classes(institution_id, id) ON DELETE CASCADE;
ALTER TABLE public.student_parents
  ADD CONSTRAINT student_parents_student_tenant_fkey
    FOREIGN KEY (institution_id, student_id)
    REFERENCES public.students(institution_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT student_parents_parent_tenant_fkey
    FOREIGN KEY (institution_id, parent_id)
    REFERENCES public.parents(institution_id, id) ON DELETE CASCADE;
ALTER TABLE public.attendance_sessions
  ADD CONSTRAINT attendance_sessions_class_tenant_fkey
    FOREIGN KEY (institution_id, class_id)
    REFERENCES public.classes(institution_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT attendance_sessions_submitter_membership_fkey
    FOREIGN KEY (submitted_by, institution_id)
    REFERENCES public.profile_institutions(profile_id, institution_id) ON DELETE RESTRICT;
ALTER TABLE public.attendance_records
  ADD CONSTRAINT attendance_records_session_tenant_fkey
    FOREIGN KEY (institution_id, session_id)
    REFERENCES public.attendance_sessions(institution_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT attendance_records_student_tenant_fkey
    FOREIGN KEY (institution_id, student_id)
    REFERENCES public.students(institution_id, id) ON DELETE CASCADE;
ALTER TABLE public.qr_sessions
  ADD CONSTRAINT qr_sessions_class_tenant_fkey
    FOREIGN KEY (institution_id, class_id)
    REFERENCES public.classes(institution_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT qr_sessions_faculty_membership_fkey
    FOREIGN KEY (faculty_id, institution_id)
    REFERENCES public.profile_institutions(profile_id, institution_id) ON DELETE RESTRICT;
ALTER TABLE public.qr_check_ins
  ADD CONSTRAINT qr_check_ins_session_tenant_fkey
    FOREIGN KEY (institution_id, session_id)
    REFERENCES public.qr_sessions(institution_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT qr_check_ins_student_tenant_fkey
    FOREIGN KEY (institution_id, student_id)
    REFERENCES public.students(institution_id, id) ON DELETE CASCADE;
ALTER TABLE public.communications
  ADD CONSTRAINT communications_student_tenant_fkey
    FOREIGN KEY (institution_id, student_id)
    REFERENCES public.students(institution_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT communications_parent_tenant_fkey
    FOREIGN KEY (institution_id, parent_id)
    REFERENCES public.parents(institution_id, id) ON DELETE CASCADE;
ALTER TABLE public.interventions
  ADD CONSTRAINT interventions_student_tenant_fkey
    FOREIGN KEY (institution_id, student_id)
    REFERENCES public.students(institution_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT interventions_owner_membership_fkey
    FOREIGN KEY (owner_id, institution_id)
    REFERENCES public.profile_institutions(profile_id, institution_id) ON DELETE RESTRICT,
  ADD CONSTRAINT interventions_communication_tenant_fkey
    FOREIGN KEY (institution_id, communication_id)
    REFERENCES public.communications(institution_id, id) ON DELETE RESTRICT;
ALTER TABLE public.escalations
  ADD CONSTRAINT escalations_student_tenant_fkey
    FOREIGN KEY (institution_id, student_id)
    REFERENCES public.students(institution_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT escalations_class_tenant_fkey
    FOREIGN KEY (institution_id, class_id)
    REFERENCES public.classes(institution_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT escalations_intervention_tenant_fkey
    FOREIGN KEY (institution_id, intervention_id)
    REFERENCES public.interventions(institution_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT escalations_owner_membership_fkey
    FOREIGN KEY (owner_id, institution_id)
    REFERENCES public.profile_institutions(profile_id, institution_id) ON DELETE RESTRICT;
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_actor_membership_fkey
    FOREIGN KEY (actor_id, institution_id)
    REFERENCES public.profile_institutions(profile_id, institution_id) ON DELETE RESTRICT;

-- Remove superseded UUID-only foreign keys where the composite key preserves
-- the same delete action. Keeping both makes PostgREST embeds ambiguous and
-- leaves a weaker relationship in the catalog. Nullable SET NULL profile and
-- workflow references remain alongside their membership/tenant guard because
-- they preserve intentional unlink-on-delete behavior.
ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_parent_id_fkey,
  DROP CONSTRAINT IF EXISTS students_class_id_fkey;
ALTER TABLE public.class_faculty
  DROP CONSTRAINT IF EXISTS class_faculty_faculty_id_fkey,
  DROP CONSTRAINT IF EXISTS class_faculty_class_id_fkey;
ALTER TABLE public.student_parents
  DROP CONSTRAINT IF EXISTS student_parents_student_id_fkey,
  DROP CONSTRAINT IF EXISTS student_parents_parent_id_fkey;
ALTER TABLE public.attendance_sessions
  DROP CONSTRAINT IF EXISTS attendance_sessions_class_id_fkey;
ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_session_id_fkey,
  DROP CONSTRAINT IF EXISTS attendance_records_student_id_fkey;
ALTER TABLE public.qr_sessions
  DROP CONSTRAINT IF EXISTS qr_sessions_class_id_fkey;
ALTER TABLE public.qr_check_ins
  DROP CONSTRAINT IF EXISTS qr_check_ins_session_id_fkey,
  DROP CONSTRAINT IF EXISTS qr_check_ins_student_id_fkey;
ALTER TABLE public.communications
  DROP CONSTRAINT IF EXISTS communications_student_id_fkey,
  DROP CONSTRAINT IF EXISTS communications_parent_id_fkey;
ALTER TABLE public.interventions
  DROP CONSTRAINT IF EXISTS interventions_student_id_fkey;
ALTER TABLE public.escalations
  DROP CONSTRAINT IF EXISTS escalations_student_id_fkey,
  DROP CONSTRAINT IF EXISTS escalations_class_id_fkey;

DROP INDEX IF EXISTS public.idx_classes_year_name_section;
DROP INDEX IF EXISTS public.idx_parents_email;
DROP INDEX IF EXISTS public.idx_parents_user;
DROP INDEX IF EXISTS public.idx_students_admission_number;
DROP INDEX IF EXISTS public.idx_students_class_status;
DROP INDEX IF EXISTS public.idx_faculty_employee_code;
DROP INDEX IF EXISTS public.idx_faculty_user;
DROP INDEX IF EXISTS public.idx_attendance_sessions_class_date;
DROP INDEX IF EXISTS public.idx_attendance_sessions_submitted_by;
DROP INDEX IF EXISTS public.idx_communications_student_created;
DROP INDEX IF EXISTS public.idx_communications_parent_created;
DROP INDEX IF EXISTS public.idx_communications_scheduled;
DROP INDEX IF EXISTS public.idx_interventions_student_status;
DROP INDEX IF EXISTS public.idx_escalations_student_status;
DROP INDEX IF EXISTS public.idx_audit_logs_actor_created;
DROP INDEX IF EXISTS public.idx_audit_logs_entity;
DROP INDEX IF EXISTS public.idx_class_faculty_class;
DROP INDEX IF EXISTS public.idx_student_parents_parent;
DROP INDEX IF EXISTS public.idx_qr_sessions_class_active;
DROP INDEX IF EXISTS public.idx_interventions_owner_status;
DROP INDEX IF EXISTS public.idx_escalations_owner_status;

CREATE UNIQUE INDEX idx_classes_tenant_year_name_section
  ON public.classes(institution_id, academic_year, name, section);
CREATE UNIQUE INDEX idx_parents_tenant_email
  ON public.parents(institution_id, lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX idx_parents_tenant_user
  ON public.parents(institution_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_students_tenant_admission
  ON public.students(institution_id, admission_number) WHERE admission_number IS NOT NULL;
CREATE INDEX idx_students_tenant_class_status
  ON public.students(institution_id, class_id, enrollment_status);
CREATE UNIQUE INDEX idx_faculty_tenant_employee
  ON public.faculty(institution_id, employee_code) WHERE employee_code IS NOT NULL;
CREATE UNIQUE INDEX idx_faculty_tenant_user
  ON public.faculty(institution_id, user_id);
CREATE UNIQUE INDEX idx_attendance_sessions_tenant_class_date
  ON public.attendance_sessions(institution_id, class_id, date);
CREATE INDEX idx_attendance_sessions_tenant_date
  ON public.attendance_sessions(institution_id, date DESC);
CREATE INDEX idx_attendance_sessions_tenant_submitter_date
  ON public.attendance_sessions(institution_id, submitted_by, date DESC)
  WHERE submitted_by IS NOT NULL;
CREATE INDEX idx_communications_tenant_student_created
  ON public.communications(institution_id, student_id, created_at DESC);
CREATE INDEX idx_communications_tenant_parent_created
  ON public.communications(institution_id, parent_id, created_at DESC);
CREATE INDEX idx_communications_tenant_scheduled
  ON public.communications(institution_id, scheduled_for)
  WHERE scheduled_for IS NOT NULL;
CREATE INDEX idx_interventions_tenant_student_status
  ON public.interventions(institution_id, student_id, status);
CREATE INDEX idx_interventions_tenant_status_created
  ON public.interventions(institution_id, status, created_at DESC);
CREATE INDEX idx_escalations_tenant_student_status
  ON public.escalations(institution_id, student_id, status);
CREATE INDEX idx_escalations_tenant_status_created
  ON public.escalations(institution_id, status, created_at DESC);
CREATE INDEX idx_audit_logs_tenant_created
  ON public.audit_logs(institution_id, created_at DESC);
CREATE INDEX idx_audit_logs_tenant_actor_created
  ON public.audit_logs(institution_id, actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;
CREATE INDEX idx_audit_logs_tenant_entity
  ON public.audit_logs(institution_id, entity_type, entity_id)
  WHERE entity_type IS NOT NULL AND entity_id IS NOT NULL;
CREATE INDEX idx_profile_institutions_tenant_status
  ON public.profile_institutions(institution_id, status, profile_id);
CREATE INDEX idx_profile_roles_tenant_role
  ON public.profile_roles(institution_id, role_code, profile_id);
CREATE INDEX idx_class_faculty_tenant_class
  ON public.class_faculty(institution_id, class_id, faculty_id);
CREATE INDEX idx_student_parents_tenant_parent
  ON public.student_parents(institution_id, parent_id, student_id);
CREATE INDEX idx_attendance_records_tenant_student
  ON public.attendance_records(institution_id, student_id, session_id);
CREATE INDEX idx_qr_sessions_tenant_class_active
  ON public.qr_sessions(institution_id, class_id, active) WHERE active;
CREATE INDEX idx_qr_sessions_tenant_faculty_date
  ON public.qr_sessions(institution_id, faculty_id, date DESC)
  WHERE faculty_id IS NOT NULL;
CREATE INDEX idx_qr_check_ins_tenant_student
  ON public.qr_check_ins(institution_id, student_id, session_id);
CREATE INDEX idx_interventions_tenant_owner_status
  ON public.interventions(institution_id, owner_id, status) WHERE owner_id IS NOT NULL;
CREATE INDEX idx_escalations_tenant_owner_status
  ON public.escalations(institution_id, owner_id, status) WHERE owner_id IS NOT NULL;

CREATE TRIGGER set_timestamp_institutions
  BEFORE UPDATE ON public.institutions
  FOR EACH ROW EXECUTE PROCEDURE public.trigger_set_timestamp();
CREATE TRIGGER set_timestamp_profile_institutions
  BEFORE UPDATE ON public.profile_institutions
  FOR EACH ROW EXECUTE PROCEDURE public.trigger_set_timestamp();

-- Child records inherit their institution from a trusted parent reference.
-- A supplied mismatching tenant is rejected before the row reaches storage.
CREATE OR REPLACE FUNCTION public.inherit_institution_from_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  reference_id UUID;
  inherited_institution_id UUID;
BEGIN
  reference_id := (to_jsonb(NEW) ->> TG_ARGV[1])::UUID;
  EXECUTE format('SELECT institution_id FROM public.%I WHERE id = $1', TG_ARGV[0])
    INTO inherited_institution_id
    USING reference_id;

  IF inherited_institution_id IS NULL THEN
    RAISE EXCEPTION 'cannot determine institution from %.%', TG_ARGV[0], TG_ARGV[1]
      USING ERRCODE = '23503';
  END IF;
  IF NEW.institution_id IS NOT NULL AND NEW.institution_id <> inherited_institution_id THEN
    RAISE EXCEPTION 'cross-institution reference rejected'
      USING ERRCODE = '23514';
  END IF;
  NEW.institution_id = inherited_institution_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER class_faculty_inherit_institution
  BEFORE INSERT OR UPDATE OF class_id, institution_id ON public.class_faculty
  FOR EACH ROW EXECUTE PROCEDURE public.inherit_institution_from_reference('classes', 'class_id');
CREATE TRIGGER student_parents_inherit_institution
  BEFORE INSERT OR UPDATE OF student_id, institution_id ON public.student_parents
  FOR EACH ROW EXECUTE PROCEDURE public.inherit_institution_from_reference('students', 'student_id');
CREATE TRIGGER attendance_sessions_inherit_institution
  BEFORE INSERT OR UPDATE OF class_id, institution_id ON public.attendance_sessions
  FOR EACH ROW EXECUTE PROCEDURE public.inherit_institution_from_reference('classes', 'class_id');
CREATE TRIGGER attendance_records_inherit_institution
  BEFORE INSERT OR UPDATE OF session_id, institution_id ON public.attendance_records
  FOR EACH ROW EXECUTE PROCEDURE public.inherit_institution_from_reference('attendance_sessions', 'session_id');
CREATE TRIGGER qr_sessions_inherit_institution
  BEFORE INSERT OR UPDATE OF class_id, institution_id ON public.qr_sessions
  FOR EACH ROW EXECUTE PROCEDURE public.inherit_institution_from_reference('classes', 'class_id');
CREATE TRIGGER qr_check_ins_inherit_institution
  BEFORE INSERT OR UPDATE OF session_id, institution_id ON public.qr_check_ins
  FOR EACH ROW EXECUTE PROCEDURE public.inherit_institution_from_reference('qr_sessions', 'session_id');
CREATE TRIGGER communications_inherit_institution
  BEFORE INSERT OR UPDATE OF student_id, institution_id ON public.communications
  FOR EACH ROW EXECUTE PROCEDURE public.inherit_institution_from_reference('students', 'student_id');
CREATE TRIGGER interventions_inherit_institution
  BEFORE INSERT OR UPDATE OF student_id, institution_id ON public.interventions
  FOR EACH ROW EXECUTE PROCEDURE public.inherit_institution_from_reference('students', 'student_id');
CREATE TRIGGER escalations_inherit_institution
  BEFORE INSERT OR UPDATE OF student_id, institution_id ON public.escalations
  FOR EACH ROW EXECUTE PROCEDURE public.inherit_institution_from_reference('students', 'student_id');

CREATE OR REPLACE FUNCTION public.validate_profile_student_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.student_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.students student
    JOIN public.profile_institutions membership
      ON membership.profile_id = NEW.id
     AND membership.institution_id = student.institution_id
     AND membership.status = 'active'
    WHERE student.id = NEW.student_id
  ) THEN
    RAISE EXCEPTION 'student profile must have an active membership in the student institution'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_profile_student_membership_before_write
  BEFORE INSERT OR UPDATE OF student_id ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.validate_profile_student_membership();

-- audit_logs.entity_id is intentionally polymorphic. When it is populated,
-- validate its supported entity type and prove that the target belongs to the
-- same institution. This closes the one relationship that cannot use a normal
-- composite foreign key.
CREATE OR REPLACE FUNCTION public.validate_audit_entity_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  target_institution_id UUID;
BEGIN
  IF NEW.entity_id IS NULL AND NEW.entity_type IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.entity_id IS NULL OR NEW.entity_type IS NULL THEN
    RAISE EXCEPTION 'audit entity_type and entity_id must be supplied together'
      USING ERRCODE = '23514';
  END IF;

  CASE NEW.entity_type
    WHEN 'institution' THEN
      SELECT id INTO target_institution_id
      FROM public.institutions WHERE id = NEW.entity_id;
    WHEN 'profile' THEN
      SELECT institution_id INTO target_institution_id
      FROM public.profile_institutions
      WHERE profile_id = NEW.entity_id
        AND institution_id = NEW.institution_id;
    WHEN 'class' THEN
      SELECT institution_id INTO target_institution_id FROM public.classes WHERE id = NEW.entity_id;
    WHEN 'parent' THEN
      SELECT institution_id INTO target_institution_id FROM public.parents WHERE id = NEW.entity_id;
    WHEN 'student' THEN
      SELECT institution_id INTO target_institution_id FROM public.students WHERE id = NEW.entity_id;
    WHEN 'faculty' THEN
      SELECT institution_id INTO target_institution_id FROM public.faculty WHERE id = NEW.entity_id;
    WHEN 'attendance_session' THEN
      SELECT institution_id INTO target_institution_id FROM public.attendance_sessions WHERE id = NEW.entity_id;
    WHEN 'attendance_record' THEN
      SELECT institution_id INTO target_institution_id FROM public.attendance_records WHERE id = NEW.entity_id;
    WHEN 'qr_session' THEN
      SELECT institution_id INTO target_institution_id FROM public.qr_sessions WHERE id = NEW.entity_id;
    WHEN 'qr_check_in' THEN
      SELECT institution_id INTO target_institution_id FROM public.qr_check_ins WHERE id = NEW.entity_id;
    WHEN 'communication' THEN
      SELECT institution_id INTO target_institution_id FROM public.communications WHERE id = NEW.entity_id;
    WHEN 'intervention' THEN
      SELECT institution_id INTO target_institution_id FROM public.interventions WHERE id = NEW.entity_id;
    WHEN 'escalation' THEN
      SELECT institution_id INTO target_institution_id FROM public.escalations WHERE id = NEW.entity_id;
    ELSE
      RAISE EXCEPTION 'unsupported tenant-owned audit entity type: %', NEW.entity_type
        USING ERRCODE = '23514';
  END CASE;

  IF target_institution_id IS NULL OR target_institution_id <> NEW.institution_id THEN
    RAISE EXCEPTION 'audit entity belongs to another institution or does not exist'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_audit_entity_tenant_before_write
  BEFORE INSERT OR UPDATE OF institution_id, entity_type, entity_id ON public.audit_logs
  FOR EACH ROW EXECUTE PROCEDURE public.validate_audit_entity_tenant();

CREATE OR REPLACE FUNCTION public.set_audit_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  membership_count INTEGER;
  inferred_institution_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.actor_id = public.current_profile_id();
  END IF;

  IF NEW.institution_id IS NULL AND NEW.actor_id IS NOT NULL THEN
    SELECT count(*), (array_agg(institution_id))[1]
    INTO membership_count, inferred_institution_id
    FROM public.profile_institutions
    WHERE profile_id = NEW.actor_id AND status = 'active';
    IF membership_count <> 1 THEN
      RAISE EXCEPTION 'audit institution must be explicit for multi-institution actors'
        USING ERRCODE = '23514';
    END IF;
    NEW.institution_id = inferred_institution_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_institution_member(target_institution_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profile_institutions membership
    JOIN public.profiles profile ON profile.id = membership.profile_id
    JOIN public.institutions institution ON institution.id = membership.institution_id
    WHERE membership.profile_id = public.current_profile_id()
      AND membership.institution_id = target_institution_id
      AND membership.status = 'active'
      AND profile.status = 'active'
      AND institution.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_institution_role(
  target_institution_id UUID,
  required_roles user_role[]
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_institution_member(target_institution_id) AND EXISTS (
    SELECT 1
    FROM public.profile_roles assignment
    WHERE assignment.profile_id = public.current_profile_id()
      AND assignment.institution_id = target_institution_id
      AND assignment.role_code = ANY(required_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.shares_institution(target_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profile_institutions mine
    JOIN public.profile_institutions theirs
      ON theirs.institution_id = mine.institution_id
     AND theirs.profile_id = target_profile_id
     AND theirs.status = 'active'
    WHERE mine.profile_id = public.current_profile_id()
      AND mine.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_profile(target_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT target_profile_id = public.current_profile_id() OR EXISTS (
    SELECT 1
    FROM public.profile_institutions target_membership
    WHERE target_membership.profile_id = target_profile_id
      AND target_membership.status = 'active'
      AND public.is_institution_member(target_membership.institution_id)
      AND (
        public.has_institution_role(
          target_membership.institution_id,
          ARRAY['admin', 'staff']::user_role[]
        )
        OR EXISTS (
          SELECT 1
          FROM public.profile_roles target_role
          WHERE target_role.profile_id = target_profile_id
            AND target_role.institution_id = target_membership.institution_id
            AND target_role.role_code = 'faculty'
        )
        OR EXISTS (
          SELECT 1
          FROM public.profiles target_profile
          WHERE target_profile.id = target_profile_id
            AND target_profile.student_id IS NOT NULL
            AND public.can_manage_student(target_profile.student_id)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_class(target_class_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.classes class_record
    WHERE class_record.id = target_class_id
      AND (
        public.has_institution_role(
          class_record.institution_id,
          ARRAY['admin', 'staff']::user_role[]
        )
        OR EXISTS (
          SELECT 1
          FROM public.faculty faculty_record
          JOIN public.class_faculty assignment
            ON assignment.faculty_id = faculty_record.id
           AND assignment.institution_id = faculty_record.institution_id
          WHERE assignment.class_id = class_record.id
            AND faculty_record.user_id = public.current_profile_id()
            AND faculty_record.active
            AND public.has_institution_role(
              class_record.institution_id,
              ARRAY['faculty']::user_role[]
            )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_student(target_student_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.students student
    WHERE student.id = target_student_id
      AND (
        public.has_institution_role(
          student.institution_id,
          ARRAY['admin', 'staff']::user_role[]
        )
        OR public.can_manage_class(student.class_id)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_student(target_student_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students student
    WHERE student.id = target_student_id
      AND public.is_institution_member(student.institution_id)
      AND (
        public.can_manage_student(student.id)
        OR EXISTS (
          SELECT 1 FROM public.profiles profile
          WHERE profile.id = public.current_profile_id()
            AND profile.student_id = student.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.student_parents relationship
          JOIN public.parents parent_record
            ON parent_record.id = relationship.parent_id
           AND parent_record.institution_id = relationship.institution_id
          WHERE relationship.student_id = student.id
            AND relationship.institution_id = student.institution_id
            AND parent_record.user_id = public.current_profile_id()
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_attendance_session(target_session_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.attendance_sessions attendance_session
    WHERE attendance_session.id = target_session_id
      AND public.is_institution_member(attendance_session.institution_id)
      AND (
        public.can_manage_class(attendance_session.class_id)
        OR EXISTS (
          SELECT 1 FROM public.attendance_records record
          WHERE record.session_id = attendance_session.id
            AND record.institution_id = attendance_session.institution_id
            AND public.can_view_student(record.student_id)
        )
      )
  );
$$;

-- Signup creates only a global profile. Institution membership and roles are
-- provisioned by a trusted server/admin path in a later phase.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, auth_user_id, name, email, role, status)
  VALUES (
    NEW.id,
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'name', ''), split_part(COALESCE(NEW.email, ''), '@', 1), 'AttendAI user'),
    NEW.email,
    'student',
    'active'
  );
  RETURN NEW;
END;
$$;

ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_institutions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  policy_record RECORD;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'profiles', 'roles', 'profile_roles', 'classes', 'parents', 'students',
        'student_parents', 'faculty', 'class_faculty', 'attendance_sessions',
        'attendance_records', 'qr_sessions', 'qr_check_ins', 'communications',
        'interventions', 'escalations', 'audit_logs'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  END LOOP;
END;
$$;

CREATE POLICY institutions_select ON public.institutions
  FOR SELECT TO authenticated USING (public.is_institution_member(id));
CREATE POLICY profile_institutions_select ON public.profile_institutions
  FOR SELECT TO authenticated
  USING (
    profile_id = public.current_profile_id()
    OR public.has_institution_role(institution_id, ARRAY['admin']::user_role[])
  );
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (public.can_view_profile(id));
CREATE POLICY roles_select ON public.roles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY profile_roles_select ON public.profile_roles
  FOR SELECT TO authenticated
  USING (
    profile_id = public.current_profile_id()
    OR public.has_institution_role(institution_id, ARRAY['admin']::user_role[])
  );
CREATE POLICY classes_select ON public.classes
  FOR SELECT TO authenticated USING (public.is_institution_member(institution_id));
CREATE POLICY classes_admin_manage ON public.classes
  FOR ALL TO authenticated
  USING (public.has_institution_role(institution_id, ARRAY['admin']::user_role[]))
  WITH CHECK (public.has_institution_role(institution_id, ARRAY['admin']::user_role[]));
CREATE POLICY parents_select ON public.parents
  FOR SELECT TO authenticated
  USING (
    public.is_institution_member(parents.institution_id)
    AND (
      parents.user_id = public.current_profile_id()
      OR EXISTS (
        SELECT 1 FROM public.student_parents relationship
        WHERE relationship.parent_id = parents.id
          AND relationship.institution_id = parents.institution_id
          AND public.can_manage_student(relationship.student_id)
      )
    )
  );
CREATE POLICY parents_manage ON public.parents
  FOR ALL TO authenticated
  USING (
    public.has_institution_role(
      parents.institution_id,
      ARRAY['admin', 'staff']::user_role[]
    )
  )
  WITH CHECK (
    public.has_institution_role(parents.institution_id, ARRAY['admin', 'staff']::user_role[])
  );
CREATE POLICY students_select ON public.students
  FOR SELECT TO authenticated USING (public.can_view_student(id));
CREATE POLICY students_manage ON public.students
  FOR ALL TO authenticated
  USING (public.can_manage_student(id))
  WITH CHECK (public.can_manage_class(class_id));
CREATE POLICY student_parents_select ON public.student_parents
  FOR SELECT TO authenticated USING (public.can_view_student(student_id));
CREATE POLICY student_parents_manage ON public.student_parents
  FOR ALL TO authenticated
  USING (
    public.has_institution_role(
      student_parents.institution_id,
      ARRAY['admin', 'staff']::user_role[]
    )
  )
  WITH CHECK (
    public.has_institution_role(
      student_parents.institution_id,
      ARRAY['admin', 'staff']::user_role[]
    )
  );
CREATE POLICY faculty_select ON public.faculty
  FOR SELECT TO authenticated USING (public.is_institution_member(institution_id));
CREATE POLICY class_faculty_select ON public.class_faculty
  FOR SELECT TO authenticated USING (public.is_institution_member(institution_id));
CREATE POLICY attendance_sessions_select ON public.attendance_sessions
  FOR SELECT TO authenticated USING (public.can_view_attendance_session(id));
CREATE POLICY attendance_sessions_manage ON public.attendance_sessions
  FOR ALL TO authenticated
  USING (public.can_manage_class(class_id))
  WITH CHECK (public.can_manage_class(class_id));
CREATE POLICY attendance_records_select ON public.attendance_records
  FOR SELECT TO authenticated USING (public.can_view_student(student_id));
CREATE POLICY attendance_records_manage ON public.attendance_records
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.attendance_sessions attendance_session
      WHERE attendance_session.id = attendance_records.session_id
        AND attendance_session.institution_id = attendance_records.institution_id
        AND public.can_manage_class(attendance_session.class_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.attendance_sessions attendance_session
      WHERE attendance_session.id = attendance_records.session_id
        AND attendance_session.institution_id = attendance_records.institution_id
        AND public.can_manage_class(attendance_session.class_id)
    )
  );
CREATE POLICY qr_sessions_select ON public.qr_sessions
  FOR SELECT TO authenticated
  USING (
    public.can_manage_class(class_id)
    OR (
      public.is_institution_member(qr_sessions.institution_id)
      AND EXISTS (
        SELECT 1
        FROM public.profiles profile
        JOIN public.students student ON student.id = profile.student_id
        WHERE profile.id = public.current_profile_id()
          AND student.institution_id = qr_sessions.institution_id
          AND student.class_id = qr_sessions.class_id
      )
    )
  );
CREATE POLICY qr_sessions_manage ON public.qr_sessions
  FOR ALL TO authenticated
  USING (public.can_manage_class(class_id))
  WITH CHECK (public.can_manage_class(class_id));
CREATE POLICY qr_check_ins_select ON public.qr_check_ins
  FOR SELECT TO authenticated USING (public.can_view_student(student_id));
CREATE POLICY qr_check_ins_student_create ON public.qr_check_ins
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_institution_member(qr_check_ins.institution_id)
    AND EXISTS (
      SELECT 1
      FROM public.profiles profile
      JOIN public.students student ON student.id = profile.student_id
      JOIN public.qr_sessions session
        ON session.id = qr_check_ins.session_id
       AND session.class_id = student.class_id
       AND session.institution_id = student.institution_id
      WHERE profile.id = public.current_profile_id()
        AND student.id = qr_check_ins.student_id
        AND session.active
        AND session.expires_at > timezone('utc', now())
    )
  );
CREATE POLICY qr_check_ins_staff_manage ON public.qr_check_ins
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.qr_sessions session
      WHERE session.id = qr_check_ins.session_id
        AND session.institution_id = qr_check_ins.institution_id
        AND public.can_manage_class(session.class_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.qr_sessions session
      WHERE session.id = qr_check_ins.session_id
        AND session.institution_id = qr_check_ins.institution_id
        AND public.can_manage_class(session.class_id)
    )
  );
CREATE POLICY communications_select ON public.communications
  FOR SELECT TO authenticated USING (public.can_view_student(student_id));
CREATE POLICY communications_manage ON public.communications
  FOR ALL TO authenticated
  USING (public.can_manage_student(student_id))
  WITH CHECK (public.can_manage_student(student_id));
CREATE POLICY interventions_select ON public.interventions
  FOR SELECT TO authenticated USING (public.can_view_student(student_id));
CREATE POLICY interventions_manage ON public.interventions
  FOR ALL TO authenticated
  USING (public.can_manage_student(student_id))
  WITH CHECK (public.can_manage_student(student_id));
CREATE POLICY escalations_select ON public.escalations
  FOR SELECT TO authenticated USING (public.can_view_student(student_id));
CREATE POLICY escalations_manage ON public.escalations
  FOR ALL TO authenticated
  USING (public.can_manage_student(student_id))
  WITH CHECK (public.can_manage_student(student_id));
CREATE POLICY audit_logs_admin_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.has_institution_role(institution_id, ARRAY['admin']::user_role[]));

REVOKE ALL ON FUNCTION public.inherit_institution_from_reference() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_profile_student_membership() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_audit_entity_tenant() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_profile_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_institution_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_institution_role(UUID, user_role[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shares_institution(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_profile(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_class(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_student(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_student(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_attendance_session(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_staff_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_operational_access() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_profile_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_institution_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_institution_role(UUID, user_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_profile(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_class(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_student(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_student(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_attendance_session(UUID) TO authenticated;

COMMIT;
