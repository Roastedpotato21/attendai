BEGIN;
CREATE FUNCTION public.create_student_cohort(p_institution uuid,p_details jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid; result uuid;
BEGIN
 actor:=public.student_academic_actor(p_institution,NULL,true);PERFORM public.lock_staff_lifecycle(p_institution);
 INSERT INTO public.student_cohorts(institution_id,program_id,name,code,starts_on,expected_ends_on,description,created_by)
 VALUES(p_institution,(p_details->>'program_id')::uuid,btrim(p_details->>'name'),btrim(p_details->>'code'),(p_details->>'starts_on')::date,(p_details->>'expected_ends_on')::date,coalesce(p_details->>'description',''),actor) RETURNING id INTO result;
 PERFORM public.student_academic_event(p_institution,NULL,NULL,'cohort.created',NULL,p_details||jsonb_build_object('id',result),p_reason);RETURN result;
END $$;
CREATE FUNCTION public.apply_student_placement(p_student uuid,p_target jsonb,p_expected_version bigint,p_reason text,p_batch uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.students; old public.student_placements; target public.academic_sections; term public.academic_terms; cohort public.student_cohorts;
 actor uuid; result uuid; from_day date; kind text;
BEGIN
 SELECT * INTO s FROM public.students WHERE id=p_student;
 PERFORM public.lock_staff_lifecycle(s.institution_id);
 SELECT * INTO s FROM public.students WHERE id=p_student FOR UPDATE;
 SELECT * INTO target FROM public.academic_sections WHERE id=(p_target->>'section_id')::uuid AND institution_id=s.institution_id;
 actor:=public.student_academic_actor(s.institution_id,target.id);
 SELECT * INTO old FROM public.student_placements WHERE student_id=s.id AND closed_at IS NULL FOR UPDATE;
 IF old.id IS NOT NULL THEN PERFORM public.student_academic_actor(s.institution_id,old.section_id); END IF;
 SELECT * INTO term FROM public.academic_terms WHERE id=target.term_id AND institution_id=s.institution_id;
 SELECT * INTO cohort FROM public.student_cohorts WHERE id=(p_target->>'cohort_id')::uuid AND institution_id=s.institution_id;
 from_day:=(p_target->>'starts_on')::date;kind:=p_target->>'change_type';
 IF s.id IS NULL OR NOT s.academic_managed OR s.enrollment_status<>'active' OR s.academic_version IS DISTINCT FROM p_expected_version
 OR target.id IS NULL OR cohort.program_id IS DISTINCT FROM target.program_id OR from_day IS NULL OR from_day<term.starts_on OR from_day>term.ends_on
 OR from_day<s.admitted_on OR (old.id IS NOT NULL AND from_day<=old.starts_on)
 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000 THEN
  RAISE EXCEPTION 'student/placement changed or target/date/reason invalid; refresh preview' USING ERRCODE='42501'; END IF;
 IF s.legacy_roster_linked AND from_day>public.setup_today(s.institution_id) THEN
  RAISE EXCEPTION 'apply legacy attendance-linked placement on its effective date; future scheduling would leave a stale class projection' USING ERRCODE='42501'; END IF;
 IF old.id IS NOT NULL THEN
  IF old.department_id IS DISTINCT FROM (SELECT department_id FROM public.academic_programs WHERE id=target.program_id) THEN kind:='department_transfer';
  ELSIF old.program_id<>target.program_id THEN kind:='program_transfer';
  ELSIF old.term_id=target.term_id AND old.section_id<>target.id AND kind NOT IN ('repeat','correction') THEN kind:='section_transfer';END IF;
  UPDATE public.student_placements SET ends_on=least(ends_on,from_day-1),closed_at=now(),closed_by=actor,close_reason=p_reason WHERE id=old.id;
 END IF;
 INSERT INTO public.student_placements(institution_id,student_id,cohort_id,department_id,program_id,term_id,section_id,starts_on,ends_on,change_type,reason,created_by)
 VALUES(s.institution_id,s.id,cohort.id,(SELECT department_id FROM public.academic_programs WHERE id=target.program_id),target.program_id,term.id,target.id,from_day,term.ends_on,kind,p_reason,actor) RETURNING id INTO result;
 UPDATE public.students SET academic_version=academic_version+1,updated_at=now(),class_id=CASE WHEN legacy_roster_linked THEN target.class_id ELSE class_id END WHERE id=s.id;
 PERFORM public.student_academic_event(s.institution_id,s.id,p_batch,kind,to_jsonb(old),jsonb_build_object('id',result,'section_id',target.id,'cohort_id',cohort.id,'starts_on',from_day,'term_id',term.id),p_reason);
 RETURN result;
END $$;
CREATE FUNCTION public.student_placement_transition(p_student uuid,p_target jsonb,p_expected_version bigint,p_reason text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.apply_student_placement(p_student,p_target,p_expected_version,p_reason,NULL);
$$;
REVOKE ALL ON FUNCTION public.apply_student_placement(uuid,jsonb,bigint,text,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.change_student_academic_status(p_student uuid,p_status text,p_expected_version bigint,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.students; old public.student_placements; actor uuid; day date; previous_placements jsonb;
BEGIN
 SELECT * INTO s FROM public.students WHERE id=p_student;PERFORM public.lock_staff_lifecycle(s.institution_id);
 SELECT * INTO s FROM public.students WHERE id=p_student FOR UPDATE;
 SELECT * INTO old FROM public.student_placements WHERE student_id=s.id AND public.setup_today(s.institution_id) BETWEEN starts_on AND ends_on ORDER BY starts_on DESC LIMIT 1;
 actor:=public.student_academic_actor(s.institution_id,old.section_id);day:=public.setup_today(s.institution_id);
 SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') INTO previous_placements FROM public.student_placements p WHERE student_id=s.id;
 IF p_status IS NULL OR p_status NOT IN ('active','inactive','graduated','transferred_out','discontinued','suspended')
 OR p_status=s.enrollment_status OR s.academic_version IS DISTINCT FROM p_expected_version OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000 THEN
  RAISE EXCEPTION 'explicit valid status, current version and specific reason required' USING ERRCODE='22023'; END IF;
 IF p_status<>'active' THEN
  IF EXISTS(SELECT 1 FROM public.student_placements WHERE student_id=s.id AND ends_on>=starts_on AND (closed_at IS NULL OR ends_on>=day)
   AND NOT public.student_scope_allowed(s.institution_id,section_id,true)) THEN RAISE EXCEPTION 'scheduled placement outside authorized status-change scope' USING ERRCODE='42501'; END IF;
  -- Future scheduled rows become empty ranges; recorded past periods survive.
  UPDATE public.student_placements SET ends_on=greatest(starts_on-1,least(ends_on,day-1)),closed_at=coalesce(closed_at,now()),closed_by=actor,close_reason=p_reason
   WHERE student_id=s.id AND ends_on>=starts_on AND (closed_at IS NULL OR ends_on>=day);
 END IF;
 UPDATE public.students SET enrollment_status=p_status,academic_version=academic_version+1,updated_at=now(),class_id=CASE WHEN p_status='active' AND legacy_roster_linked THEN NULL ELSE class_id END WHERE id=s.id;
 PERFORM public.student_academic_event(s.institution_id,s.id,NULL,'status.changed',jsonb_build_object('status',s.enrollment_status,'placements',previous_placements),jsonb_build_object('status',p_status,'placements',(SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM public.student_placements p WHERE student_id=s.id)),p_reason);
END $$;
CREATE FUNCTION public.update_student_academic_profile(p_student uuid,p_details jsonb,p_expected_version bigint,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.students; actor uuid;
BEGIN
 SELECT * INTO s FROM public.students WHERE id=p_student;PERFORM public.lock_staff_lifecycle(s.institution_id);
 SELECT * INTO s FROM public.students WHERE id=p_student FOR UPDATE;
 actor:=public.student_academic_actor(s.institution_id,NULL,true);
 IF s.academic_version IS DISTINCT FROM p_expected_version OR length(btrim(coalesce(p_details->>'full_name',''))) NOT BETWEEN 2 AND 120
 OR public.student_identifier(p_details->>'admission_number') IS NULL OR length(coalesce(p_details->>'admission_number',''))>80 OR length(coalesce(p_details->>'roll_number',''))>80
 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'valid identity, current version and specific correction reason required' USING ERRCODE='22023'; END IF;
 UPDATE public.students SET name=btrim(p_details->>'full_name'),admission_number=btrim(p_details->>'admission_number'),roll=nullif(btrim(p_details->>'roll_number'),''),academic_version=academic_version+1,updated_at=now() WHERE id=s.id;
 PERFORM public.student_academic_event(s.institution_id,s.id,NULL,'profile.corrected',jsonb_build_object('full_name',s.name,'admission_number',s.admission_number,'roll_number',s.roll),p_details,p_reason);
END $$;
CREATE FUNCTION public.student_academic_catalog(p_institution uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE allowed_sections uuid[]; allowed_programs uuid[]; allowed_departments uuid[];
BEGIN
 IF NOT public.is_institution_member(p_institution) OR NOT public.has_current_policy_acceptance(auth.uid()) THEN RAISE EXCEPTION 'active institution identity and policies required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(array_agg(id),'{}') INTO allowed_sections FROM public.academic_sections WHERE institution_id=p_institution AND public.student_scope_allowed(p_institution,id);
 SELECT coalesce(array_agg(DISTINCT program_id),'{}') INTO allowed_programs FROM public.academic_sections WHERE id=ANY(allowed_sections);
 SELECT coalesce(array_agg(DISTINCT department_id),'{}') INTO allowed_departments FROM public.academic_programs WHERE id=ANY(allowed_programs);
 RETURN jsonb_build_object('can_import',public.setup_is_admin(p_institution),'can_manage',public.setup_is_admin(p_institution) OR EXISTS(SELECT 1 FROM public.academic_sections WHERE id=ANY(allowed_sections) AND public.student_scope_allowed(p_institution,id,true)),
 'departments',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY name),'[]') FROM public.academic_departments d WHERE institution_id=p_institution AND (public.setup_is_admin(p_institution) OR id=ANY(allowed_departments))),
 'programs',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY name),'[]') FROM public.academic_programs p WHERE institution_id=p_institution AND (public.setup_is_admin(p_institution) OR id=ANY(allowed_programs))),
 'terms',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY starts_on,name),'[]') FROM public.academic_terms t WHERE institution_id=p_institution AND (public.setup_is_admin(p_institution) OR program_id=ANY(allowed_programs))),
 'sections',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY name),'[]') FROM public.academic_sections s WHERE institution_id=p_institution AND (public.setup_is_admin(p_institution) OR id=ANY(allowed_sections))),
 'cohorts',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY starts_on,name),'[]') FROM public.student_cohorts c WHERE institution_id=p_institution AND (public.setup_is_admin(p_institution) OR program_id=ANY(allowed_programs))));
END $$;
CREATE FUNCTION public.student_academic_directory(p_institution uuid,p_query text DEFAULT '',p_cohort uuid DEFAULT NULL,p_offset integer DEFAULT 0,p_term uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.is_institution_member(p_institution) OR NOT public.has_current_policy_acceptance(auth.uid()) OR p_offset<0 OR length(p_query)>120 THEN RAISE EXCEPTION 'student directory unavailable' USING ERRCODE='42501'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') FROM (
 SELECT s.id,s.institution_id,s.name,s.admission_number,s.roll,s.enrollment_status,s.admitted_on,s.entry_type,s.academic_managed,s.academic_version,
 p.id placement_id,p.cohort_id,p.program_id,p.term_id,p.section_id,t.name term_name,t.year_number,t.term_kind,c.name cohort_name,a.name section_name,g.name program_name,d.name department_name
 FROM public.students s LEFT JOIN public.student_placements p ON p.student_id=s.id AND public.setup_today(p_institution) BETWEEN p.starts_on AND p.ends_on
 LEFT JOIN public.academic_terms t ON t.id=p.term_id LEFT JOIN public.student_cohorts c ON c.id=p.cohort_id
 LEFT JOIN public.academic_sections a ON a.id=p.section_id LEFT JOIN public.academic_programs g ON g.id=p.program_id LEFT JOIN public.academic_departments d ON d.id=p.department_id
 WHERE s.institution_id=p_institution AND public.can_read_academic_student(s.id)
 AND (p_cohort IS NULL OR p.cohort_id=p_cohort)
 AND (p_term IS NULL OR p.term_id=p_term)
 AND (p_query='' OR strpos(public.student_identifier(s.name),public.student_identifier(p_query))>0 OR strpos(public.student_identifier(s.admission_number),public.student_identifier(p_query))>0 OR strpos(public.student_identifier(s.roll),public.student_identifier(p_query))>0)
 ORDER BY s.name,s.id OFFSET p_offset LIMIT 101) q);
END $$;
CREATE FUNCTION public.student_academic_profile(p_student uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.students; history jsonb;
BEGIN
 IF NOT public.can_read_academic_student(p_student) THEN RAISE EXCEPTION 'student profile unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.students WHERE id=p_student;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.starts_on,q.id),'[]') INTO history FROM (
 SELECT p.*,d.name department_name,g.name program_name,t.name term_name,t.year_number,t.term_kind,a.name section_name,c.name cohort_name
 FROM public.student_placements p JOIN public.academic_departments d ON d.id=p.department_id JOIN public.academic_programs g ON g.id=p.program_id
 JOIN public.academic_terms t ON t.id=p.term_id JOIN public.academic_sections a ON a.id=p.section_id JOIN public.student_cohorts c ON c.id=p.cohort_id WHERE p.student_id=s.id) q;
 RETURN jsonb_build_object('student',jsonb_build_object('id',s.id,'institution_id',s.institution_id,'name',s.name,'admission_number',s.admission_number,'roll',s.roll,'enrollment_status',s.enrollment_status,'admitted_on',s.admitted_on,'entry_type',s.entry_type,'entry_term_id',s.entry_term_id,'entry_cohort_id',s.entry_cohort_id,'academic_managed',s.academic_managed,'academic_version',s.academic_version),
 'entry_term',(SELECT jsonb_build_object('name',name,'year_number',year_number) FROM public.academic_terms WHERE id=s.entry_term_id),
 'entry_cohort',(SELECT jsonb_build_object('name',name) FROM public.student_cohorts WHERE id=s.entry_cohort_id),
 'history',history,'current',(SELECT x FROM jsonb_array_elements(history) x WHERE public.setup_today(s.institution_id) BETWEEN (x->>'starts_on')::date AND (x->>'ends_on')::date),
 'can_edit',public.setup_is_admin(s.institution_id),'can_move',public.setup_is_admin(s.institution_id) OR EXISTS(SELECT 1 FROM public.student_placements WHERE student_id=s.id AND public.setup_today(s.institution_id) BETWEEN starts_on AND ends_on AND public.student_scope_allowed(s.institution_id,section_id,true)));
END $$;
DO $$ DECLARE f text;
BEGIN
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('create_student_cohort','student_placement_transition','change_student_academic_status','update_student_academic_profile','student_academic_catalog','student_academic_directory','student_academic_profile') LOOP
 EXECUTE 'REVOKE ALL ON FUNCTION '||f||' FROM PUBLIC,anon';EXECUTE 'GRANT EXECUTE ON FUNCTION '||f||' TO authenticated';END LOOP;
END $$;
COMMIT;
