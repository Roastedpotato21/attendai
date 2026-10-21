BEGIN;
CREATE FUNCTION public.period_notification_eligible(p_communication uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.period_notification_events;r public.period_notification_recipients;f jsonb;
BEGIN
 SELECT * INTO r FROM public.period_notification_recipients WHERE communication_id=p_communication;
 SELECT * INTO e FROM public.period_notification_events WHERE id=r.event_id;
 IF e.id IS NULL OR r.state<>'queued' OR e.expires_at<=clock_timestamp()
 OR NOT coalesce((SELECT enabled FROM public.period_notification_settings WHERE institution_id=e.institution_id),false)
 OR NOT public.guardian_communication_eligible(p_communication)
 OR NOT EXISTS(SELECT 1 FROM public.student_guardian_relationships sr WHERE sr.id=r.relationship_id AND sr.institution_id=e.institution_id AND sr.student_id=e.student_id AND sr.guardian_id=r.guardian_id AND sr.status='active' AND sr.receives_notifications AND public.setup_today(e.institution_id) BETWEEN sr.effective_from AND coalesce(sr.effective_until,'infinity') AND (sr.preferred_channel IS NULL OR sr.preferred_channel='push')) THEN RETURN false;END IF;
 IF e.kind='daily_summary' THEN RETURN jsonb_array_length(e.facts)>0 AND e.facts=public.period_absence_facts(e.institution_id,e.student_id,e.attendance_date);END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(e.facts) LOOP
 IF NOT EXISTS(SELECT 1 FROM public.period_marks m JOIN public.period_sessions s ON s.id=m.session_id
 WHERE m.session_id=(f->>'session_id')::uuid AND m.student_id=e.student_id AND m.institution_id=e.institution_id
 AND s.submitted_at IS NOT NULL AND s.lock_at<=clock_timestamp() AND s.status<>'cancelled'
 AND m.status=f->>'status' AND (e.kind='first_absence' AND m.status='absent' OR e.kind='correction' AND m.revision=(f->>'revision')::bigint)) THEN RETURN false;END IF;
 END LOOP;
 RETURN e.kind<>'correction' OR EXISTS(SELECT 1 FROM public.period_notification_recipients original JOIN public.communication_dispatches d ON d.communication_id=original.communication_id WHERE original.event_id=e.original_event_id AND original.guardian_id=r.guardian_id AND d.status='provider_accepted');
END $$;
ALTER FUNCTION public.begin_push_dispatch(uuid,uuid,uuid) RENAME TO begin_push_before_period_notifications;
REVOKE ALL ON FUNCTION public.begin_push_before_period_notifications(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.begin_push_dispatch(p_job uuid,p_owner uuid,p_installation uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j public.communication_jobs;c public.communications;e public.period_notification_events;d public.communication_dispatches;
BEGIN
 SELECT * INTO j FROM public.communication_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RETURN 'lease_lost';END IF;
 PERFORM public.lock_staff_lifecycle(j.institution_id);
 SELECT * INTO c FROM public.communications WHERE id=j.communication_id;
 IF c.metadata->>'purpose'<>'period-attendance' OR c.metadata->>'purpose' IS NULL THEN RETURN public.begin_push_before_period_notifications(p_job,p_owner,p_installation);END IF;
 SELECT * INTO j FROM public.communication_jobs WHERE id=p_job FOR UPDATE;
 IF j.status='completed' AND EXISTS(SELECT 1 FROM public.period_notification_recipients r WHERE r.communication_id=j.communication_id AND r.state='cancelled') THEN RETURN 'cancelled';END IF;
 IF j.channel<>'push' OR j.status<>'processing' OR j.lease_owner IS DISTINCT FROM p_owner OR j.locked_at<now()-interval '15 minutes' THEN RETURN 'lease_lost';END IF;
 SELECT ev.* INTO e FROM public.period_notification_events ev JOIN public.period_notification_recipients r ON r.event_id=ev.id WHERE r.communication_id=c.id;
 IF e.id IS NULL THEN RETURN 'ineligible';END IF;
 PERFORM public.reconcile_period_notifications(e.institution_id,e.student_id,e.attendance_date);
 IF NOT public.period_notification_eligible(c.id) OR NOT public.period_notification_device_valid(p_installation,c.parent_id,c.institution_id) THEN
 PERFORM public.period_notification_log(e.id,c.id,'dispatch.ineligible',jsonb_build_object('reason','Current attendance, expiry, relationship, contact, consent or registration gate failed'));RETURN 'ineligible';END IF;
 SELECT * INTO d FROM public.communication_dispatches WHERE communication_id=c.id AND installation_id=p_installation FOR UPDATE;
 IF FOUND THEN
 IF d.status='provider_accepted' THEN RETURN 'already_accepted';END IF;
 IF d.status IN ('sending','unconfirmed') THEN RETURN 'unconfirmed';END IF;
 IF d.status IN ('failed','invalid_device') OR d.attempt_count>=j.max_attempts THEN RETURN 'already_failed';END IF;
 IF d.next_run_at>now() THEN RETURN 'wait';END IF;
 UPDATE public.communication_dispatches SET status='sending',attempt_count=attempt_count+1,provider_request_started_at=clock_timestamp(),failure_code=NULL,failure_reason=NULL WHERE id=d.id;
 ELSE
 INSERT INTO public.communication_dispatches(institution_id,communication_id,job_id,guardian_id,installation_id,status,attempt_count,provider_request_started_at)
 VALUES(j.institution_id,c.id,j.id,c.parent_id,p_installation,'sending',1,clock_timestamp());
 END IF;
 RETURN 'send';
END $$;

-- Return the current snapshot in the same transaction as dispatch authorization.
-- This prevents a worker's earlier read from rendering superseded summary content.
CREATE FUNCTION public.prepare_push_dispatch(p_job uuid,p_owner uuid,p_installation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE decision text;c public.communications;BEGIN
 decision:=public.begin_push_dispatch(p_job,p_owner,p_installation);
 SELECT c1.* INTO c FROM public.communications c1 JOIN public.communication_jobs j ON j.communication_id=c1.id WHERE j.id=p_job;
 RETURN jsonb_build_object('status',decision,'metadata',c.metadata);
END $$;
ALTER FUNCTION public.finish_push_dispatch(uuid,uuid,uuid,text,text,text) RENAME TO finish_push_before_period_notifications;
REVOKE ALL ON FUNCTION public.finish_push_before_period_notifications(uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.finish_push_dispatch(p_job uuid,p_owner uuid,p_installation uuid,p_status text,p_provider_id text DEFAULT NULL,p_code text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.period_notification_events;tenant uuid;ok boolean;BEGIN
 SELECT institution_id INTO tenant FROM public.communication_jobs WHERE id=p_job;
 IF tenant IS NULL THEN RETURN false;END IF;
 PERFORM public.lock_staff_lifecycle(tenant);
 IF p_status='provider_accepted' AND (p_provider_id IS NULL OR p_provider_id NOT LIKE 'projects/attendai-41f64/messages/%') THEN RETURN false;END IF;
 ok:=public.finish_push_before_period_notifications(p_job,p_owner,p_installation,p_status,p_provider_id,p_code);
 IF ok AND p_status='provider_accepted' THEN
 SELECT ev.* INTO e FROM public.period_notification_events ev JOIN public.period_notification_recipients r ON r.event_id=ev.id JOIN public.communication_jobs j ON j.communication_id=r.communication_id WHERE j.id=p_job;
 IF e.id IS NOT NULL THEN PERFORM public.reconcile_period_notifications(e.institution_id,e.student_id,e.attendance_date);END IF;
 END IF;RETURN ok;
END $$;
CREATE FUNCTION public.period_dispatch_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE event uuid;BEGIN
 SELECT event_id INTO event FROM public.period_notification_recipients WHERE communication_id=NEW.communication_id;
 IF event IS NOT NULL THEN
 PERFORM public.period_notification_log(event,NEW.communication_id,CASE WHEN TG_OP='UPDATE' AND NEW.display_acknowledged_at IS DISTINCT FROM OLD.display_acknowledged_at THEN 'dispatch.device_acknowledged' ELSE 'dispatch.'||NEW.status END,jsonb_build_object('dispatch_id',NEW.id,'attempt',NEW.attempt_count,'provider_id',NEW.provider_message_id,'failure_code',NEW.failure_code,'display_acknowledged_at',NEW.display_acknowledged_at));
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER period_dispatch_history AFTER INSERT OR UPDATE OF status,display_acknowledged_at ON public.communication_dispatches FOR EACH ROW EXECUTE FUNCTION public.period_dispatch_audit();
CREATE FUNCTION public.period_communication_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE event uuid;BEGIN
 SELECT event_id INTO event FROM public.period_notification_recipients WHERE communication_id=NEW.id;
 IF event IS NOT NULL AND NEW.message_status IS DISTINCT FROM OLD.message_status THEN
 PERFORM public.period_notification_log(event,NEW.id,'communication.state',jsonb_build_object('previous',OLD.message_status,'current',NEW.message_status,'reason',NEW.error_details,'provider_id',NEW.provider_message_id));
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER period_communication_history AFTER UPDATE OF message_status ON public.communications FOR EACH ROW EXECUTE FUNCTION public.period_communication_audit();
ALTER FUNCTION public.complete_push_job(uuid,uuid,boolean) RENAME TO complete_push_before_period_notifications;
REVOKE ALL ON FUNCTION public.complete_push_before_period_notifications(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.complete_push_job(p_job uuid,p_owner uuid,p_suppressed boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j public.communication_jobs;BEGIN
 SELECT * INTO j FROM public.communication_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RETURN 'lease_lost';END IF;
 PERFORM public.lock_staff_lifecycle(j.institution_id);
 SELECT * INTO j FROM public.communication_jobs WHERE id=p_job FOR UPDATE;
 IF j.status='completed' AND EXISTS(SELECT 1 FROM public.period_notification_recipients r WHERE r.communication_id=j.communication_id AND r.state='cancelled') THEN RETURN 'cancelled';END IF;
 RETURN public.complete_push_before_period_notifications(p_job,p_owner,p_suppressed);
END $$;

-- Device-cookie authorization is performed by the accountless server endpoint.
-- This repeats the database privacy checks and returns only this recipient's facts.
CREATE FUNCTION public.period_guardian_event_status(p_communication uuid,p_installation uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.period_notification_recipients;e public.period_notification_events;facts jsonb;BEGIN
 SELECT * INTO r FROM public.period_notification_recipients WHERE communication_id=p_communication;
 SELECT * INTO e FROM public.period_notification_events WHERE id=r.event_id;
 IF e.id IS NULL OR NOT public.period_notification_device_valid(p_installation,r.guardian_id,r.institution_id)
 OR NOT public.guardian_communication_eligible(p_communication)
 OR NOT EXISTS(SELECT 1 FROM public.communication_dispatches WHERE communication_id=p_communication AND installation_id=p_installation AND status='provider_accepted') THEN RETURN NULL;END IF;
 SELECT jsonb_agg(f.value||jsonb_build_object('status',m.status)) INTO facts FROM jsonb_array_elements(e.facts) f
 JOIN public.period_marks m ON m.session_id=(f.value->>'session_id')::uuid AND m.student_id=e.student_id AND m.institution_id=e.institution_id;
 RETURN jsonb_build_object('kind',e.kind,'date',e.attendance_date,'facts',coalesce(facts,'[]'));
END $$;
DO $$ DECLARE f record;BEGIN
 FOR f IN SELECT oid::regprocedure AS signature,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('period_notification_eligible','begin_push_dispatch','prepare_push_dispatch','finish_push_dispatch','complete_push_job','period_dispatch_audit','period_communication_audit','period_guardian_event_status') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 IF f.proname NOT IN ('period_dispatch_audit','period_communication_audit') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);END IF;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
