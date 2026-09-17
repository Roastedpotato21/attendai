-- AttendAI Phase 3A: Atomic Attendance Submission RPC
-- Migration 00006: submit_attendance
--
-- Requirements:
-- - SECURITY INVOKER: executes with the caller's privileges and preserves RLS
-- - No service_role dependency
-- - Authenticated caller identity derived from auth.uid()
-- - Institution ownership derived from classes table (not client-spoofed)
-- - Validates caller has permission to manage the class (via can_manage_class)
-- - Validates student-class relationships
-- - Enforces unique session per (class, date)
-- - Atomic transaction (all writes roll back together on error)
-- - Explicit, bounded parameters with safe search_path

CREATE OR REPLACE FUNCTION public.submit_attendance(
  p_class_id UUID,
  p_date DATE,
  p_method TEXT,
  p_records JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_institution_id UUID;
  v_session_id UUID;
  v_records JSONB;
  v_record RECORD;
  v_student_id UUID;
  v_status student_status;
  v_present INTEGER := 0;
  v_absent INTEGER := 0;
  v_late INTEGER := 0;
  v_records_count INTEGER := 0;
BEGIN
  -- 1. Verify caller authentication
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated: caller has no active session'
      USING ERRCODE = '28000';
  END IF;

  -- 2. Validate input method
  IF p_method NOT IN ('manual', 'qr', 'face') THEN
    RAISE EXCEPTION 'invalid attendance method: %, must be manual, qr, or face', p_method
      USING ERRCODE = '22023';
  END IF;

  -- 3. Resolve target class and institution ownership
  SELECT institution_id INTO v_institution_id
  FROM public.classes
  WHERE id = p_class_id;

  IF v_institution_id IS NULL THEN
    RAISE EXCEPTION 'class not found: %', p_class_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 4. Verify caller authorization to manage this class
  IF NOT public.can_manage_class(p_class_id) THEN
    RAISE EXCEPTION 'permission denied: caller cannot manage class %', p_class_id
      USING ERRCODE = '42501';
  END IF;

  -- 5. Check for duplicate session for this class and date
  IF EXISTS (
    SELECT 1
    FROM public.attendance_sessions
    WHERE class_id = p_class_id
      AND date = p_date
  ) THEN
    RAISE EXCEPTION 'conflict: attendance session already exists for class % on date %', p_class_id, p_date
      USING ERRCODE = '23505';
  END IF;

  -- 6. Normalize and validate records payload
  IF jsonb_typeof(p_records) = 'string' THEN
    v_records := (p_records #>> '{}')::jsonb;
  ELSE
    v_records := p_records;
  END IF;

  IF jsonb_typeof(v_records) != 'array' THEN
    RAISE EXCEPTION 'invalid records payload: expected json array'
      USING ERRCODE = '22023';
  END IF;

  v_records_count := jsonb_array_length(v_records);
  IF v_records_count = 0 THEN
    RAISE EXCEPTION 'validation failed: records array cannot be empty'
      USING ERRCODE = '22023';
  END IF;

  -- 7. Validate each record and compute summary counts
  FOR v_record IN SELECT * FROM jsonb_to_recordset(v_records) AS r(student_id UUID, status TEXT) LOOP
    v_student_id := v_record.student_id;
    
    IF v_student_id IS NULL THEN
      RAISE EXCEPTION 'validation failed: record missing student_id'
        USING ERRCODE = '22023';
    END IF;

    -- Validate status enum
    IF v_record.status NOT IN ('present', 'absent', 'late', 'excused') THEN
      RAISE EXCEPTION 'validation failed: invalid student status: %', v_record.status
        USING ERRCODE = '22023';
    END IF;

    -- Verify student belongs to this class and institution
    IF NOT EXISTS (
      SELECT 1
      FROM public.students
      WHERE id = v_student_id
        AND class_id = p_class_id
        AND institution_id = v_institution_id
    ) THEN
      RAISE EXCEPTION 'validation failed: student % does not belong to class % in institution %',
        v_student_id, p_class_id, v_institution_id
        USING ERRCODE = '23514';
    END IF;

    -- Accumulate counts
    IF v_record.status = 'present' THEN
      v_present := v_present + 1;
    ELSIF v_record.status = 'absent' THEN
      v_absent := v_absent + 1;
    ELSIF v_record.status = 'late' THEN
      v_late := v_late + 1;
    END IF;
  END LOOP;

  -- 8. Insert attendance_session
  INSERT INTO public.attendance_sessions (
    institution_id,
    class_id,
    date,
    method,
    submitted_by,
    total_present,
    total_absent,
    total_late,
    status
  ) VALUES (
    v_institution_id,
    p_class_id,
    p_date,
    p_method,
    v_caller_id,
    v_present,
    v_absent,
    v_late,
    'submitted'
  )
  RETURNING id INTO v_session_id;

  -- 9. Insert all attendance_records
  INSERT INTO public.attendance_records (
    institution_id,
    session_id,
    student_id,
    status
  )
  SELECT
    v_institution_id,
    v_session_id,
    r.student_id,
    r.status::student_status
  FROM jsonb_to_recordset(v_records) AS r(student_id UUID, status TEXT);

  -- 10. Return result summary
  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'class_id', p_class_id,
    'date', p_date,
    'method', p_method,
    'total_present', v_present,
    'total_absent', v_absent,
    'total_late', v_late,
    'records_count', v_records_count
  );
END;
$$;

-- Revoke execute from public, grant strictly to authenticated
REVOKE ALL ON FUNCTION public.submit_attendance(UUID, DATE, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_attendance(UUID, DATE, TEXT, JSONB) TO authenticated;
