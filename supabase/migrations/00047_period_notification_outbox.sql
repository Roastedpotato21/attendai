-- Period notifications are separate logical events; existing communications carry transport attempts.
BEGIN;
CREATE TABLE public.period_notification_settings (
 institution_id uuid PRIMARY KEY REFERENCES public.institutions(id), enabled boolean NOT NULL DEFAULT false,
 summary_local_time time NOT NULL DEFAULT '17:00', updated_by uuid REFERENCES public.profiles(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.period_notification_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES public.institutions(id),
 student_id uuid NOT NULL, attendance_date date NOT NULL, kind text NOT NULL CHECK(kind IN ('first_absence','correction','daily_summary')),
 original_event_id uuid REFERENCES public.period_notification_events(id), change_key text,
 facts jsonb NOT NULL CHECK(jsonb_typeof(facts)='array'), expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(institution_id,id), FOREIGN KEY(institution_id,student_id) REFERENCES public.students(institution_id,id),
 CHECK((kind='correction')=(original_event_id IS NOT NULL)),
 UNIQUE(original_event_id,change_key)
);
CREATE UNIQUE INDEX period_notification_one_daily ON public.period_notification_events(institution_id,student_id,attendance_date,kind) WHERE kind IN ('first_absence','daily_summary');
CREATE TABLE public.period_notification_recipients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL,
 event_id uuid NOT NULL, guardian_id uuid NOT NULL, relationship_id uuid NOT NULL,
 contact_version bigint NOT NULL, communication_id uuid,
 state text NOT NULL CHECK(state IN ('created','queued','unavailable','ineligible','cancelled')),
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(event_id,guardian_id), UNIQUE(communication_id),
 FOREIGN KEY(institution_id,event_id) REFERENCES public.period_notification_events(institution_id,id),
 FOREIGN KEY(institution_id,guardian_id) REFERENCES public.parents(institution_id,id),
 FOREIGN KEY(relationship_id) REFERENCES public.student_guardian_relationships(id),
 FOREIGN KEY(institution_id,communication_id) REFERENCES public.communications(institution_id,id)
);
CREATE TABLE public.period_notification_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, institution_id uuid NOT NULL REFERENCES public.institutions(id),
 event_id uuid REFERENCES public.period_notification_events(id), communication_id uuid,
 action text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['period_notification_settings','period_notification_events','period_notification_recipients','period_notification_audit'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON SEQUENCE public.period_notification_audit_id_seq TO service_role;

CREATE FUNCTION public.set_period_notification_settings(p_institution uuid,p_enabled boolean,p_summary_time time) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.lock_staff_lifecycle(p_institution);
 IF NOT public.period_identity(p_institution) OR NOT public.setup_is_admin(p_institution) THEN RAISE EXCEPTION 'institution administrator required' USING ERRCODE='42501';END IF;
 IF p_enabled IS NULL OR p_summary_time IS NULL THEN RAISE EXCEPTION 'explicit notification settings required' USING ERRCODE='22023';END IF;
 INSERT INTO public.period_notification_settings(institution_id,enabled,summary_local_time,updated_by) VALUES(p_institution,p_enabled,p_summary_time,public.current_profile_id())
 ON CONFLICT(institution_id) DO UPDATE SET enabled=excluded.enabled,summary_local_time=excluded.summary_local_time,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 INSERT INTO public.period_notification_audit(institution_id,action,details) VALUES(p_institution,'settings.changed',jsonb_build_object('enabled',p_enabled,'summary_local_time',p_summary_time,'actor',public.current_profile_id()));
END $$;

-- The facts come from finalized current marks, never the absence of a submission.
CREATE FUNCTION public.period_absence_facts(p_institution uuid,p_student uuid,p_date date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('session_id',s.id,'subject',s.planned->>'subject_name','period',s.planned->>'label',
 'slots',s.planned->'slots','status',m.status,'revision',m.revision) ORDER BY s.starts_at,s.id),'[]'::jsonb)
 FROM public.period_marks m JOIN public.period_sessions s ON s.id=m.session_id AND s.institution_id=m.institution_id
 WHERE m.institution_id=p_institution AND m.student_id=p_student AND s.session_date=p_date
 AND s.submitted_at IS NOT NULL AND s.lock_at<=clock_timestamp() AND s.status<>'cancelled' AND m.status='absent';
$$;
CREATE FUNCTION public.period_notification_device_valid(p_installation uuid,p_guardian uuid,p_institution uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.guardian_notification_installations i JOIN public.guardian_notification_consents c ON c.installation_id=i.id
 WHERE i.id=p_installation AND i.guardian_id=p_guardian AND i.institution_id=p_institution AND i.active AND i.revoked_at IS NULL
 AND i.permission_state='granted' AND i.firebase_project_id='attendai-41f64' AND i.last_seen_at>=now()-interval '90 days'
 AND c.status='accepted' AND c.consent_version='2026-10-16.1' AND c.revoked_at IS NULL);
$$;
CREATE FUNCTION public.period_notification_log(p_event uuid,p_communication uuid,p_action text,p_details jsonb DEFAULT '{}') RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 INSERT INTO public.period_notification_audit(institution_id,event_id,communication_id,action,details)
 SELECT institution_id,id,p_communication,p_action,p_details FROM public.period_notification_events WHERE id=p_event;
$$;

CREATE FUNCTION public.period_notification_add_recipient(p_event uuid,p_guardian uuid,p_reported text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.period_notification_events; r public.student_guardian_relationships; p public.parents; recipient uuid; comm uuid; key text; eligible boolean;
BEGIN
 SELECT * INTO e FROM public.period_notification_events WHERE id=p_event;
 SELECT * INTO p FROM public.parents WHERE id=p_guardian AND institution_id=e.institution_id;
 SELECT * INTO r FROM public.student_guardian_relationships WHERE institution_id=e.institution_id AND student_id=e.student_id AND guardian_id=p_guardian
 AND status='active' AND public.setup_today(e.institution_id) BETWEEN effective_from AND coalesce(effective_until,'infinity') ORDER BY created_at DESC LIMIT 1;
 IF r.id IS NULL THEN RETURN;END IF;
 eligible:=p.communication_consent AND public.guardian_relationship_eligible(e.institution_id,e.student_id,p.id) AND (r.preferred_channel IS NULL OR r.preferred_channel='push');
 INSERT INTO public.period_notification_recipients(institution_id,event_id,guardian_id,relationship_id,contact_version,state,reason)
 VALUES(e.institution_id,e.id,p.id,r.id,p.contact_version,CASE WHEN eligible THEN 'created' ELSE 'ineligible' END,
 CASE WHEN eligible THEN 'Recipient resolved using current relationship and consent' ELSE 'Current relationship, contact, student or consent is ineligible' END)
 ON CONFLICT(event_id,guardian_id) DO NOTHING RETURNING id INTO recipient;
 IF recipient IS NULL THEN RETURN;END IF;
 IF NOT eligible THEN PERFORM public.period_notification_log(e.id,NULL,'recipient.ineligible',jsonb_build_object('relationship_id',r.id));RETURN;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.guardian_notification_installations i WHERE public.period_notification_device_valid(i.id,p.id,e.institution_id)) THEN
 UPDATE public.period_notification_recipients SET state='unavailable',reason='No current-project consented delivery registration' WHERE id=recipient;
 PERFORM public.period_notification_log(e.id,NULL,'recipient.unavailable',jsonb_build_object('relationship_id',r.id));RETURN;END IF;
 key:='period:'||e.id||':'||p.id;
 INSERT INTO public.communications(institution_id,student_id,parent_id,type,direction,message_status,body,metadata,idempotency_key)
 VALUES(e.institution_id,e.student_id,p.id,'push','outbound','queued','Period attendance notification.',
 jsonb_build_object('purpose','period-attendance','period_event_id',e.id,'kind',e.kind,'attendance_date',e.attendance_date,'facts',CASE WHEN p_reported IS NULL THEN e.facts ELSE jsonb_set(e.facts,'{0,old_status}',to_jsonb(p_reported)) END,'original_event_id',e.original_event_id,'language',p.language,'expires_at',e.expires_at),key) RETURNING id INTO comm;
 INSERT INTO public.communication_jobs(institution_id,communication_id,channel,payload,idempotency_key) VALUES(e.institution_id,comm,'push',jsonb_build_object('communication_id',comm),key);
 UPDATE public.period_notification_recipients SET communication_id=comm,state='queued',reason='Queued; no provider delivery claim' WHERE id=recipient;
 PERFORM public.period_notification_log(e.id,comm,'recipient.queued',jsonb_build_object('relationship_id',r.id,'contact_version',p.contact_version));
END $$;

CREATE FUNCTION public.period_notification_cancel(p_communication uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.period_notification_recipients;
BEGIN
 SELECT * INTO r FROM public.period_notification_recipients WHERE communication_id=p_communication FOR UPDATE;
 IF r.id IS NULL OR r.state='cancelled' THEN RETURN;END IF;
 -- An external attempt already fenced as sending is uncertain, not safely retractable.
 UPDATE public.period_notification_recipients SET state='cancelled',reason=p_reason WHERE id=r.id;
 UPDATE public.communication_jobs SET status='completed',completed_at=clock_timestamp(),locked_at=NULL,lease_owner=NULL,last_error=p_reason
 WHERE communication_id=p_communication AND NOT EXISTS(SELECT 1 FROM public.communication_dispatches d WHERE d.communication_id=p_communication AND d.status IN ('sending','unconfirmed','provider_accepted'));
 UPDATE public.communications SET message_status='suppressed',error_details=p_reason
 WHERE id=p_communication AND NOT EXISTS(SELECT 1 FROM public.communication_dispatches d WHERE d.communication_id=p_communication AND d.status IN ('sending','unconfirmed','provider_accepted'));
 PERFORM public.period_notification_log(r.event_id,p_communication,'recipient.cancelled',jsonb_build_object('reason',p_reason));
END $$;

-- Reconcile under the same institution mutex as corrections, contact changes and dispatch fencing.
CREATE FUNCTION public.reconcile_period_notifications(p_institution uuid,p_student uuid,p_date date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.period_notification_events; r record; f jsonb; m public.period_marks; s public.period_sessions; correction uuid; reported text; current_facts jsonb;
BEGIN
 PERFORM public.lock_staff_lifecycle(p_institution);
 current_facts:=public.period_absence_facts(p_institution,p_student,p_date);
 FOR e IN SELECT * FROM public.period_notification_events WHERE institution_id=p_institution AND student_id=p_student AND attendance_date=p_date AND kind<>'correction' ORDER BY created_at LOOP
  -- A queued summary is refreshed to final facts, with an audit of the superseded snapshot.
  IF e.kind='daily_summary' AND e.facts IS DISTINCT FROM current_facts AND NOT EXISTS(SELECT 1 FROM public.period_notification_recipients x JOIN public.communication_dispatches d ON d.communication_id=x.communication_id WHERE x.event_id=e.id AND d.status IN ('sending','unconfirmed','provider_accepted')) THEN
   PERFORM public.period_notification_log(e.id,NULL,'summary.refreshed',jsonb_build_object('previous',e.facts,'current',current_facts));
   UPDATE public.period_notification_events SET facts=current_facts WHERE id=e.id;
   UPDATE public.communications SET metadata=jsonb_set(metadata,'{facts}',current_facts) WHERE id IN(SELECT communication_id FROM public.period_notification_recipients WHERE event_id=e.id);
   e.facts:=current_facts;
  END IF;
  FOR r IN SELECT * FROM public.period_notification_recipients WHERE event_id=e.id LOOP
   IF r.communication_id IS NULL THEN CONTINUE;END IF;
   FOR f IN SELECT value FROM jsonb_array_elements(e.facts) LOOP
    SELECT * INTO s FROM public.period_sessions WHERE id=(f->>'session_id')::uuid;
    SELECT * INTO m FROM public.period_marks WHERE session_id=s.id AND student_id=p_student;
    IF m.status IS NULL THEN CONTINUE;END IF;
    -- What this guardian may already have received, including an in-flight correction.
    SELECT ce.facts->0->>'status' INTO reported FROM public.period_notification_events ce JOIN public.period_notification_recipients cr ON cr.event_id=ce.id
    WHERE ce.original_event_id=e.id AND cr.guardian_id=r.guardian_id AND ce.facts->0->>'session_id'=s.id::text
    AND EXISTS(SELECT 1 FROM public.communication_dispatches d WHERE d.communication_id=cr.communication_id AND d.status IN ('provider_accepted','sending','unconfirmed')) ORDER BY ce.created_at DESC,ce.id DESC LIMIT 1;
    reported:=coalesce(reported,f->>'status');
    IF (m.status::text<>f->>'status' OR s.status='cancelled') THEN
     PERFORM public.period_notification_cancel(r.communication_id,'Attendance changed before remaining dispatches');
    END IF;
    IF reported<>m.status::text AND EXISTS(SELECT 1 FROM public.communication_dispatches d WHERE d.communication_id=r.communication_id AND d.status='provider_accepted')
     AND r.contact_version=(SELECT contact_version FROM public.parents WHERE id=r.guardian_id) THEN
     INSERT INTO public.period_notification_events(institution_id,student_id,attendance_date,kind,original_event_id,change_key,facts,expires_at)
     VALUES(p_institution,p_student,p_date,'correction',e.id,s.id||':'||m.revision,
     jsonb_build_array(f||jsonb_build_object('status',m.status,'old_status',reported,'revision',m.revision)),clock_timestamp()+interval '8 hours')
     ON CONFLICT(original_event_id,change_key) DO UPDATE SET change_key=excluded.change_key RETURNING id INTO correction;
     PERFORM public.period_notification_add_recipient(correction,r.guardian_id,reported);
    END IF;
   END LOOP;
   IF r.state='cancelled' AND NOT EXISTS(SELECT 1 FROM public.communication_dispatches d WHERE d.communication_id=r.communication_id AND d.status IN ('sending','unconfirmed','provider_accepted')) THEN
    UPDATE public.period_notification_recipients SET state='queued' WHERE id=r.id;
    -- Only the existing contact checkpoint and logical event may resume. No retargeting.
    IF public.period_notification_eligible(r.communication_id) THEN
     UPDATE public.communication_jobs SET status='pending',completed_at=NULL,locked_at=NULL,lease_owner=NULL,next_run_at=clock_timestamp(),last_error=NULL WHERE communication_id=r.communication_id;
     UPDATE public.communications SET message_status='queued',error_details=NULL WHERE id=r.communication_id;
     UPDATE public.period_notification_recipients SET reason='Attendance is eligible again under the same logical daily event' WHERE id=r.id;
     PERFORM public.period_notification_log(e.id,r.communication_id,'recipient.resumed');
    ELSE UPDATE public.period_notification_recipients SET state='cancelled' WHERE id=r.id;END IF;
   END IF;
   IF e.kind='daily_summary' AND jsonb_array_length(e.facts)=0 THEN PERFORM public.period_notification_cancel(r.communication_id,'No final absences remain');END IF;
  END LOOP;
 END LOOP;
 -- Superseded corrections are never sent from an old queued revision.
 FOR r IN SELECT x.communication_id,ev.id FROM public.period_notification_events ev JOIN public.period_notification_recipients x ON x.event_id=ev.id
 WHERE ev.institution_id=p_institution AND ev.student_id=p_student AND ev.attendance_date=p_date AND ev.kind='correction'
 AND EXISTS(SELECT 1 FROM public.period_marks pm WHERE pm.session_id=(ev.facts->0->>'session_id')::uuid AND pm.student_id=p_student AND pm.revision<>(ev.facts->0->>'revision')::bigint) LOOP
 PERFORM public.period_notification_cancel(r.communication_id,'Superseded by a later attendance revision');END LOOP;
END $$;

CREATE FUNCTION public.period_mark_notification_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE day date;BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status THEN
 SELECT session_date INTO day FROM public.period_sessions WHERE id=NEW.session_id;
 PERFORM public.reconcile_period_notifications(NEW.institution_id,NEW.student_id,day);
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER period_mark_notifications AFTER UPDATE OF status ON public.period_marks FOR EACH ROW EXECUTE FUNCTION public.period_mark_notification_change();

CREATE FUNCTION public.process_period_notifications(p_limit int DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE candidate record; e uuid; facts jsonb; r record; processed int:=0; count_events int:=0; cut timestamptz;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'bounded processor limit required' USING ERRCODE='22023';END IF;
 FOR candidate IN
 SELECT DISTINCT s.institution_id,m.student_id,s.session_date,ns.summary_local_time FROM public.period_sessions s
 JOIN public.period_marks m ON m.session_id=s.id JOIN public.period_notification_settings ns ON ns.institution_id=s.institution_id AND ns.enabled
 JOIN public.students student ON student.id=m.student_id AND student.institution_id=s.institution_id AND student.enrollment_status='active'
 WHERE m.status='absent' AND s.submitted_at IS NOT NULL AND s.lock_at<=clock_timestamp() AND s.status<>'cancelled'
 AND s.session_date BETWEEN public.setup_today(s.institution_id)-1 AND public.setup_today(s.institution_id)
 AND (NOT EXISTS(SELECT 1 FROM public.period_notification_events e WHERE e.institution_id=s.institution_id AND e.student_id=m.student_id AND e.attendance_date=s.session_date AND e.kind='first_absence') AND s.session_date=public.setup_today(s.institution_id) AND s.lock_at>clock_timestamp()-interval '8 hours'
 OR NOT EXISTS(SELECT 1 FROM public.period_notification_events e WHERE e.institution_id=s.institution_id AND e.student_id=m.student_id AND e.attendance_date=s.session_date AND e.kind='daily_summary') AND clock_timestamp() BETWEEN public.period_day_time(s.institution_id,s.session_date,ns.summary_local_time) AND public.period_day_time(s.institution_id,s.session_date,ns.summary_local_time)+interval '8 hours')
 ORDER BY s.institution_id,m.student_id,s.session_date LIMIT p_limit
 LOOP
 PERFORM public.lock_staff_lifecycle(candidate.institution_id);
 IF NOT coalesce((SELECT enabled FROM public.period_notification_settings WHERE institution_id=candidate.institution_id),false) THEN CONTINUE;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.students WHERE id=candidate.student_id AND enrollment_status='active') THEN CONTINUE;END IF;
 facts:=public.period_absence_facts(candidate.institution_id,candidate.student_id,candidate.session_date);
 IF jsonb_array_length(facts)=0 THEN CONTINUE;END IF;
 processed:=processed+1;
 FOREACH cut IN ARRAY ARRAY[NULL::timestamptz,public.period_day_time(candidate.institution_id,candidate.session_date,candidate.summary_local_time)] LOOP
 IF cut IS NULL AND (candidate.session_date<>public.setup_today(candidate.institution_id) OR NOT EXISTS(SELECT 1 FROM public.period_sessions ps WHERE ps.id=(facts->0->>'session_id')::uuid AND ps.lock_at>clock_timestamp()-interval '8 hours')) THEN CONTINUE;END IF;
 IF cut IS NOT NULL AND (clock_timestamp()<cut OR clock_timestamp()>=cut+interval '8 hours') THEN CONTINUE;END IF;
 INSERT INTO public.period_notification_events(institution_id,student_id,attendance_date,kind,facts,expires_at)
 VALUES(candidate.institution_id,candidate.student_id,candidate.session_date,CASE WHEN cut IS NULL THEN 'first_absence' ELSE 'daily_summary' END,
 CASE WHEN cut IS NULL THEN jsonb_build_array(facts->0) ELSE facts END,coalesce(cut,(SELECT ps.lock_at FROM public.period_sessions ps WHERE ps.id=(facts->0->>'session_id')::uuid))+interval '8 hours')
 ON CONFLICT DO NOTHING RETURNING id INTO e;
 IF e IS NULL THEN CONTINUE;END IF;
 count_events:=count_events+1;PERFORM public.period_notification_log(e,NULL,'event.created',jsonb_build_object('kind',CASE WHEN cut IS NULL THEN 'first_absence' ELSE 'daily_summary' END,'student_id',candidate.student_id,'date',candidate.session_date));
 FOR r IN SELECT DISTINCT guardian_id FROM public.student_guardian_relationships WHERE institution_id=candidate.institution_id AND student_id=candidate.student_id AND status='active' LOOP
 PERFORM public.period_notification_add_recipient(e,r.guardian_id);END LOOP;
 END LOOP;
 END LOOP;
 RETURN jsonb_build_object('student_days',processed,'events_created',count_events);
END $$;

-- All event/recipient bodies remain server-only. Staff receive aggregate statuses through a scoped RPC.
CREATE FUNCTION public.period_notification_status(p_session uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;BEGIN
 IF NOT public.period_can_view(p_session) THEN RAISE EXCEPTION 'session access denied' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('student_id',ro.student_id,'kind',e.kind,'event_id',e.id,'created_at',e.created_at,
 'state',CASE WHEN EXISTS(SELECT 1 FROM public.communication_dispatches d WHERE d.communication_id=r.communication_id AND d.display_acknowledged_at IS NOT NULL) THEN 'device_acknowledged'
 WHEN EXISTS(SELECT 1 FROM public.communication_dispatches d WHERE d.communication_id=r.communication_id AND d.status='provider_accepted') THEN 'provider_accepted'
 WHEN r.state='cancelled' THEN 'cancelled' WHEN c.message_status='suppressed' THEN 'ineligible' WHEN c.message_status='no_registered_device' THEN 'unavailable'
 WHEN c.message_status IN ('failed','dead_letter','unconfirmed') THEN c.message_status ELSE coalesce(r.state,'unavailable') END)),'[]') INTO result
 FROM public.period_session_roster ro JOIN public.period_sessions s ON s.id=ro.session_id
 JOIN public.period_notification_events e ON e.institution_id=s.institution_id AND e.student_id=ro.student_id AND e.attendance_date=s.session_date
 LEFT JOIN public.period_notification_recipients r ON r.event_id=e.id LEFT JOIN public.communications c ON c.id=r.communication_id
 WHERE ro.session_id=p_session AND public.period_section_view(p_session,ro.section_id);
 RETURN result;
END $$;
CREATE FUNCTION public.period_notification_configuration(p_institution uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.period_identity(p_institution) THEN RAISE EXCEPTION 'institution access denied' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('can_configure',public.setup_is_admin(p_institution),'enabled',coalesce((SELECT enabled FROM public.period_notification_settings WHERE institution_id=p_institution),false),'summary_local_time',coalesce((SELECT summary_local_time::text FROM public.period_notification_settings WHERE institution_id=p_institution),'17:00:00'));
END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('set_period_notification_settings','period_absence_facts','period_notification_device_valid','period_notification_log','period_notification_add_recipient','period_notification_cancel','reconcile_period_notifications','period_mark_notification_change','process_period_notifications','period_notification_status','period_notification_configuration') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 IF f.proname IN ('process_period_notifications') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);END IF;
 IF f.proname IN ('set_period_notification_settings','period_notification_status','period_notification_configuration') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);END IF;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
