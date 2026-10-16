BEGIN;

-- A dedicated provider transport test is deliberately separate from attendance
-- communications, SMS jobs and dispatches.
CREATE TABLE public.sms_transport_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_key TEXT NOT NULL UNIQUE,
  institution_id UUID NOT NULL REFERENCES public.institutions(id),
  parent_id UUID NOT NULL REFERENCES public.parents(id),
  recipient TEXT NOT NULL CHECK (recipient ~ '^\+91[6-9][0-9]{9}$'),
  route TEXT NOT NULL DEFAULT 'q' CHECK (route = 'q'),
  body TEXT NOT NULL CHECK (body = 'AttendAI SMS test. No attendance action is required.'),
  status TEXT NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared','sending','accepted','rejected','unconfirmed')),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count BETWEEN 0 AND 1),
  http_status INTEGER,
  provider_code TEXT,
  safe_response_body TEXT,
  provider_error TEXT,
  provider_request_id TEXT UNIQUE,
  provider_accepted BOOLEAN,
  delivery_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (delivery_status IN ('unknown','pending','delivered','failed')),
  request_started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  transport_diagnostics JSONB
);
ALTER TABLE public.sms_transport_tests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_transport_tests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sms_transport_tests TO service_role;

CREATE FUNCTION public.prepare_sms_transport_test(
  p_execution_key TEXT, p_institution UUID, p_parent UUID, p_recipient TEXT, p_body TEXT
) RETURNS public.sms_transport_tests
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE existing public.sms_transport_tests; eligible BOOLEAN;
BEGIN
  IF p_execution_key IS NULL OR length(p_execution_key) NOT BETWEEN 8 AND 100
    OR p_recipient !~ '^\+91[6-9][0-9]{9}$'
    OR p_body <> 'AttendAI SMS test. No attendance action is required.' THEN
    RAISE EXCEPTION 'invalid SMS transport test';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_parent::TEXT, 19));
  SELECT * INTO existing FROM public.sms_transport_tests WHERE execution_key=p_execution_key;
  IF FOUND THEN
    IF existing.institution_id<>p_institution OR existing.parent_id<>p_parent
      OR existing.recipient<>p_recipient OR existing.body<>p_body THEN
      RAISE EXCEPTION 'test execution key target mismatch';
    END IF;
    RETURN existing;
  END IF;
  IF EXISTS (SELECT 1 FROM public.sms_transport_tests
    WHERE parent_id=p_parent AND created_at > now()-interval '24 hours') THEN
    RAISE EXCEPTION 'test recipient rate limit';
  END IF;
  SELECT p.communication_consent AND p.active AND p.preferred_channel='sms'
    AND i.status='active' AND EXISTS (
      SELECT 1 FROM public.student_parents sp JOIN public.students s
        ON s.id=sp.student_id AND s.institution_id=sp.institution_id
      WHERE sp.parent_id=p.id AND sp.institution_id=p.institution_id
        AND sp.receives_notifications AND s.enrollment_status='active'
    ) INTO eligible
  FROM public.parents p JOIN public.institutions i ON i.id=p.institution_id
  WHERE p.id=p_parent AND p.institution_id=p_institution
    AND regexp_replace(p.phone,'[ ()-]','','g')=p_recipient
  FOR UPDATE OF p;
  IF NOT COALESCE(eligible,false) THEN RAISE EXCEPTION 'test guardian is not eligible'; END IF;
  INSERT INTO public.sms_transport_tests(execution_key,institution_id,parent_id,recipient,body)
    VALUES(p_execution_key,p_institution,p_parent,p_recipient,p_body) RETURNING * INTO existing;
  RETURN existing;
END $$;
REVOKE ALL ON FUNCTION public.prepare_sms_transport_test(TEXT,UUID,UUID,TEXT,TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_sms_transport_test(TEXT,UUID,UUID,TEXT,TEXT)
  TO service_role;

CREATE FUNCTION public.begin_sms_transport_test(p_id UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  UPDATE public.sms_transport_tests SET status='sending',request_count=1,
    request_started_at=now()
  WHERE id=p_id AND status='prepared' AND request_count=0;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.begin_sms_transport_test(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_sms_transport_test(UUID) TO service_role;

CREATE FUNCTION public.finish_sms_transport_test(
  p_id UUID, p_http_status INTEGER, p_safe_response_body TEXT,
  p_provider_code TEXT, p_request_id TEXT, p_accepted BOOLEAN,
  p_provider_error TEXT, p_diagnostics JSONB
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  UPDATE public.sms_transport_tests SET
    status=CASE WHEN p_accepted IS TRUE THEN 'accepted'
      WHEN p_accepted IS FALSE THEN 'rejected' ELSE 'unconfirmed' END,
    http_status=p_http_status, safe_response_body=left(p_safe_response_body,4096),
    provider_code=left(p_provider_code,100), provider_request_id=p_request_id,
    provider_accepted=p_accepted, provider_error=left(p_provider_error,1000),
    transport_diagnostics=p_diagnostics,
    delivery_status=CASE WHEN p_accepted IS TRUE THEN 'pending' ELSE 'unknown' END,
    submitted_at=CASE WHEN p_accepted IS TRUE THEN now() ELSE NULL END,
    finished_at=now()
  WHERE id=p_id AND status='sending' AND request_count=1;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.finish_sms_transport_test(UUID,INTEGER,TEXT,TEXT,TEXT,BOOLEAN,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_sms_transport_test(UUID,INTEGER,TEXT,TEXT,TEXT,BOOLEAN,TEXT,JSONB)
  TO service_role;

CREATE FUNCTION public.apply_sms_transport_test_report(
  p_id UUID,p_request_id TEXT,p_status TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_status NOT IN ('pending','delivered','failed') THEN RAISE EXCEPTION 'invalid report status'; END IF;
  UPDATE public.sms_transport_tests SET delivery_status=p_status
  WHERE id=p_id AND status='accepted' AND provider_request_id=p_request_id;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.apply_sms_transport_test_report(UUID,TEXT,TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_sms_transport_test_report(UUID,TEXT,TEXT)
  TO service_role;

COMMIT;
