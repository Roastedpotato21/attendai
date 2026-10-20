-- Read-only inventory. Run against the production project with an authorized
-- database session. Findings are review candidates, never automatic deletions.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

-- The legacy tenant ID is also used by a migration: its ID alone is NOT proof
-- that a tenant is fake. Compare names, codes, memberships, and real usage.
SELECT id, name, code, status, created_at
FROM public.institutions
WHERE id IN ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
   OR name ~* '(demo|test|northstar|riverside)'
ORDER BY id;

SELECT id, name, status, created_at
FROM public.profiles
WHERE email ~* '(@|\.)attendai\.test$|@example\.(com|org|net)$'
ORDER BY id;

-- Names alone are insufficient evidence to delete a student or guardian.
SELECT id, institution_id, name, enrollment_status, created_at
FROM public.students
WHERE name IN ('Student One', 'Student Two', 'Aarav Reddy', 'Nisha Kumar', 'Diya Shah')
ORDER BY institution_id, id;

SELECT id, institution_id, name, active, communication_consent, created_at
FROM public.parents
WHERE name = 'Attendance Test Guardian' OR email ~* '\.attendai\.test$'
ORDER BY institution_id, id;

-- Cached student aggregates can be stale even when the underlying records are
-- legitimate. Empty attendance history has no measured percentage.
WITH measured AS (
  SELECT r.student_id, r.institution_id,
    round(100.0 * count(*) FILTER (WHERE r.status IN ('present', 'late')) /
      NULLIF(count(*) FILTER (WHERE r.status IN ('present', 'late', 'absent')), 0), 2) AS rate
  FROM public.attendance_records r
  JOIN public.attendance_sessions s ON s.id = r.session_id AND s.institution_id = r.institution_id
  WHERE s.date <= CURRENT_DATE
  GROUP BY r.student_id, r.institution_id
)
SELECT s.id, s.institution_id, s.attendance_rate AS cached_rate, m.rate AS measured_rate
FROM public.students s
LEFT JOIN measured m ON m.student_id = s.id AND m.institution_id = s.institution_id
WHERE s.attendance_rate IS DISTINCT FROM m.rate
ORDER BY s.institution_id, s.id;

SELECT id, institution_id, type, provider_name, message_status, sms_status, created_at
FROM public.communications
WHERE COALESCE(provider_name, '') ~* '(mock|simulat)'
   OR COALESCE(provider_message_id, '') ~* '^(mock|SMsimulated)'
ORDER BY created_at, id;

SELECT institution_id, COALESCE(metadata->>'purpose', 'unspecified') AS purpose,
       count(*) AS communication_count
FROM public.communications
WHERE COALESCE(metadata->>'purpose', '') ~* '(test|trial)'
GROUP BY institution_id, metadata->>'purpose'
ORDER BY institution_id, purpose;

-- Old attendance is legitimate history. Only flag pending notifications that
-- reference old/corrected attendance; do not erase attendance to clear a queue.
-- Six hours is the repository default TTL; compare deployment overrides.
SELECT j.id AS job_id, j.institution_id, j.channel, j.status, j.attempts,
       s.date AS attendance_date, s.created_at AS session_created_at,
       r.status AS current_attendance_status, j.created_at AS job_created_at
FROM public.communication_jobs j
JOIN public.communications c ON c.id = j.communication_id AND c.institution_id = j.institution_id
LEFT JOIN public.attendance_sessions s ON s.id::text = c.metadata->>'attendance_session_id'
  AND s.institution_id = j.institution_id
LEFT JOIN public.attendance_records r ON r.session_id = s.id AND r.student_id = c.student_id
  AND r.institution_id = j.institution_id
WHERE j.status IN ('pending', 'processing')
  AND c.metadata->>'purpose' = 'absence-alert'
  AND (s.id IS NULL OR s.created_at < now() - interval '6 hours'
       OR s.status <> 'submitted' OR r.status IS DISTINCT FROM 'absent')
ORDER BY j.created_at, j.id;

SELECT institution_id, firebase_project_id, active, count(*) AS installation_count,
       count(*) FILTER (WHERE last_seen_at < now() - interval '90 days') AS stale_count
FROM public.guardian_notification_installations
GROUP BY institution_id, firebase_project_id, active
ORDER BY institution_id, firebase_project_id, active;

SELECT institution_id, count(*) AS expired_unused_invitations
FROM public.guardian_notification_invitations
WHERE consumed_at IS NULL AND revoked_at IS NULL AND expires_at < now()
GROUP BY institution_id
ORDER BY institution_id;

ROLLBACK;
