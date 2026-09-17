-- Phase 2: production database foundation.
-- This migration intentionally extends the original schema instead of rewriting
-- already-applied migrations, so existing environments can upgrade safely.

BEGIN;

-- ---------------------------------------------------------------------------
-- Public profiles and role assignments
-- ---------------------------------------------------------------------------

-- Supabase owns auth.users. This project stores its application profile in
-- public.profiles and links it to auth.users when authentication is enabled.
ALTER TABLE public.users RENAME TO profiles;
ALTER INDEX IF EXISTS public.idx_users_email RENAME TO idx_profiles_email;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_status_check
  CHECK (status IN ('active', 'inactive', 'suspended'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_auth_user
  ON public.profiles(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.roles (
  code user_role PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

INSERT INTO public.roles (code, name, description) VALUES
  ('admin', 'Administrator', 'Institution-wide administration and configuration.'),
  ('faculty', 'Faculty', 'Teaching, attendance, and class intervention access.'),
  ('staff', 'Staff', 'Operational attendance and communication access.'),
  ('student', 'Student', 'Personal attendance and authorised check-in access.')
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      updated_at = timezone('utc', now());

CREATE TABLE IF NOT EXISTS public.profile_roles (
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_code user_role NOT NULL REFERENCES public.roles(code) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (profile_id, role_code)
);

INSERT INTO public.profile_roles (profile_id, role_code)
SELECT id, role FROM public.profiles
ON CONFLICT (profile_id, role_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Academic entities and relationship integrity
-- ---------------------------------------------------------------------------

ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS academic_year TEXT NOT NULL DEFAULT '2026-2027',
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_year_name_section
  ON public.classes(academic_year, name, section);

ALTER TABLE public.parents
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_parents_email
  ON public.parents(lower(email))
  WHERE email IS NOT NULL;

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS admission_number TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE public.students
  ADD CONSTRAINT students_attendance_rate_range
  CHECK (attendance_rate >= 0 AND attendance_rate <= 100),
  ADD CONSTRAINT students_consecutive_absences_non_negative
  CHECK (consecutive_absences >= 0),
  ADD CONSTRAINT students_enrollment_status_check
  CHECK (enrollment_status IN ('active', 'inactive', 'graduated', 'withdrawn'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_students_admission_number
  ON public.students(admission_number)
  WHERE admission_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_students_class_status
  ON public.students(class_id, enrollment_status);

CREATE TABLE IF NOT EXISTS public.student_parents (
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  parent_id UUID NOT NULL REFERENCES public.parents(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'guardian',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  receives_notifications BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (student_id, parent_id),
  CONSTRAINT student_parents_relationship_check
    CHECK (relationship IN ('mother', 'father', 'guardian', 'other'))
);

INSERT INTO public.student_parents (student_id, parent_id, relationship, is_primary)
SELECT id, parent_id, 'guardian', true FROM public.students
ON CONFLICT (student_id, parent_id) DO UPDATE
  SET is_primary = true,
      updated_at = timezone('utc', now());

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_parents_one_primary
  ON public.student_parents(student_id)
  WHERE is_primary;

CREATE INDEX IF NOT EXISTS idx_student_parents_parent
  ON public.student_parents(parent_id);

ALTER TABLE public.faculty
  ADD COLUMN IF NOT EXISTS employee_code TEXT,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_faculty_employee_code
  ON public.faculty(employee_code)
  WHERE employee_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_faculty_user
  ON public.faculty(user_id);

CREATE INDEX IF NOT EXISTS idx_class_faculty_class
  ON public.class_faculty(class_id);

-- ---------------------------------------------------------------------------
-- Attendance, communication, intervention, escalation, and audit records
-- ---------------------------------------------------------------------------

ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'submitted';

ALTER TABLE public.attendance_sessions
  ADD CONSTRAINT attendance_sessions_method_check
  CHECK (method IN ('faculty', 'qr', 'ai')),
  ADD CONSTRAINT attendance_sessions_status_check
  CHECK (status IN ('draft', 'submitted', 'locked')),
  ADD CONSTRAINT attendance_sessions_counts_non_negative
  CHECK (total_present >= 0 AND total_absent >= 0 AND total_late >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_sessions_class_date
  ON public.attendance_sessions(class_id, date);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_submitted_by
  ON public.attendance_sessions(submitted_by);

CREATE INDEX IF NOT EXISTS idx_attendance_records_student
  ON public.attendance_records(student_id);

ALTER TABLE public.qr_sessions
  ADD COLUMN IF NOT EXISTS faculty_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_qr_sessions_class_active
  ON public.qr_sessions(class_id, active)
  WHERE active;

ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'outbound',
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.communications
  ADD CONSTRAINT communications_direction_check
  CHECK (direction IN ('outbound', 'inbound')),
  ADD CONSTRAINT communications_attempts_non_negative
  CHECK (attempts IS NULL OR attempts >= 0),
  ADD CONSTRAINT communications_message_status_check
  CHECK (message_status IS NULL OR message_status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
  ADD CONSTRAINT communications_sms_status_check
  CHECK (sms_status IS NULL OR sms_status IN ('queued', 'sent', 'delivered', 'failed')),
  ADD CONSTRAINT communications_call_status_check
  CHECK (call_status IS NULL OR call_status IN ('scheduled', 'in-progress', 'completed', 'no-answer', 'failed'));

CREATE INDEX IF NOT EXISTS idx_communications_student_created
  ON public.communications(student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_communications_parent_created
  ON public.communications(parent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_communications_scheduled
  ON public.communications(scheduled_for)
  WHERE scheduled_for IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.interventions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  risk_level risk_level NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'medium',
  action_taken TEXT,
  action_date TIMESTAMPTZ,
  owner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  communication_id UUID REFERENCES public.communications(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT interventions_status_check
    CHECK (status IN ('pending', 'in-progress', 'resolved')),
  CONSTRAINT interventions_priority_check
    CHECK (priority IN ('low', 'medium', 'high', 'critical'))
);

CREATE INDEX IF NOT EXISTS idx_interventions_student_status
  ON public.interventions(student_id, status);

CREATE INDEX IF NOT EXISTS idx_interventions_owner_status
  ON public.interventions(owner_id, status)
  WHERE owner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.escalations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  intervention_id UUID REFERENCES public.interventions(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'L1 Faculty',
  owner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open',
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT escalations_level_check
    CHECK (level IN ('L1 Faculty', 'L2 Counselor', 'L3 Head of Dept', 'L4 Principal')),
  CONSTRAINT escalations_status_check
    CHECK (status IN ('open', 'acknowledged', 'resolved'))
);

CREATE INDEX IF NOT EXISTS idx_escalations_student_status
  ON public.escalations(student_id, status);

CREATE INDEX IF NOT EXISTS idx_escalations_owner_status
  ON public.escalations(owner_id, status)
  WHERE owner_id IS NOT NULL;

ALTER TABLE public.audit_logs
  ALTER COLUMN actor_id DROP NOT NULL;

ALTER TABLE public.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_actor_id_fkey,
  ADD CONSTRAINT audit_logs_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id UUID,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created
  ON public.audit_logs(actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON public.audit_logs(entity_type, entity_id)
  WHERE entity_type IS NOT NULL AND entity_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Timestamp trigger coverage
-- ---------------------------------------------------------------------------

CREATE TRIGGER set_timestamp_roles
  BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE PROCEDURE public.trigger_set_timestamp();

CREATE TRIGGER set_timestamp_student_parents
  BEFORE UPDATE ON public.student_parents
  FOR EACH ROW EXECUTE PROCEDURE public.trigger_set_timestamp();

CREATE TRIGGER set_timestamp_interventions
  BEFORE UPDATE ON public.interventions
  FOR EACH ROW EXECUTE PROCEDURE public.trigger_set_timestamp();

CREATE TRIGGER set_timestamp_escalations
  BEFORE UPDATE ON public.escalations
  FOR EACH ROW EXECUTE PROCEDURE public.trigger_set_timestamp();

-- ---------------------------------------------------------------------------
-- Auth/profile helpers and security policies
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid() AND role = 'admin' AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_staff_access()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid()
      AND role IN ('admin', 'faculty', 'staff')
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_class(target_class_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1
    FROM public.faculty f
    JOIN public.class_faculty cf ON cf.faculty_id = f.id
    JOIN public.profiles p ON p.id = f.user_id
    WHERE cf.class_id = target_class_id
      AND p.auth_user_id = auth.uid()
      AND p.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_student(target_student_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_staff_access()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE auth_user_id = auth.uid() AND student_id = target_student_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.student_parents sp
      JOIN public.parents p ON p.id = sp.parent_id
      WHERE sp.student_id = target_student_id
        AND p.user_id = public.current_profile_id()
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_attendance_session(target_session_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_staff_access() OR EXISTS (
    SELECT 1 FROM public.attendance_records ar
    WHERE ar.session_id = target_session_id
      AND public.can_view_student(ar.student_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_id UUID;
BEGIN
  INSERT INTO public.profiles (id, auth_user_id, name, email, role, status)
  VALUES (
    NEW.id,
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(COALESCE(NEW.email, ''), '@', 1), 'AttendAI user'),
    NEW.email,
    CASE
      WHEN NEW.raw_user_meta_data ->> 'role' IN ('admin', 'faculty', 'staff', 'student')
        THEN (NEW.raw_user_meta_data ->> 'role')::user_role
      ELSE 'student'::user_role
    END,
    'active'
  )
  ON CONFLICT (email) DO UPDATE
    SET auth_user_id = EXCLUDED.auth_user_id,
        last_sign_in_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
  RETURNING id INTO profile_id;

  INSERT INTO public.profile_roles (profile_id, role_code)
  SELECT id, role FROM public.profiles WHERE id = profile_id
  ON CONFLICT (profile_id, role_code) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_auth_user();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_faculty ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interventions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR public.has_staff_access());

CREATE POLICY profiles_admin_write ON public.profiles
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY roles_select ON public.roles
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY roles_admin_write ON public.roles
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY profile_roles_select ON public.profile_roles
  FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id() OR public.is_admin());

CREATE POLICY profile_roles_admin_write ON public.profile_roles
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY classes_select ON public.classes
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY classes_admin_write ON public.classes
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY parents_select ON public.parents
  FOR SELECT TO authenticated
  USING (user_id = public.current_profile_id() OR public.has_staff_access());

CREATE POLICY parents_staff_write ON public.parents
  FOR ALL TO authenticated
  USING (public.has_staff_access())
  WITH CHECK (public.has_staff_access());

CREATE POLICY students_select ON public.students
  FOR SELECT TO authenticated
  USING (public.can_view_student(id));

CREATE POLICY students_staff_write ON public.students
  FOR ALL TO authenticated
  USING (public.has_staff_access())
  WITH CHECK (public.has_staff_access());

CREATE POLICY student_parents_select ON public.student_parents
  FOR SELECT TO authenticated
  USING (public.can_view_student(student_id));

CREATE POLICY student_parents_staff_write ON public.student_parents
  FOR ALL TO authenticated
  USING (public.has_staff_access())
  WITH CHECK (public.has_staff_access());

CREATE POLICY faculty_select ON public.faculty
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY faculty_admin_write ON public.faculty
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY class_faculty_select ON public.class_faculty
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY class_faculty_admin_write ON public.class_faculty
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY attendance_sessions_select ON public.attendance_sessions
  FOR SELECT TO authenticated
  USING (public.can_view_attendance_session(id));

CREATE POLICY attendance_sessions_manage ON public.attendance_sessions
  FOR ALL TO authenticated
  USING (public.can_manage_class(class_id))
  WITH CHECK (public.can_manage_class(class_id));

CREATE POLICY attendance_records_select ON public.attendance_records
  FOR SELECT TO authenticated
  USING (public.can_view_student(student_id));

CREATE POLICY attendance_records_manage ON public.attendance_records
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.attendance_sessions attendance_session
      WHERE attendance_session.id = session_id
        AND public.can_manage_class(attendance_session.class_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.attendance_sessions attendance_session
      WHERE attendance_session.id = session_id
        AND public.can_manage_class(attendance_session.class_id)
    )
  );

CREATE POLICY qr_sessions_staff_access ON public.qr_sessions
  FOR ALL TO authenticated
  USING (public.has_staff_access())
  WITH CHECK (public.has_staff_access());

CREATE POLICY qr_check_ins_select ON public.qr_check_ins
  FOR SELECT TO authenticated
  USING (public.can_view_student(student_id));

CREATE POLICY qr_check_ins_student_create ON public.qr_check_ins
  FOR INSERT TO authenticated
  WITH CHECK (public.can_view_student(student_id));

CREATE POLICY communications_select ON public.communications
  FOR SELECT TO authenticated
  USING (public.can_view_student(student_id));

CREATE POLICY communications_staff_write ON public.communications
  FOR ALL TO authenticated
  USING (public.has_staff_access())
  WITH CHECK (public.has_staff_access());

CREATE POLICY interventions_select ON public.interventions
  FOR SELECT TO authenticated
  USING (public.can_view_student(student_id));

CREATE POLICY interventions_staff_write ON public.interventions
  FOR ALL TO authenticated
  USING (public.has_staff_access())
  WITH CHECK (public.has_staff_access());

CREATE POLICY escalations_select ON public.escalations
  FOR SELECT TO authenticated
  USING (public.can_view_student(student_id));

CREATE POLICY escalations_staff_write ON public.escalations
  FOR ALL TO authenticated
  USING (public.has_staff_access())
  WITH CHECK (public.has_staff_access());

CREATE POLICY audit_logs_admin_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY audit_logs_authenticated_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = public.current_profile_id() OR public.is_admin());

COMMIT;
