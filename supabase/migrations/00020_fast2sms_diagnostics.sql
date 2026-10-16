BEGIN;
ALTER TABLE public.sms_dispatches ADD COLUMN safe_response_body TEXT;
ALTER TABLE public.sms_dispatches ADD COLUMN transport_diagnostics JSONB;
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
      error_message=p_result->>'message',finished_at=now(), safe_response_body=left(p_result->>'safeResponseBody',4096), transport_diagnostics=p_result->'diagnostics'
    WHERE job_id=p_job AND attempt=(SELECT attempts FROM public.communication_jobs WHERE id=p_job);
  END IF;
  RETURN success;
END $$;

COMMIT;
