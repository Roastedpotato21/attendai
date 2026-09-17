-- Development-only verification for the deterministic multi-tenant fixture.

DO $$
DECLARE
  northstar UUID := '11111111-1111-4111-8111-111111111111';
  riverside UUID := '22222222-2222-4222-8222-222222222222';
BEGIN
  IF (SELECT count(*) FROM public.institutions WHERE id IN (northstar, riverside)) <> 2 THEN
    RAISE EXCEPTION 'expected both seeded institutions';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.classes
    WHERE institution_id = northstar AND name = 'B.Tech CSE' AND section = 'A'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.classes
    WHERE institution_id = riverside AND name = 'B.Tech CSE' AND section = 'A'
  ) THEN
    RAISE EXCEPTION 'overlapping tenant-scoped class fixtures are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.students
    WHERE institution_id = northstar AND admission_number = 'ATD-2026-001'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.students
    WHERE institution_id = riverside AND admission_number = 'ATD-2026-001'
  ) THEN
    RAISE EXCEPTION 'overlapping tenant-scoped student fixtures are incomplete';
  END IF;

  IF (SELECT count(*) FROM public.profile_institutions WHERE institution_id IN (northstar, riverside)) < 7 THEN
    RAISE EXCEPTION 'seeded institution memberships are incomplete';
  END IF;
  IF (SELECT count(*) FROM public.profile_roles WHERE institution_id IN (northstar, riverside)) < 7 THEN
    RAISE EXCEPTION 'seeded institution role assignments are incomplete';
  END IF;

  IF (SELECT count(DISTINCT institution_id) FROM public.faculty WHERE employee_code = 'EMP-CSE-001') <> 2 THEN
    RAISE EXCEPTION 'tenant-scoped faculty fixtures are incomplete';
  END IF;

  IF (SELECT count(DISTINCT institution_id) FROM public.attendance_records
      WHERE id IN ('70000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001')) <> 2 THEN
    RAISE EXCEPTION 'seeded attendance records are incomplete';
  END IF;
  IF (SELECT count(DISTINCT institution_id) FROM public.qr_sessions
      WHERE id IN ('72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001')) <> 2 THEN
    RAISE EXCEPTION 'seeded QR sessions are incomplete';
  END IF;
  IF (SELECT count(DISTINCT institution_id) FROM public.qr_check_ins
      WHERE id IN ('74000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000001')) <> 2 THEN
    RAISE EXCEPTION 'seeded QR check-ins are incomplete';
  END IF;
  IF (SELECT count(DISTINCT institution_id) FROM public.communications WHERE provider_name = 'seed-data') <> 2 THEN
    RAISE EXCEPTION 'seeded communications are incomplete';
  END IF;
  IF (SELECT count(DISTINCT institution_id) FROM public.interventions
      WHERE id IN ('90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001')) <> 2 THEN
    RAISE EXCEPTION 'seeded interventions are incomplete';
  END IF;
  IF (SELECT count(DISTINCT institution_id) FROM public.escalations
      WHERE id IN ('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001')) <> 2 THEN
    RAISE EXCEPTION 'seeded escalations are incomplete';
  END IF;
  IF (SELECT count(DISTINCT institution_id) FROM public.audit_logs
      WHERE id IN ('b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001')) <> 2 THEN
    RAISE EXCEPTION 'seeded audit records are incomplete';
  END IF;
END;
$$;
