BEGIN;
CREATE FUNCTION public.period_lock_due(p_session uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.period_sessions;
BEGIN
 SELECT * INTO s FROM public.period_sessions WHERE id=p_session FOR UPDATE;
 IF s.submitted_at IS NOT NULL AND s.status IN ('submitted','grace_period') AND clock_timestamp()>=s.lock_at THEN
  UPDATE public.period_sessions SET status='locked',locked_at=lock_at WHERE id=s.id;
  PERFORM public.period_event(s.institution_id,s.id,NULL,s.rule_id,'session.locked',jsonb_build_object('status',s.status),jsonb_build_object('status','locked','effective_at',s.lock_at),'Automatic lock at the recorded five-minute correction deadline.');
 END IF;
END $$;
CREATE FUNCTION public.period_freeze_roster(p_session uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.period_sessions;
BEGIN
 SELECT * INTO s FROM public.period_sessions WHERE id=p_session;
 IF s.planned ? 'roster_frozen_at' THEN RETURN;END IF;
 IF s.session_date>public.setup_today(s.institution_id) THEN RAISE EXCEPTION 'roster cannot freeze against a future guessed placement' USING ERRCODE='42501';END IF;
 INSERT INTO public.period_session_roster(institution_id,session_id,student_id,section_id,placement_id,name_snapshot,admission_snapshot)
 SELECT s.institution_id,s.id,st.id,p.section_id,p.id,st.name,st.admission_number FROM public.students st JOIN public.student_placements p ON p.student_id=st.id AND p.institution_id=st.institution_id
 JOIN public.period_session_sections ss ON ss.section_id=p.section_id AND ss.session_id=s.id
 WHERE st.institution_id=s.institution_id AND (st.enrollment_status='active' OR s.session_date<public.setup_today(s.institution_id)) AND s.session_date BETWEEN p.starts_on AND p.ends_on;
 IF (SELECT count(*) FROM public.period_session_roster WHERE session_id=s.id)>5000 THEN RAISE EXCEPTION 'session roster exceeds 5000; review configuration' USING ERRCODE='22023';END IF;
 UPDATE public.period_sessions SET planned=planned||jsonb_build_object('roster_frozen_at',clock_timestamp()) WHERE id=s.id;
 PERFORM public.period_event(s.institution_id,s.id,NULL,s.rule_id,'roster.frozen',NULL,jsonb_build_object('count',(SELECT count(*) FROM public.period_session_roster WHERE session_id=s.id),'as_of',s.session_date),'Roster captured from actual recorded student placements as of the session date.');
END $$;
CREATE FUNCTION public.period_has_leave(p_session uuid,p_student uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.period_sessions s JOIN public.student_day_leave l ON l.institution_id=s.institution_id AND l.student_id=p_student AND l.leave_date=s.session_date
 WHERE s.id=p_session AND (s.submitted_at IS NULL OR s.ends_at>=l.applies_from OR EXISTS(SELECT 1 FROM public.period_marks m WHERE m.session_id=s.id AND m.student_id=p_student AND m.status='approved_leave')));
$$;
CREATE FUNCTION public.assign_period_substitute(p_session uuid,p_faculty uuid,p_revision bigint,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.period_sessions;effective uuid;
BEGIN
 SELECT * INTO s FROM public.period_sessions WHERE id=p_session;PERFORM public.lock_staff_lifecycle(s.institution_id);SELECT * INTO s FROM public.period_sessions WHERE id=p_session FOR UPDATE;
 IF NOT public.period_identity(s.institution_id) OR NOT public.period_ci(s.owner_section_id) OR s.revision IS DISTINCT FROM p_revision OR s.submitted_at IS NOT NULL OR s.status='cancelled'
 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000 OR (p_faculty IS NOT NULL AND NOT public.period_faculty_valid(p_faculty,s.institution_id,s.session_date)) THEN RAISE EXCEPTION 'designated schedule-owner CI, current unfinalized session and verified active faculty required' USING ERRCODE='42501';END IF;
 effective:=coalesce(p_faculty,s.scheduled_faculty_id);
 IF p_faculty IS NULL AND EXISTS(SELECT 1 FROM public.period_session_sections ss WHERE ss.session_id=s.id AND NOT public.period_teaches(effective,ss.section_id,s.subject_id,s.session_date)) THEN RAISE EXCEPTION 'original dated teaching assignment no longer valid' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.period_sessions x WHERE x.institution_id=s.institution_id AND x.id<>s.id AND x.status<>'cancelled' AND x.session_date=s.session_date AND x.starts_at<s.ends_at AND s.starts_at<x.ends_at AND coalesce(x.substitute_faculty_id,x.scheduled_faculty_id)=effective) THEN RAISE EXCEPTION 'substitute has a conflicting session' USING ERRCODE='23505';END IF;
 UPDATE public.period_sessions SET substitute_faculty_id=p_faculty,revision=revision+1 WHERE id=s.id;
 DELETE FROM public.period_drafts WHERE session_id=s.id;
 PERFORM public.period_event(s.institution_id,s.id,NULL,s.rule_id,'substitute.assigned',jsonb_build_object('substitute',s.substitute_faculty_id,'scheduled',s.scheduled_faculty_id),jsonb_build_object('substitute',p_faculty,'marking_authority',effective),p_reason);
END $$;
CREATE FUNCTION public.cancel_period_session(p_session uuid,p_revision bigint,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.period_sessions;
BEGIN
 SELECT * INTO s FROM public.period_sessions WHERE id=p_session;PERFORM public.lock_staff_lifecycle(s.institution_id);SELECT * INTO s FROM public.period_sessions WHERE id=p_session FOR UPDATE;
 IF NOT public.period_schedule_authorized(s.institution_id,s.owner_section_id) OR s.revision IS DISTINCT FROM p_revision OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'current schedule owner and explicit cancellation reason required' USING ERRCODE='42501';END IF;
 PERFORM public.cancel_period_session_internal(s.id,p_reason);
END $$;
CREATE FUNCTION public.save_period_draft(p_session uuid,p_revision bigint,p_records jsonb) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.period_sessions;r jsonb;new_revision bigint;
BEGIN
 SELECT * INTO s FROM public.period_sessions WHERE id=p_session;PERFORM public.lock_staff_lifecycle(s.institution_id);SELECT * INTO s FROM public.period_sessions WHERE id=p_session FOR UPDATE;
 IF NOT public.period_can_mark(s.id) OR s.revision IS DISTINCT FROM p_revision OR s.submitted_at IS NOT NULL OR s.status='cancelled' OR jsonb_typeof(p_records) IS DISTINCT FROM 'array' OR jsonb_array_length(p_records)>5000 OR octet_length(p_records::text)>1000000 THEN RAISE EXCEPTION 'current assigned faculty, unsubmitted session and bounded draft required' USING ERRCODE='42501';END IF;
 PERFORM public.period_freeze_roster(s.id);
 IF (SELECT count(*) FROM jsonb_array_elements(p_records))<>(SELECT count(DISTINCT x->>'student_id') FROM jsonb_array_elements(p_records) x) THEN RAISE EXCEPTION 'duplicate draft students' USING ERRCODE='22023';END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(p_records) LOOP
  IF r->>'status' IS NULL OR r->>'status' NOT IN ('present','absent','approved_leave') OR NOT EXISTS(SELECT 1 FROM public.period_session_roster WHERE session_id=s.id AND student_id=(r->>'student_id')::uuid) OR (r->>'status'='approved_leave' AND NOT public.period_has_leave(s.id,(r->>'student_id')::uuid)) THEN RAISE EXCEPTION 'invalid scoped draft mark or forged approved leave' USING ERRCODE='22023';END IF;
 END LOOP;
 INSERT INTO public.period_drafts(institution_id,session_id,faculty_id,records) VALUES(s.institution_id,s.id,coalesce(s.substitute_faculty_id,s.scheduled_faculty_id),p_records)
 ON CONFLICT(session_id) DO UPDATE SET faculty_id=excluded.faculty_id,records=excluded.records,updated_at=clock_timestamp();
 UPDATE public.period_sessions SET revision=revision+1 WHERE id=s.id RETURNING revision INTO new_revision;RETURN new_revision;
END $$;
CREATE FUNCTION public.submit_period_session(p_session uuid,p_revision bigint,p_records jsonb,p_confirmation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.period_sessions;r public.period_session_roster;mark text;total integer;submitted timestamptz;
BEGIN
 SELECT * INTO s FROM public.period_sessions WHERE id=p_session;PERFORM public.lock_staff_lifecycle(s.institution_id);SELECT * INTO s FROM public.period_sessions WHERE id=p_session FOR UPDATE;
 IF NOT public.period_can_mark(s.id) OR s.revision IS DISTINCT FROM p_revision OR s.submitted_at IS NOT NULL OR s.status='cancelled' OR clock_timestamp()<s.starts_at OR s.session_date>public.setup_today(s.institution_id)
 OR jsonb_typeof(p_records) IS DISTINCT FROM 'array' OR jsonb_array_length(p_records)>5000 OR octet_length(p_records::text)>1000000 THEN RAISE EXCEPTION 'current marking authority, started session and latest revision required' USING ERRCODE='42501';END IF;
 PERFORM public.period_freeze_roster(s.id);SELECT count(*) INTO total FROM public.period_session_roster WHERE session_id=s.id;
 IF total=0 OR p_confirmation IS DISTINCT FROM 'SUBMIT '||total::text OR jsonb_array_length(p_records)<>total OR total<>(SELECT count(DISTINCT x->>'student_id') FROM jsonb_array_elements(p_records) x)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_records) x WHERE x->>'status' IS NULL OR x->>'status' NOT IN ('present','absent','approved_leave') OR NOT EXISTS(SELECT 1 FROM public.period_session_roster WHERE session_id=s.id AND student_id=(x->>'student_id')::uuid)) THEN RAISE EXCEPTION 'mark every roster student once and type SUBMIT count; no implicit absences' USING ERRCODE='22023';END IF;
 submitted:=clock_timestamp();
 FOR r IN SELECT * FROM public.period_session_roster WHERE session_id=s.id LOOP
  SELECT x->>'status' INTO mark FROM jsonb_array_elements(p_records) x WHERE x->>'student_id'=r.student_id::text;
  IF public.period_has_leave(s.id,r.student_id) THEN mark:='approved_leave';ELSIF mark='approved_leave' THEN RAISE EXCEPTION 'only a recorded scoped approved leave can exempt a student' USING ERRCODE='42501';END IF;
  INSERT INTO public.period_marks(institution_id,session_id,student_id,status,original_status,recorded_by,recorded_at) VALUES(s.institution_id,s.id,r.student_id,mark,mark,public.current_profile_id(),submitted);
  PERFORM public.period_event(s.institution_id,s.id,r.student_id,s.rule_id,'mark.submitted',NULL,jsonb_build_object('status',mark),'Initial final submission by the exact session marking authority.');
 END LOOP;
 UPDATE public.period_sessions SET status='grace_period',revision=revision+1,submitted_by=public.current_profile_id(),actual_faculty_id=coalesce(substitute_faculty_id,scheduled_faculty_id),submitted_at=submitted,lock_at=submitted+interval '5 minutes' WHERE id=s.id;
 DELETE FROM public.period_drafts WHERE session_id=s.id;
 PERFORM public.period_event(s.institution_id,s.id,NULL,s.rule_id,'session.submitted',jsonb_build_object('status',public.period_effective_state(s)),jsonb_build_object('status','submitted','then','grace_period','submitted_at',submitted,'lock_at',submitted+interval '5 minutes','count',total),'Faculty explicitly finalized every roster mark; five-minute correction window started.');
 RETURN jsonb_build_object('session_id',s.id,'submitted_at',submitted,'lock_at',submitted+interval '5 minutes','count',total);
END $$;
CREATE FUNCTION public.correct_period_mark(p_session uuid,p_student uuid,p_old text,p_new text,p_revision bigint,p_mark_revision bigint,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.period_sessions;m public.period_marks;r public.period_session_roster;within_grace boolean;
BEGIN
 SELECT * INTO s FROM public.period_sessions WHERE id=p_session;PERFORM public.lock_staff_lifecycle(s.institution_id);
 PERFORM public.period_lock_due(s.id);SELECT * INTO s FROM public.period_sessions WHERE id=p_session FOR UPDATE;
 SELECT * INTO r FROM public.period_session_roster WHERE session_id=s.id AND student_id=p_student;
 SELECT * INTO m FROM public.period_marks WHERE session_id=s.id AND student_id=p_student FOR UPDATE;
 within_grace:=clock_timestamp()<s.lock_at;
 IF NOT public.period_identity(s.institution_id) OR m.student_id IS NULL OR s.submitted_at IS NULL OR s.status='cancelled'
 OR s.revision IS DISTINCT FROM p_revision OR m.revision IS DISTINCT FROM p_mark_revision OR m.status IS DISTINCT FROM p_old OR p_new IS NULL OR p_new NOT IN ('present','absent','approved_leave') OR p_new=p_old
 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'current session and original mark version/status, new value and mandatory reason required' USING ERRCODE='42501';END IF;
 IF within_grace THEN
  IF s.submitted_by<>public.current_profile_id() OR NOT public.period_can_mark(s.id) THEN RAISE EXCEPTION 'only the same authorized submitter may correct within five minutes' USING ERRCODE='42501';END IF;
 ELSE IF NOT public.period_ci(r.section_id) THEN RAISE EXCEPTION 'locked correction requires that students own current Class Incharge' USING ERRCODE='42501';END IF;END IF;
 IF (public.period_has_leave(s.id,p_student) AND p_new<>'approved_leave') OR (p_new='approved_leave' AND NOT EXISTS(SELECT 1 FROM public.student_day_leave WHERE institution_id=s.institution_id AND student_id=p_student AND leave_date=s.session_date)) THEN RAISE EXCEPTION 'recorded approved leave cannot become an absence/presence accidentally' USING ERRCODE='42501';END IF;
 UPDATE public.period_marks SET status=p_new,revision=revision+1 WHERE session_id=s.id AND student_id=p_student;
 UPDATE public.period_sessions SET revision=revision+1,status=CASE WHEN within_grace THEN 'grace_period' ELSE 'corrected' END WHERE id=s.id;
 PERFORM public.period_event(s.institution_id,s.id,p_student,s.rule_id,CASE WHEN within_grace THEN 'mark.grace_corrected' ELSE 'mark.ci_corrected' END,jsonb_build_object('status',m.status,'revision',m.revision,'original_status',m.original_status),jsonb_build_object('status',p_new,'revision',m.revision+1),p_reason);
END $$;
CREATE FUNCTION public.approve_student_day_leave(p_student uuid,p_day date,p_reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE tenant uuid;section uuid;id_value uuid;from_time timestamptz;s public.period_sessions;m public.period_marks;
BEGIN
 SELECT institution_id INTO tenant FROM public.students WHERE id=p_student;PERFORM public.lock_staff_lifecycle(tenant);
 SELECT p.section_id INTO section FROM public.student_placements p JOIN public.students st ON st.id=p.student_id WHERE st.id=p_student AND (st.enrollment_status='active' OR p_day<public.setup_today(tenant)) AND p_day BETWEEN p.starts_on AND p.ends_on;
 IF NOT public.period_identity(tenant) OR NOT public.period_ci(section) OR p_day IS NULL OR p_day>public.setup_today(tenant)+366 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'current scoped Class Incharge and actual placed day leave reason required' USING ERRCODE='42501';END IF;
 from_time:=clock_timestamp();
 INSERT INTO public.student_day_leave(institution_id,student_id,section_id,leave_date,applies_from,reason,created_by) VALUES(tenant,p_student,section,p_day,from_time,p_reason,public.current_profile_id()) RETURNING id INTO id_value;
 -- Already-submitted remaining sessions can be amended only by this section's CI.
 FOR s IN SELECT ps.* FROM public.period_sessions ps JOIN public.period_session_roster r ON r.session_id=ps.id WHERE r.student_id=p_student AND r.section_id=section AND ps.session_date=p_day AND ps.status<>'cancelled' AND ps.submitted_at IS NOT NULL AND ps.ends_at>=from_time ORDER BY ps.id LOOP
  PERFORM public.period_lock_due(s.id);SELECT * INTO m FROM public.period_marks WHERE session_id=s.id AND student_id=p_student FOR UPDATE;
  IF m.status<>'approved_leave' THEN
   UPDATE public.period_marks SET status='approved_leave',revision=revision+1 WHERE session_id=s.id AND student_id=p_student;
   UPDATE public.period_sessions SET revision=revision+1,status=CASE WHEN clock_timestamp()>=lock_at THEN 'corrected' ELSE status END WHERE id=s.id;
   PERFORM public.period_event(tenant,s.id,p_student,s.rule_id,'mark.leave_approved',jsonb_build_object('status',m.status,'original_status',m.original_status),jsonb_build_object('status','approved_leave','leave_id',id_value),p_reason);
  END IF;
 END LOOP;
 PERFORM public.period_event(tenant,NULL,p_student,NULL,'day_leave.approved',NULL,jsonb_build_object('id',id_value,'date',p_day,'section',section,'scope','full_day','applies_from',from_time),p_reason);RETURN id_value;
END $$;
CREATE FUNCTION public.period_session_detail(p_session uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.period_sessions;marker boolean;
BEGIN
 SELECT * INTO s FROM public.period_sessions WHERE id=p_session;PERFORM public.lock_staff_lifecycle(s.institution_id);
 IF NOT public.period_can_view(s.id) THEN RAISE EXCEPTION 'session outside current scope' USING ERRCODE='42501';END IF;
 PERFORM public.period_lock_due(s.id);
 marker:=public.period_can_mark(s.id);
 IF s.status<>'cancelled' AND s.submitted_at IS NULL AND s.session_date<=public.setup_today(s.institution_id) THEN PERFORM public.period_freeze_roster(s.id);END IF;
 SELECT * INTO s FROM public.period_sessions WHERE id=p_session;
 RETURN jsonb_build_object('session',to_jsonb(s)||jsonb_build_object('state',public.period_effective_state(s)),'server_time',clock_timestamp(),'can_mark',marker AND s.submitted_at IS NULL AND s.status<>'cancelled' AND s.session_date<=public.setup_today(s.institution_id),
 'can_grace_correct',marker AND s.submitted_by=public.current_profile_id() AND s.submitted_at IS NOT NULL AND clock_timestamp()<s.lock_at,
 'can_schedule',public.period_schedule_authorized(s.institution_id,s.owner_section_id),'can_substitute',public.period_identity(s.institution_id) AND public.period_ci(s.owner_section_id),
 'roster',(SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('mark',m.status,'original_status',m.original_status,'mark_revision',m.revision,'approved_leave',public.period_has_leave(s.id,r.student_id),'can_ci_correct',public.period_ci(r.section_id)) ORDER BY r.name_snapshot,r.student_id),'[]') FROM public.period_session_roster r LEFT JOIN public.period_marks m ON m.session_id=r.session_id AND m.student_id=r.student_id WHERE r.session_id=s.id AND public.period_section_view(s.id,r.section_id)),
 'draft',CASE WHEN marker THEN (SELECT records FROM public.period_drafts WHERE session_id=s.id AND faculty_id=coalesce(s.substitute_faculty_id,s.scheduled_faculty_id)) ELSE NULL END,
 'history',(SELECT coalesce(jsonb_agg(q ORDER BY q.created_at),'[]') FROM (SELECT e.* FROM public.period_attendance_events e WHERE e.session_id=s.id AND (e.student_id IS NULL OR EXISTS(SELECT 1 FROM public.period_session_roster r WHERE r.session_id=s.id AND r.student_id=e.student_id AND public.period_section_view(s.id,r.section_id))) ORDER BY created_at DESC LIMIT 200) q));
END $$;
CREATE FUNCTION public.period_session_directory(p_institution uuid,p_from date,p_until date,p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.period_identity(p_institution) OR p_from IS NULL OR p_until IS NULL OR p_until<p_from OR p_until-p_from>31 OR p_offset<0 THEN RAISE EXCEPTION 'current institution and bounded date range required' USING ERRCODE='42501';END IF;
 RETURN (SELECT coalesce(jsonb_agg(q),'[]') FROM (SELECT s.id,s.session_date,s.starts_at,s.ends_at,s.planned,s.revision,public.period_effective_state(s) state,
 s.owner_section_id,s.scheduled_faculty_id,s.substitute_faculty_id,s.submitted_by,s.submitted_at,s.lock_at,s.cancel_reason,
 (SELECT full_name FROM public.staff_records WHERE id=s.substitute_faculty_id) substitute_name,(SELECT full_name FROM public.staff_records WHERE id=s.actual_faculty_id) actual_submitter,
 public.period_can_mark(s.id) marking_authority FROM public.period_sessions s WHERE s.institution_id=p_institution AND s.session_date BETWEEN p_from AND p_until AND public.period_can_view(s.id) ORDER BY s.starts_at,s.id OFFSET p_offset LIMIT 101) q);
END $$;
CREATE FUNCTION public.period_timetable_catalog(p_institution uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ids uuid[];
BEGIN
 IF NOT public.period_identity(p_institution) THEN RAISE EXCEPTION 'current institution identity required' USING ERRCODE='42501';END IF;
 SELECT coalesce(array_agg(s.id),'{}') INTO ids FROM public.academic_sections s WHERE s.institution_id=p_institution AND (public.setup_is_admin(p_institution) OR public.period_ci(s.id) OR EXISTS(SELECT 1 FROM public.staff_responsibilities r JOIN public.staff_records f ON f.id=r.staff_id WHERE f.profile_id=public.current_profile_id() AND r.section_id=s.id AND r.kind='teaching' AND r.active AND public.period_faculty_valid(f.id,p_institution,public.setup_today(p_institution))));
 RETURN jsonb_build_object('today',public.setup_today(p_institution),'timezone',coalesce((SELECT timezone FROM public.institution_settings WHERE institution_id=p_institution),'Asia/Kolkata'),
 'sections',(SELECT coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('can_schedule',public.period_schedule_authorized(p_institution,s.id),'can_ci',public.period_ci(s.id),'term_name',t.name,'program_name',p.name)),'[]') FROM public.academic_sections s JOIN public.academic_terms t ON t.id=s.term_id JOIN public.academic_programs p ON p.id=s.program_id WHERE s.id=ANY(ids)),
 'subjects',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM public.academic_subjects s WHERE s.institution_id=p_institution AND s.program_id IN (SELECT program_id FROM public.academic_sections WHERE id=ANY(ids))),
 'faculty',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'full_name',f.full_name,'designation',f.designation)),'[]') FROM public.staff_records f WHERE f.institution_id=p_institution AND public.period_faculty_valid(f.id,p_institution,public.setup_today(p_institution)) AND (EXISTS(SELECT 1 FROM unnest(ids) s WHERE public.period_schedule_authorized(p_institution,s)) OR f.profile_id=public.current_profile_id())),
 'rules',(SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('sections',(SELECT jsonb_agg(section_id) FROM public.timetable_rule_sections WHERE rule_id=r.id)) ORDER BY r.created_at),'[]') FROM public.timetable_rules r WHERE r.institution_id=p_institution AND (public.period_schedule_authorized(p_institution,r.owner_section_id) OR r.faculty_id IN (SELECT id FROM public.staff_records WHERE profile_id=public.current_profile_id()))),
 'exceptions',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.on_date),'[]') FROM public.timetable_exceptions e WHERE e.institution_id=p_institution AND (public.setup_is_admin(p_institution) OR public.period_ci(e.section_id))));
END $$;
DO $$ DECLARE f text;BEGIN
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('period_lock_due','period_freeze_roster','period_has_leave','assign_period_substitute','cancel_period_session','save_period_draft','submit_period_session','correct_period_mark','approve_student_day_leave','period_session_detail','period_session_directory','period_timetable_catalog') LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f||' FROM PUBLIC,anon,authenticated';END LOOP;
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('assign_period_substitute','cancel_period_session','save_period_draft','submit_period_session','correct_period_mark','approve_student_day_leave','period_session_detail','period_session_directory','period_timetable_catalog') LOOP EXECUTE 'GRANT EXECUTE ON FUNCTION '||f||' TO authenticated';END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
