-- Preserve create-only submission and unique class/date sessions. Corrections
-- use a separate invoker RPC with an explicit saved revision.
BEGIN;

ALTER TABLE public.attendance_sessions
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  ADD COLUMN modified_by UUID,
  ADD CONSTRAINT attendance_sessions_modifier_membership_fkey
    FOREIGN KEY (modified_by, institution_id)
    REFERENCES public.profile_institutions(profile_id, institution_id);

ALTER TABLE public.communication_jobs DROP CONSTRAINT communication_jobs_status_check;
ALTER TABLE public.communication_jobs ADD CONSTRAINT communication_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter', 'cancelled'));

CREATE FUNCTION public.update_attendance(
  p_session_id UUID,
  p_expected_revision INTEGER,
  p_records JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  saved public.attendance_sessions;
  item RECORD;
  totals RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication is required' USING ERRCODE = '28000';
  END IF;

  -- Locks serialize corrections. RLS still controls visibility and writes.
  SELECT * INTO saved FROM public.attendance_sessions
  WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendance session not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_manage_class(saved.class_id) OR saved.status = 'locked' THEN
    RAISE EXCEPTION 'attendance modification is not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision IS DISTINCT FROM saved.revision THEN
    RAISE EXCEPTION 'attendance was changed by another staff member; reload before saving'
      USING ERRCODE = '40001';
  END IF;
  IF p_records IS NULL OR jsonb_typeof(p_records) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'records must be a nonempty array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_records) = 0 THEN
    RAISE EXCEPTION 'records must be a nonempty array' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT student_id FROM jsonb_to_recordset(p_records) AS r(student_id UUID, status TEXT)
    GROUP BY student_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate student in records' USING ERRCODE = '22023';
  END IF;

  FOR item IN SELECT * FROM jsonb_to_recordset(p_records) AS r(student_id UUID, status TEXT) LOOP
    IF item.student_id IS NULL OR item.status IS NULL
       OR item.status NOT IN ('present', 'absent', 'late', 'excused') THEN
      RAISE EXCEPTION 'invalid attendance record' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.students WHERE id = item.student_id
        AND class_id = saved.class_id AND institution_id = saved.institution_id
    ) THEN
      RAISE EXCEPTION 'student does not belong to the saved class and institution'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  -- Keep existing IDs and history. Only genuinely changed statuses fire the
  -- correction/outbox triggers. New eligible roster members can be appended.
  INSERT INTO public.attendance_records (institution_id, session_id, student_id, status)
  SELECT saved.institution_id, saved.id, r.student_id, r.status::student_status
  FROM jsonb_to_recordset(p_records) AS r(student_id UUID, status TEXT)
  ON CONFLICT (session_id, student_id) DO UPDATE
    SET status = EXCLUDED.status
    WHERE public.attendance_records.status IS DISTINCT FROM EXCLUDED.status;

  SELECT count(*) FILTER (WHERE status = 'present') AS present,
         count(*) FILTER (WHERE status = 'absent') AS absent,
         count(*) FILTER (WHERE status = 'late') AS late,
         count(*) AS total
    INTO totals FROM public.attendance_records
    WHERE session_id = saved.id AND institution_id = saved.institution_id;

  UPDATE public.attendance_sessions
  SET total_present = totals.present, total_absent = totals.absent,
      total_late = totals.late, revision = revision + 1,
      modified_by = public.current_profile_id()
  WHERE id = saved.id RETURNING * INTO saved;

  RETURN jsonb_build_object('session_id', saved.id, 'revision', saved.revision,
    'total_present', saved.total_present, 'total_absent', saved.total_absent,
    'total_late', saved.total_late, 'records_count', totals.total,
    'updated_at', saved.updated_at);
END;
$$;
REVOKE ALL ON FUNCTION public.update_attendance(UUID, INTEGER, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_attendance(UUID, INTEGER, JSONB) TO authenticated;

-- The existing consent, rate-limit, and idempotency checks now also apply when
-- an existing attendance record changes to absent.
DROP TRIGGER enqueue_absence_communication_after_attendance_record ON public.attendance_records;
CREATE TRIGGER enqueue_absence_communication_after_attendance_record
  AFTER INSERT OR UPDATE OF status ON public.attendance_records
  FOR EACH ROW WHEN (NEW.status = 'absent')
  EXECUTE PROCEDURE public.enqueue_absence_communication();

CREATE FUNCTION public.reconcile_corrected_absence()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  target RECORD;
  parent_record RECORD;
  limit_count INTEGER;
  limit_window INTERVAL;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  IF OLD.status = 'absent' AND NEW.status <> 'absent' THEN
    -- Claim and cancellation take row locks on the same job. Never alter a
    -- processing/completed job or a communication already accepted by a provider.
    FOR target IN
      SELECT job.id, communication.id AS communication_id, job.channel
      FROM public.communication_jobs job
      JOIN public.communications communication ON communication.id = job.communication_id
        AND communication.institution_id = job.institution_id
      WHERE job.institution_id = NEW.institution_id AND job.status = 'pending'
        AND communication.student_id = NEW.student_id
        AND communication.metadata ->> 'attendance_session_id' = NEW.session_id::TEXT
        AND communication.metadata ->> 'purpose' = 'absence-alert'
        AND communication.provider_message_id IS NULL
      FOR UPDATE OF job
    LOOP
      UPDATE public.communication_jobs SET status = 'cancelled',
        completed_at = now(), last_error = 'Attendance corrected before delivery'
      WHERE id = target.id AND status = 'pending';
      IF FOUND THEN
        UPDATE public.communications SET
          message_status = CASE WHEN target.channel = 'voice' THEN NULL ELSE 'failed' END,
          sms_status = CASE WHEN target.channel = 'sms' THEN 'failed' ELSE sms_status END,
          call_status = CASE WHEN target.channel = 'voice' THEN 'failed' ELSE call_status END,
          error_details = 'Cancelled: attendance corrected before delivery',
          metadata = metadata || jsonb_build_object('attendance_correction', NEW.status,
            'attendance_cancelled_at', clock_timestamp())
        WHERE id = target.communication_id AND institution_id = NEW.institution_id;
      END IF;
    END LOOP;
  ELSIF NEW.status = 'absent' THEN
    -- If an unsent absence was cancelled and is restored, reuse its original
    -- envelope/job instead of creating duplicate notifications. Only jobs never
    -- attempted are resumed automatically; uncertain prior deliveries remain historical.
    FOR target IN
      SELECT job.id, communication.id AS communication_id, communication.parent_id, job.channel
      FROM public.communication_jobs job
      JOIN public.communications communication ON communication.id = job.communication_id
        AND communication.institution_id = job.institution_id
      WHERE job.institution_id = NEW.institution_id AND job.status = 'cancelled'
        AND job.attempts = 0 AND communication.provider_message_id IS NULL
        AND communication.student_id = NEW.student_id
        AND communication.metadata ->> 'attendance_session_id' = NEW.session_id::TEXT
        AND communication.metadata ->> 'purpose' = 'absence-alert'
      FOR UPDATE OF job
    LOOP
      SELECT * INTO parent_record FROM public.parents
      WHERE id = target.parent_id AND institution_id = NEW.institution_id;
      IF NOT FOUND OR NOT parent_record.active OR NOT parent_record.communication_consent
        OR NOT EXISTS (SELECT 1 FROM public.student_parents
          WHERE student_id = NEW.student_id AND parent_id = target.parent_id
            AND institution_id = NEW.institution_id AND receives_notifications) THEN
        CONTINUE;
      END IF;
      SELECT max_per_parent_per_window, window_length INTO limit_count, limit_window
      FROM public.communication_rate_limits WHERE institution_id = NEW.institution_id;
      IF (SELECT count(*) FROM public.communications WHERE institution_id = NEW.institution_id
          AND parent_id = target.parent_id AND type::TEXT = target.channel
          AND created_at >= now() - COALESCE(limit_window, INTERVAL '1 hour'))
        >= COALESCE(limit_count, 3) THEN CONTINUE; END IF;
      UPDATE public.communication_jobs SET status = 'pending', completed_at = NULL,
        next_run_at = now(), last_error = NULL WHERE id = target.id;
      UPDATE public.communications SET
        message_status = CASE WHEN target.channel = 'voice' THEN NULL ELSE 'queued' END,
        sms_status = CASE WHEN target.channel = 'sms' THEN 'queued' ELSE sms_status END,
        call_status = CASE WHEN target.channel = 'voice' THEN 'scheduled' ELSE call_status END,
        error_details = NULL,
        metadata = metadata || jsonb_build_object('attendance_restored_at', clock_timestamp())
      WHERE id = target.communication_id AND institution_id = NEW.institution_id;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_corrected_absence() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER reconcile_corrected_absence_after_update
  AFTER UPDATE OF status ON public.attendance_records FOR EACH ROW
  EXECUTE PROCEDURE public.reconcile_corrected_absence();

COMMIT;
