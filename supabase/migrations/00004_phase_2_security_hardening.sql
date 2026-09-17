-- Phase 2 hardening discovered during the pre-deployment database audit.

BEGIN;

-- The academic year is part of class identity. The original two-column unique
-- constraint would incorrectly prevent reusing a class/section in a later year.
ALTER TABLE public.classes DROP CONSTRAINT IF EXISTS classes_name_section_key;

DROP INDEX IF EXISTS public.idx_profiles_email;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_case_insensitive
  ON public.profiles(lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_student
  ON public.profiles(student_id)
  WHERE student_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_parents_user
  ON public.parents(user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_communications_provider_message
  ON public.communications(provider_name, provider_message_id)
  WHERE provider_name IS NOT NULL AND provider_message_id IS NOT NULL;

ALTER TABLE public.qr_check_ins
  ADD CONSTRAINT qr_check_ins_status_check
    CHECK (status IN ('valid', 'invalid_proximity', 'duplicate')),
  ADD CONSTRAINT qr_check_ins_session_student_unique
    UNIQUE (session_id, student_id);

-- statement_timestamp() changes between statements in one transaction, unlike
-- now(), so updated_at remains testable and accurate during transactional work.
CREATE OR REPLACE FUNCTION public.trigger_set_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = statement_timestamp();
  RETURN NEW;
END;
$$;

-- Authorization is derived from protected role assignments, not the editable
-- legacy display column on profiles.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.profile_roles pr ON pr.profile_id = p.id
    WHERE p.auth_user_id = auth.uid()
      AND pr.role_code = 'admin'
      AND p.status = 'active'
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
    SELECT 1
    FROM public.profiles p
    JOIN public.profile_roles pr ON pr.profile_id = p.id
    WHERE p.auth_user_id = auth.uid()
      AND pr.role_code IN ('admin', 'faculty', 'staff')
      AND p.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_operational_access()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.profile_roles pr ON pr.profile_id = p.id
    WHERE p.auth_user_id = auth.uid()
      AND pr.role_code IN ('admin', 'staff')
      AND p.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_class(target_class_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.profile_roles pr ON pr.profile_id = p.id
      WHERE p.auth_user_id = auth.uid()
        AND pr.role_code = 'staff'
        AND p.status = 'active'
    )
    OR EXISTS (
    SELECT 1
    FROM public.faculty f
    JOIN public.class_faculty cf ON cf.faculty_id = f.id
    JOIN public.profiles p ON p.id = f.user_id
    JOIN public.profile_roles pr ON pr.profile_id = p.id AND pr.role_code = 'faculty'
    WHERE cf.class_id = target_class_id
      AND p.auth_user_id = auth.uid()
      AND p.status = 'active'
      AND f.active
    );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_student(target_student_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.profile_roles pr ON pr.profile_id = p.id
      WHERE p.auth_user_id = auth.uid()
        AND pr.role_code = 'staff'
        AND p.status = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM public.students s
      WHERE s.id = target_student_id
        AND public.can_manage_class(s.class_id)
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_student(target_student_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_manage_student(target_student_id)
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.student_id = target_student_id
        AND p.status = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM public.student_parents sp
      JOIN public.parents parent_record ON parent_record.id = sp.parent_id
      JOIN public.profiles p ON p.id = parent_record.user_id
      WHERE sp.student_id = target_student_id
        AND p.auth_user_id = auth.uid()
        AND p.status = 'active'
    );
$$;

-- New users are always provisioned with the least-privileged student role.
-- Privileged role assignment must be performed later by an authorized admin;
-- untrusted user metadata is never treated as authorization input.
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

  INSERT INTO public.profile_roles (profile_id, role_code)
  VALUES (NEW.id, 'student');

  RETURN NEW;
END;
$$;

-- Authenticated audit inserts cannot spoof actor identity. Service-role and
-- migration inserts retain an explicitly supplied actor for operational use.
CREATE OR REPLACE FUNCTION public.set_audit_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.actor_id = public.current_profile_id();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_audit_actor_before_insert
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE PROCEDURE public.set_audit_actor();

-- Attendance rows must belong to a student in the session's class.
CREATE OR REPLACE FUNCTION public.validate_attendance_record_class()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.attendance_sessions attendance_session
    JOIN public.students student ON student.id = NEW.student_id
    WHERE attendance_session.id = NEW.session_id
      AND attendance_session.class_id = student.class_id
  ) THEN
    RAISE EXCEPTION 'attendance student and session class do not match'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_attendance_record_class_before_write
  BEFORE INSERT OR UPDATE OF session_id, student_id ON public.attendance_records
  FOR EACH ROW EXECUTE PROCEDURE public.validate_attendance_record_class();

CREATE OR REPLACE FUNCTION public.validate_communication_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.student_parents sp
    WHERE sp.student_id = NEW.student_id
      AND sp.parent_id = NEW.parent_id
      AND sp.receives_notifications
  ) THEN
    RAISE EXCEPTION 'communication parent is not an enabled guardian for the student'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_communication_parent_before_write
  BEFORE INSERT OR UPDATE OF student_id, parent_id ON public.communications
  FOR EACH ROW EXECUTE PROCEDURE public.validate_communication_parent();

CREATE OR REPLACE FUNCTION public.validate_intervention_communication()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.communication_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.communications communication
    WHERE communication.id = NEW.communication_id
      AND communication.student_id = NEW.student_id
  ) THEN
    RAISE EXCEPTION 'intervention communication belongs to another student'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_intervention_communication_before_write
  BEFORE INSERT OR UPDATE OF student_id, communication_id ON public.interventions
  FOR EACH ROW EXECUTE PROCEDURE public.validate_intervention_communication();

CREATE OR REPLACE FUNCTION public.validate_escalation_class()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.students student
    WHERE student.id = NEW.student_id AND student.class_id = NEW.class_id
  ) THEN
    RAISE EXCEPTION 'escalation student and class do not match'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.intervention_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.interventions intervention
    WHERE intervention.id = NEW.intervention_id
      AND intervention.student_id = NEW.student_id
  ) THEN
    RAISE EXCEPTION 'escalation intervention belongs to another student'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_escalation_class_before_write
  BEFORE INSERT OR UPDATE OF student_id, class_id, intervention_id ON public.escalations
  FOR EACH ROW EXECUTE PROCEDURE public.validate_escalation_class();

DROP POLICY IF EXISTS parents_select ON public.parents;
CREATE POLICY parents_select ON public.parents
  FOR SELECT TO authenticated
  USING (
    user_id = public.current_profile_id()
    OR EXISTS (
      SELECT 1 FROM public.student_parents sp
      WHERE sp.parent_id = id AND public.can_manage_student(sp.student_id)
    )
  );

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR public.has_operational_access()
    OR EXISTS (SELECT 1 FROM public.faculty f WHERE f.user_id = id AND f.active)
    OR (student_id IS NOT NULL AND public.can_manage_student(student_id))
  );

DROP POLICY IF EXISTS parents_staff_write ON public.parents;
CREATE POLICY parents_staff_write ON public.parents
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.student_parents sp
      WHERE sp.parent_id = id AND public.can_manage_student(sp.student_id)
    )
  )
  WITH CHECK (public.is_admin() OR public.has_staff_access());

DROP POLICY IF EXISTS students_staff_write ON public.students;
CREATE POLICY students_staff_write ON public.students
  FOR ALL TO authenticated
  USING (public.can_manage_student(id))
  WITH CHECK (public.can_manage_class(class_id));

DROP POLICY IF EXISTS student_parents_staff_write ON public.student_parents;
CREATE POLICY student_parents_staff_write ON public.student_parents
  FOR ALL TO authenticated
  USING (public.can_manage_student(student_id))
  WITH CHECK (public.can_manage_student(student_id));

DROP POLICY IF EXISTS communications_staff_write ON public.communications;
CREATE POLICY communications_staff_write ON public.communications
  FOR ALL TO authenticated
  USING (public.can_manage_student(student_id))
  WITH CHECK (public.can_manage_student(student_id));

DROP POLICY IF EXISTS interventions_staff_write ON public.interventions;
CREATE POLICY interventions_staff_write ON public.interventions
  FOR ALL TO authenticated
  USING (public.can_manage_student(student_id))
  WITH CHECK (public.can_manage_student(student_id));

DROP POLICY IF EXISTS escalations_staff_write ON public.escalations;
CREATE POLICY escalations_staff_write ON public.escalations
  FOR ALL TO authenticated
  USING (public.can_manage_student(student_id))
  WITH CHECK (public.can_manage_student(student_id));

DROP POLICY IF EXISTS qr_check_ins_student_create ON public.qr_check_ins;
CREATE POLICY qr_check_ins_student_create ON public.qr_check_ins
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.students s ON s.id = p.student_id
      JOIN public.qr_sessions qs ON qs.id = session_id AND qs.class_id = s.class_id
      WHERE p.auth_user_id = auth.uid()
        AND s.id = student_id
        AND p.status = 'active'
        AND qs.active
        AND qs.expires_at > timezone('utc', now())
    )
  );

DROP POLICY IF EXISTS qr_sessions_staff_access ON public.qr_sessions;
CREATE POLICY qr_sessions_staff_access ON public.qr_sessions
  FOR ALL TO authenticated
  USING (public.can_manage_class(class_id))
  WITH CHECK (public.can_manage_class(class_id));

CREATE POLICY qr_check_ins_staff_manage ON public.qr_check_ins
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.qr_sessions qs
      WHERE qs.id = session_id AND public.can_manage_class(qs.class_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.qr_sessions qs
      WHERE qs.id = session_id AND public.can_manage_class(qs.class_id)
    )
  );

REVOKE ALL ON FUNCTION public.current_profile_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_staff_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_operational_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_class(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_student(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_student(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_attendance_session(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_audit_actor() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_attendance_record_class() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_communication_parent() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_intervention_communication() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_escalation_class() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_profile_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_staff_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_operational_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_class(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_student(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_student(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_attendance_session(UUID) TO authenticated;

COMMIT;
