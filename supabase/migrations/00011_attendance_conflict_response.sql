-- Optimistic conflicts are permanent until reload. PT409 returns HTTP 409
-- without triggering PostgREST serialization-failure transaction retries.
CREATE OR REPLACE FUNCTION public.update_attendance(
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
      USING ERRCODE = 'PT409';
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
