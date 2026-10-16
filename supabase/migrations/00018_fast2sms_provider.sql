-- Provider metadata for NEW dispatches only. No historical data is rewritten.
BEGIN;
ALTER TABLE public.sms_dispatches ALTER COLUMN provider SET DEFAULT 'fast2sms';
ALTER TABLE public.sms_dispatches ADD COLUMN submitted_at TIMESTAMPTZ;
ALTER TABLE public.sms_dispatches ADD COLUMN provider_status TEXT;

CREATE OR REPLACE FUNCTION public.finish_communication_job(p_job UUID,p_owner UUID,p_result JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE success BOOLEAN; BEGIN
  success:=public.finish_communication_job_legacy(p_job,p_owner,p_result);
  IF success THEN
    UPDATE public.sms_dispatches SET
      status=CASE WHEN status IN ('delivered','failed','undelivered') THEN status
        WHEN (p_result->>'ok')::BOOLEAN AND provider='fast2sms' THEN 'submitted'
        WHEN (p_result->>'ok')::BOOLEAN THEN COALESCE(p_result->>'status','queued')
        WHEN p_result->>'errorClass'='ambiguous' THEN 'unconfirmed' ELSE 'failed' END,
      provider_status=CASE WHEN (p_result->>'ok')::BOOLEAN THEN 'accepted'
        WHEN p_result->>'errorClass'='ambiguous' THEN 'unknown' ELSE 'rejected' END,
      submitted_at=CASE WHEN (p_result->>'ok')::BOOLEAN THEN now() ELSE NULL END,
      provider_message_id=COALESCE(provider_message_id,p_result->>'providerId'),
      http_status=(p_result->>'httpStatus')::INT,provider_code=p_result->>'providerCode',
      error_message=p_result->>'message',finished_at=now()
    WHERE job_id=p_job AND attempt=(SELECT attempts FROM public.communication_jobs WHERE id=p_job);
  END IF;
  RETURN success;
END $$;

CREATE OR REPLACE FUNCTION public.begin_sms_dispatch(p_job UUID,p_owner UUID,p_body TEXT,p_template UUID,p_recipient TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j public.communication_jobs;
BEGIN
  IF NOT public.mark_sms_dispatch_started(p_job,p_owner) THEN RETURN false; END IF;
  SELECT * INTO j FROM public.communication_jobs WHERE id=p_job;
  IF NOT EXISTS(SELECT 1 FROM public.sms_templates t JOIN public.communications c
    ON c.id=j.communication_id AND c.institution_id=t.institution_id
    JOIN public.parents p ON p.id=c.parent_id AND p.institution_id=c.institution_id
    WHERE t.id=p_template AND t.active AND t.channel='sms'
      AND regexp_replace(p.phone,'[ ()-]','','g')=p_recipient)
    OR p_recipient !~ '^\+91[6-9][0-9]{9}$'
    OR p_body IS NULL OR length(btrim(p_body))=0 OR length(p_body)>280 THEN
    RAISE EXCEPTION 'SMS dispatch payload is invalid';
  END IF;
  INSERT INTO public.sms_dispatches(institution_id,communication_id,job_id,attempt,provider,request_body)
    VALUES(j.institution_id,j.communication_id,j.id,j.attempts,'fast2sms',p_body);
  UPDATE public.communications SET body=p_body,template_id=p_template,parent_phone=p_recipient,
    provider_name='fast2sms' WHERE id=j.communication_id AND institution_id=j.institution_id;
  RETURN true;
END $$;

-- A legacy signed Twilio callback must not attach itself to a Fast2SMS request.
DO $$ DECLARE definition TEXT; BEGIN
  SELECT pg_get_functiondef('public.apply_communication_callback(text,text,uuid)'::regprocedure) INTO definition;
  IF position('WHERE id = p_communication_id AND type = ''sms'' FOR UPDATE;' IN definition)=0 THEN
    RAISE EXCEPTION 'unexpected callback definition'; END IF;
  definition := replace(definition,
    'WHERE id = p_communication_id AND type = ''sms'' FOR UPDATE;',
    'WHERE id = p_communication_id AND type = ''sms'' AND (provider_name IS NULL OR provider_name IN (''twilio'',''twilio-simulated'')) FOR UPDATE;');
  EXECUTE definition;
END $$;

-- Internal report ingestion: only a trusted Worker may call this after an
-- authenticated provider GET. Tenant and recipient come from the stored dispatch.
CREATE FUNCTION public.apply_fast2sms_report(p_request_id TEXT,p_status TEXT,p_description TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.communications; inserted UUID;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending','delivered','failed') THEN
    RAISE EXCEPTION 'unsupported delivery report'; END IF;
  SELECT * INTO c FROM public.communications WHERE type='sms'
    AND provider_name='fast2sms' AND provider_message_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.sms_dispatches d
    WHERE d.communication_id=c.id AND d.institution_id=c.institution_id
      AND d.provider='fast2sms' AND d.provider_message_id=p_request_id) THEN
    RAISE EXCEPTION 'unknown Fast2SMS request'; END IF;
  INSERT INTO public.communication_webhook_events
    (institution_id,communication_id,provider_name,provider_event_id,event_type,normalized_status)
  VALUES(c.institution_id,c.id,'fast2sms',p_request_id||':'||p_status,'delivery-report',
    CASE WHEN p_status='pending' THEN 'sent' ELSE p_status END)
  ON CONFLICT(provider_name,provider_event_id) DO NOTHING RETURNING id INTO inserted;
  IF inserted IS NULL THEN RETURN jsonb_build_object('duplicate',true,'status',c.message_status); END IF;
  IF p_status<>'pending' AND c.message_status NOT IN ('delivered','failed','undelivered') THEN
    UPDATE public.communications SET message_status=p_status,sms_status=p_status,
      error_details=CASE WHEN p_status='failed' THEN left(p_description,400) ELSE NULL END
    WHERE id=c.id AND institution_id=c.institution_id;
    UPDATE public.sms_dispatches SET status=p_status,provider_status=p_status,
      error_message=CASE WHEN p_status='failed' THEN left(p_description,400) ELSE NULL END
    WHERE communication_id=c.id AND institution_id=c.institution_id
      AND provider='fast2sms' AND provider_message_id=p_request_id;
    RETURN jsonb_build_object('duplicate',false,'status',p_status);
  END IF;
  RETURN jsonb_build_object('duplicate',false,'status',c.message_status);
END $$;
REVOKE ALL ON FUNCTION public.apply_fast2sms_report(TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_fast2sms_report(TEXT,TEXT,TEXT) TO service_role;
COMMIT;
