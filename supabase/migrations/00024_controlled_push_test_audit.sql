-- Preserve the outcome of a single controlled FCM attempt independently of attendance.
BEGIN;

ALTER TABLE public.controlled_push_tests
  ADD COLUMN provider text NOT NULL DEFAULT 'fcm' CHECK (provider = 'fcm'),
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN failure_code text,
  ADD COLUMN failure_reason text;

NOTIFY pgrst, 'reload schema';
COMMIT;
