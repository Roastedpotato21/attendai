BEGIN;
CREATE FUNCTION public.period_rule_occurs(p public.timetable_rules,p_day date) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT p.active AND p_day BETWEEN p.effective_from AND p.effective_until AND (p.on_date=p_day OR p.weekday=extract(dow FROM p_day)::integer);
$$;
CREATE FUNCTION public.period_day_time(p_institution uuid,p_day date,p_time time) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT (p_day+p_time) AT TIME ZONE coalesce((SELECT timezone FROM public.institution_settings WHERE institution_id=p_institution),'Asia/Kolkata');
$$;
CREATE FUNCTION public.period_schedule_authorized(p_institution uuid,p_owner uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.period_identity(p_institution) AND (public.setup_is_admin(p_institution) OR EXISTS(SELECT 1 FROM public.academic_sections WHERE id=p_owner AND institution_id=p_institution AND public.period_ci(id)));
$$;
CREATE FUNCTION public.cancel_period_session_internal(p_session uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.period_sessions;
BEGIN
 SELECT * INTO s FROM public.period_sessions WHERE id=p_session FOR UPDATE;
 IF s.status='cancelled' THEN RETURN; END IF;
 IF s.submitted_at IS NOT NULL THEN RAISE EXCEPTION 'finalized attendance cannot be cancelled or rescheduled' USING ERRCODE='42501';END IF;
 UPDATE public.period_sessions SET status='cancelled',revision=revision+1,cancelled_at=clock_timestamp(),cancelled_by=public.current_profile_id(),cancel_reason=p_reason WHERE id=s.id;
 DELETE FROM public.period_drafts WHERE session_id=s.id;
 PERFORM public.period_event(s.institution_id,s.id,NULL,s.rule_id,'session.cancelled',jsonb_build_object('status',public.period_effective_state(s)),jsonb_build_object('status','cancelled'),p_reason);
END $$;
CREATE FUNCTION public.create_timetable_rule(p_institution uuid,p_details jsonb,p_sections uuid[],p_reason text,p_replaces uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.timetable_rules;old public.timetable_rules;section public.academic_sections;term public.academic_terms;subject public.academic_subjects;
 owner_id uuid:=(p_details->>'owner_section_id')::uuid;faculty uuid:=(p_details->>'faculty_id')::uuid;first_day date:=(p_details->>'effective_from')::date;last_day date:=(p_details->>'effective_until')::date;
 date_value date:=nullif(p_details->>'on_date','')::date;weekday_value integer:=nullif(p_details->>'weekday','')::integer;slot text;day date;existing uuid;
BEGIN
 PERFORM public.lock_staff_lifecycle(p_institution);
 IF NOT public.period_schedule_authorized(p_institution,owner_id) OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000
 OR p_sections IS NULL OR cardinality(p_sections) NOT BETWEEN 1 AND 20 OR cardinality(p_sections)<>(SELECT count(DISTINCT x) FROM unnest(p_sections) x) OR NOT owner_id=ANY(p_sections)
 OR first_day IS NULL OR last_day IS NULL OR first_day<public.setup_today(p_institution) OR last_day<first_day OR last_day-first_day>366
 OR jsonb_typeof(p_details->'slots') IS DISTINCT FROM 'array' OR jsonb_array_length(p_details->'slots') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'scoped upcoming timetable, bounded sections/slots/dates and reason required' USING ERRCODE='42501';END IF;
 FOR slot IN SELECT jsonb_array_elements_text(p_details->'slots') LOOP IF length(btrim(slot)) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'each institution period label must be 1-40 characters' USING ERRCODE='22023';END IF;END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements_text(p_details->'slots'))<>(SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p_details->'slots') x) THEN RAISE EXCEPTION 'duplicate period labels' USING ERRCODE='22023';END IF;
 SELECT * INTO subject FROM public.academic_subjects WHERE id=(p_details->>'subject_id')::uuid AND institution_id=p_institution;
 IF subject.id IS NULL THEN RAISE EXCEPTION 'subject outside institution' USING ERRCODE='42501';END IF;
 IF p_replaces IS NOT NULL THEN
  SELECT * INTO old FROM public.timetable_rules WHERE id=p_replaces AND institution_id=p_institution;
  IF old.id IS NULL OR date_value IS NULL OR NOT public.period_schedule_authorized(p_institution,old.owner_section_id) OR NOT public.period_rule_occurs(old,date_value)
  OR (SELECT array_agg(section_id ORDER BY section_id) FROM public.timetable_rule_sections WHERE rule_id=old.id) IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(p_sections) x)
  OR EXISTS(SELECT 1 FROM public.period_sessions WHERE rule_id=old.id AND session_date=date_value AND (submitted_at IS NOT NULL OR starts_at<=clock_timestamp())) THEN RAISE EXCEPTION 'override requires same reviewed sections and an upcoming unfinalized original occurrence' USING ERRCODE='42501';END IF;
 END IF;
 FOR section IN SELECT * FROM public.academic_sections WHERE id=ANY(p_sections) AND institution_id=p_institution LOOP
  SELECT * INTO term FROM public.academic_terms WHERE id=section.term_id;
  IF section.program_id<>subject.program_id OR first_day<term.starts_on OR last_day>term.ends_on
   OR NOT (public.setup_is_admin(p_institution) OR public.period_ci(section.id) OR p_replaces IS NOT NULL) THEN RAISE EXCEPTION 'each attached section requires schedule authority, matching subject program and term dates' USING ERRCODE='42501';END IF;
 END LOOP;
 IF (SELECT count(*) FROM public.academic_sections WHERE id=ANY(p_sections) AND institution_id=p_institution)<>cardinality(p_sections) THEN RAISE EXCEPTION 'section outside institution' USING ERRCODE='42501';END IF;
 INSERT INTO public.timetable_rules(institution_id,owner_section_id,subject_id,faculty_id,label,kind,slots,starts_at,ends_at,weekday,on_date,effective_from,effective_until,created_by,reason)
 VALUES(p_institution,owner_id,subject.id,faculty,btrim(p_details->>'label'),p_details->>'kind',p_details->'slots',(p_details->>'starts_at')::time,(p_details->>'ends_at')::time,weekday_value,date_value,first_day,last_day,public.current_profile_id(),p_reason) RETURNING * INTO r;
 FOR day IN SELECT d::date FROM generate_series(first_day::timestamp,last_day::timestamp,'1 day') d LOOP
  IF NOT public.period_rule_occurs(r,day) THEN CONTINUE;END IF;
  IF public.period_day_time(p_institution,day,r.starts_at)<=clock_timestamp() THEN RAISE EXCEPTION 'cannot invent or rewrite past schedule; use an upcoming occurrence' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_sections) AS attached(section_id) WHERE NOT public.period_teaches(r.faculty_id,attached.section_id,r.subject_id,day)) THEN RAISE EXCEPTION 'scheduled faculty needs actual dated subject assignment for every section on % (faculty %, subject %)',day,r.faculty_id,r.subject_id USING ERRCODE='42501';END IF;
  SELECT x.id INTO existing FROM public.timetable_rules x WHERE x.institution_id=p_institution AND x.id<>r.id AND x.id IS DISTINCT FROM p_replaces AND public.period_rule_occurs(x,day)
  AND x.starts_at<r.ends_at AND r.starts_at<x.ends_at
  AND NOT EXISTS(SELECT 1 FROM public.timetable_exceptions e WHERE e.rule_id=x.id AND e.on_date=day)
  AND (x.faculty_id=faculty OR EXISTS(SELECT 1 FROM public.timetable_rule_sections ss WHERE ss.rule_id=x.id AND ss.section_id=ANY(p_sections))) LIMIT 1;
  IF existing IS NOT NULL THEN RAISE EXCEPTION 'overlapping faculty or section timetable; explicitly override/cancel the old occurrence' USING ERRCODE='23505';END IF;
 END LOOP;
 INSERT INTO public.timetable_rule_sections(institution_id,rule_id,section_id) SELECT p_institution,r.id,x FROM unnest(p_sections) x;
 IF p_replaces IS NOT NULL THEN
  INSERT INTO public.timetable_exceptions(institution_id,section_id,on_date,rule_id,kind,replacement_rule_id,reason,created_by) VALUES(p_institution,old.owner_section_id,date_value,old.id,'override',r.id,p_reason,public.current_profile_id());
  FOR existing IN SELECT id FROM public.period_sessions WHERE rule_id=old.id AND session_date=date_value LOOP PERFORM public.cancel_period_session_internal(existing,p_reason);END LOOP;
 END IF;
 PERFORM public.period_event(p_institution,NULL,NULL,r.id,CASE WHEN p_replaces IS NULL THEN 'timetable.created' ELSE 'timetable.overridden' END,to_jsonb(old),to_jsonb(r)||jsonb_build_object('sections',p_sections),p_reason);RETURN r.id;
END $$;
CREATE FUNCTION public.retire_timetable_rule(p_rule uuid,p_revision bigint,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.timetable_rules;sid uuid;
BEGIN
 SELECT * INTO r FROM public.timetable_rules WHERE id=p_rule;PERFORM public.lock_staff_lifecycle(r.institution_id);SELECT * INTO r FROM public.timetable_rules WHERE id=p_rule FOR UPDATE;
 IF NOT public.period_schedule_authorized(r.institution_id,r.owner_section_id) OR NOT r.active OR r.revision IS DISTINCT FROM p_revision OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'current schedule owner and revision/reason required' USING ERRCODE='42501';END IF;
 UPDATE public.timetable_rules SET active=false,revision=revision+1,retired_at=clock_timestamp(),retired_by=public.current_profile_id(),retire_reason=p_reason WHERE id=r.id;
 FOR sid IN SELECT id FROM public.period_sessions WHERE rule_id=r.id AND submitted_at IS NULL AND status<>'cancelled' AND starts_at>clock_timestamp() LOOP PERFORM public.cancel_period_session_internal(sid,p_reason);END LOOP;
 PERFORM public.period_event(r.institution_id,NULL,NULL,r.id,'timetable.retired',to_jsonb(r),jsonb_build_object('active',false),p_reason);
END $$;
CREATE FUNCTION public.add_timetable_exception(p_institution uuid,p_section uuid,p_day date,p_rule uuid,p_reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.timetable_rules;id_value uuid;sid uuid;
BEGIN
 PERFORM public.lock_staff_lifecycle(p_institution);
 IF NOT public.period_schedule_authorized(p_institution,p_section) OR p_day IS NULL OR p_day<public.setup_today(p_institution) OR p_day>public.setup_today(p_institution)+366 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'upcoming scoped date and specific cancellation/holiday reason required' USING ERRCODE='42501';END IF;
 IF p_rule IS NOT NULL THEN
  SELECT * INTO r FROM public.timetable_rules WHERE id=p_rule AND institution_id=p_institution AND owner_section_id=p_section;
  IF r.id IS NULL OR NOT public.period_rule_occurs(r,p_day) OR public.period_day_time(p_institution,p_day,r.starts_at)<=clock_timestamp() THEN RAISE EXCEPTION 'only schedule owner may cancel an upcoming occurrence' USING ERRCODE='42501';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.timetable_rule_sections rs JOIN public.timetable_rules tr ON tr.id=rs.rule_id WHERE rs.section_id=p_section AND public.period_rule_occurs(tr,p_day) AND tr.owner_section_id<>p_section) THEN RAISE EXCEPTION 'merged session holiday needs its designated schedule owner; cancel that occurrence explicitly' USING ERRCODE='42501';END IF;
  IF p_day=public.setup_today(p_institution) THEN RAISE EXCEPTION 'full-day holiday must be recorded before that day; cancel individual upcoming sessions today' USING ERRCODE='42501';END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.period_sessions s JOIN public.period_session_sections ss ON ss.session_id=s.id WHERE ss.section_id=p_section AND s.session_date=p_day AND (p_rule IS NULL OR s.rule_id=p_rule) AND s.status<>'cancelled' AND (s.submitted_at IS NOT NULL OR s.starts_at<=clock_timestamp())) THEN RAISE EXCEPTION 'past/finalized schedule is immutable' USING ERRCODE='42501';END IF;
 INSERT INTO public.timetable_exceptions(institution_id,section_id,on_date,rule_id,kind,reason,created_by) VALUES(p_institution,p_section,p_day,p_rule,CASE WHEN p_rule IS NULL THEN 'holiday' ELSE 'cancelled' END,p_reason,public.current_profile_id()) RETURNING id INTO id_value;
 FOR sid IN SELECT s.id FROM public.period_sessions s JOIN public.period_session_sections ss ON ss.session_id=s.id WHERE ss.section_id=p_section AND s.session_date=p_day AND (p_rule IS NULL OR s.rule_id=p_rule) LOOP PERFORM public.cancel_period_session_internal(sid,p_reason);END LOOP;
 PERFORM public.period_event(p_institution,NULL,NULL,p_rule,CASE WHEN p_rule IS NULL THEN 'holiday.recorded' ELSE 'occurrence.cancelled' END,NULL,jsonb_build_object('id',id_value,'date',p_day,'section',p_section),p_reason);RETURN id_value;
END $$;
CREATE FUNCTION public.materialize_period_sessions(p_institution uuid,p_from date,p_until date,p_reason text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.timetable_rules;day date;sid uuid;count_value integer:=0;cancel_note text;planned jsonb;
BEGIN
 PERFORM public.lock_staff_lifecycle(p_institution);
 IF NOT public.period_identity(p_institution) OR p_from IS NULL OR p_until IS NULL OR p_from<public.setup_today(p_institution) OR p_until<p_from OR p_until-p_from>31 OR p_until>public.setup_today(p_institution)+366 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'current identity and bounded upcoming date range/reason required' USING ERRCODE='42501';END IF;
 FOR day IN SELECT d::date FROM generate_series(p_from::timestamp,p_until::timestamp,'1 day') d LOOP
  FOR r IN SELECT * FROM public.timetable_rules tr WHERE tr.institution_id=p_institution AND public.period_rule_occurs(tr,day) AND (public.period_schedule_authorized(p_institution,tr.owner_section_id) OR EXISTS(SELECT 1 FROM public.staff_records f WHERE f.id=tr.faculty_id AND f.profile_id=public.current_profile_id() AND public.period_faculty_valid(f.id,p_institution,day))) ORDER BY tr.starts_at LOOP
   IF EXISTS(SELECT 1 FROM public.period_sessions WHERE rule_id=r.id AND session_date=day) THEN CONTINUE;END IF;
   IF count_value>=1000 THEN RAISE EXCEPTION 'generate at most 1000 sessions; use a smaller range' USING ERRCODE='22023';END IF;
   SELECT e.reason INTO cancel_note FROM public.timetable_exceptions e WHERE e.institution_id=p_institution AND e.on_date=day AND (e.rule_id=r.id OR (e.kind='holiday' AND e.section_id IN (SELECT section_id FROM public.timetable_rule_sections WHERE rule_id=r.id))) ORDER BY e.created_at LIMIT 1;
   IF cancel_note IS NULL AND EXISTS(SELECT 1 FROM public.timetable_rule_sections rs WHERE rs.rule_id=r.id AND NOT public.period_teaches(r.faculty_id,rs.section_id,r.subject_id,day)) THEN RAISE EXCEPTION 'scheduled faculty assignment changed; review timetable or explicit substitute' USING ERRCODE='42501';END IF;
   SELECT to_jsonb(r)||jsonb_build_object('timezone',coalesce((SELECT timezone FROM public.institution_settings WHERE institution_id=p_institution),'Asia/Kolkata'),
   'subject_name',(SELECT name FROM public.academic_subjects WHERE id=r.subject_id),'faculty_name',(SELECT full_name FROM public.staff_records WHERE id=r.faculty_id),
   'sections',(SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'program_id',s.program_id,'term_id',s.term_id,'program_name',p.name,'term_name',t.name)) FROM public.timetable_rule_sections rs JOIN public.academic_sections s ON s.id=rs.section_id JOIN public.academic_programs p ON p.id=s.program_id JOIN public.academic_terms t ON t.id=s.term_id WHERE rs.rule_id=r.id)) INTO planned;
   IF cancel_note IS NULL AND EXISTS(SELECT 1 FROM public.period_sessions s WHERE s.institution_id=p_institution AND s.session_date=day AND s.status<>'cancelled' AND s.starts_at<public.period_day_time(p_institution,day,r.ends_at) AND public.period_day_time(p_institution,day,r.starts_at)<s.ends_at AND
    (coalesce(s.substitute_faculty_id,s.scheduled_faculty_id)=r.faculty_id OR EXISTS(SELECT 1 FROM public.period_session_sections ss JOIN public.timetable_rule_sections rs ON rs.section_id=ss.section_id WHERE ss.session_id=s.id AND rs.rule_id=r.id))) THEN RAISE EXCEPTION 'generated session conflicts with preserved schedule; explicitly resolve' USING ERRCODE='23505';END IF;
   INSERT INTO public.period_sessions(institution_id,rule_id,session_date,owner_section_id,subject_id,scheduled_faculty_id,starts_at,ends_at,planned,created_by)
   VALUES(p_institution,r.id,day,r.owner_section_id,r.subject_id,r.faculty_id,public.period_day_time(p_institution,day,r.starts_at),public.period_day_time(p_institution,day,r.ends_at),planned,public.current_profile_id()) RETURNING id INTO sid;
   INSERT INTO public.period_session_sections(institution_id,session_id,section_id) SELECT p_institution,sid,section_id FROM public.timetable_rule_sections WHERE rule_id=r.id;
   PERFORM public.period_event(p_institution,sid,NULL,r.id,'session.scheduled',NULL,planned,p_reason);
   IF cancel_note IS NOT NULL THEN PERFORM public.cancel_period_session_internal(sid,cancel_note);END IF;
   count_value:=count_value+1;
  END LOOP;
 END LOOP;RETURN count_value;
END $$;
DO $$ DECLARE f text;BEGIN
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('period_rule_occurs','period_day_time','period_schedule_authorized','cancel_period_session_internal','create_timetable_rule','retire_timetable_rule','add_timetable_exception','materialize_period_sessions') LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f||' FROM PUBLIC,anon,authenticated';END LOOP;
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('create_timetable_rule','retire_timetable_rule','add_timetable_exception','materialize_period_sessions') LOOP EXECUTE 'GRANT EXECUTE ON FUNCTION '||f||' TO authenticated';END LOOP;
END $$;
COMMIT;
