-- Period attendance has no trigger into legacy attendance alerts/outbox.
BEGIN;
CREATE TABLE public.timetable_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES public.institutions(id),
 owner_section_id uuid NOT NULL, subject_id uuid NOT NULL, faculty_id uuid NOT NULL,
 label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 100), kind text NOT NULL CHECK(kind IN ('normal','lab','combined','extra')),
 slots jsonb NOT NULL CHECK(jsonb_typeof(slots)='array' AND jsonb_array_length(slots) BETWEEN 1 AND 30),
 starts_at time NOT NULL, ends_at time NOT NULL CHECK(ends_at>starts_at),
 weekday integer CHECK(weekday BETWEEN 0 AND 6), on_date date,
 effective_from date NOT NULL, effective_until date NOT NULL CHECK(effective_until>=effective_from),
 active boolean NOT NULL DEFAULT true, revision bigint NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 retired_at timestamptz,retired_by uuid REFERENCES public.profiles(id),retire_reason text,
 CHECK((weekday IS NOT NULL AND on_date IS NULL) OR (weekday IS NULL AND on_date IS NOT NULL AND effective_from=on_date AND effective_until=on_date)),
 UNIQUE(institution_id,id), FOREIGN KEY(institution_id,owner_section_id) REFERENCES public.academic_sections(institution_id,id),
 FOREIGN KEY(institution_id,subject_id) REFERENCES public.academic_subjects(institution_id,id),FOREIGN KEY(institution_id,faculty_id) REFERENCES public.staff_records(institution_id,id)
);
CREATE TABLE public.timetable_rule_sections (
 institution_id uuid NOT NULL,rule_id uuid NOT NULL,section_id uuid NOT NULL,
 PRIMARY KEY(rule_id,section_id), FOREIGN KEY(institution_id,rule_id) REFERENCES public.timetable_rules(institution_id,id),FOREIGN KEY(institution_id,section_id) REFERENCES public.academic_sections(institution_id,id)
);
CREATE TABLE public.timetable_exceptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),institution_id uuid NOT NULL REFERENCES public.institutions(id),section_id uuid NOT NULL,on_date date NOT NULL,
 rule_id uuid,kind text NOT NULL CHECK(kind IN ('holiday','cancelled','override')),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 replacement_rule_id uuid,created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(institution_id,section_id) REFERENCES public.academic_sections(institution_id,id),FOREIGN KEY(institution_id,rule_id) REFERENCES public.timetable_rules(institution_id,id),
 FOREIGN KEY(institution_id,replacement_rule_id) REFERENCES public.timetable_rules(institution_id,id),
 CHECK((kind='holiday' AND rule_id IS NULL AND replacement_rule_id IS NULL) OR (kind='cancelled' AND rule_id IS NOT NULL AND replacement_rule_id IS NULL) OR (kind='override' AND rule_id IS NOT NULL AND replacement_rule_id IS NOT NULL))
);
CREATE UNIQUE INDEX timetable_holiday_once ON public.timetable_exceptions(section_id,on_date) WHERE kind='holiday';
CREATE UNIQUE INDEX timetable_override_once ON public.timetable_exceptions(rule_id,on_date) WHERE rule_id IS NOT NULL;
CREATE TABLE public.period_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),institution_id uuid NOT NULL REFERENCES public.institutions(id),rule_id uuid NOT NULL,session_date date NOT NULL,
 owner_section_id uuid NOT NULL,subject_id uuid NOT NULL,scheduled_faculty_id uuid NOT NULL,substitute_faculty_id uuid,
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),planned jsonb NOT NULL,
 status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','pending','submitted','grace_period','locked','corrected','cancelled')),
 revision bigint NOT NULL DEFAULT 1,submitted_by uuid REFERENCES public.profiles(id),actual_faculty_id uuid,
 submitted_at timestamptz,lock_at timestamptz,locked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),created_by uuid NOT NULL REFERENCES public.profiles(id),
 cancelled_at timestamptz,cancelled_by uuid REFERENCES public.profiles(id),cancel_reason text,
 UNIQUE(institution_id,id),UNIQUE(rule_id,session_date),
 FOREIGN KEY(institution_id,rule_id) REFERENCES public.timetable_rules(institution_id,id),FOREIGN KEY(institution_id,owner_section_id) REFERENCES public.academic_sections(institution_id,id),
 FOREIGN KEY(institution_id,subject_id) REFERENCES public.academic_subjects(institution_id,id),FOREIGN KEY(institution_id,scheduled_faculty_id) REFERENCES public.staff_records(institution_id,id),
 FOREIGN KEY(institution_id,substitute_faculty_id) REFERENCES public.staff_records(institution_id,id),FOREIGN KEY(institution_id,actual_faculty_id) REFERENCES public.staff_records(institution_id,id)
);
CREATE TABLE public.period_session_sections (
 institution_id uuid NOT NULL,session_id uuid NOT NULL,section_id uuid NOT NULL,
 PRIMARY KEY(session_id,section_id),FOREIGN KEY(institution_id,session_id) REFERENCES public.period_sessions(institution_id,id),FOREIGN KEY(institution_id,section_id) REFERENCES public.academic_sections(institution_id,id)
);
CREATE TABLE public.period_session_roster (
 institution_id uuid NOT NULL,session_id uuid NOT NULL,student_id uuid NOT NULL,section_id uuid NOT NULL,placement_id uuid NOT NULL,
 name_snapshot text NOT NULL,admission_snapshot text,PRIMARY KEY(session_id,student_id),
 FOREIGN KEY(institution_id,session_id) REFERENCES public.period_sessions(institution_id,id),FOREIGN KEY(institution_id,student_id) REFERENCES public.students(institution_id,id),
 FOREIGN KEY(institution_id,section_id) REFERENCES public.academic_sections(institution_id,id),FOREIGN KEY(institution_id,placement_id) REFERENCES public.student_placements(institution_id,id)
);
CREATE TABLE public.period_marks (
 institution_id uuid NOT NULL,session_id uuid NOT NULL,student_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('present','absent','approved_leave')),original_status text NOT NULL CHECK(original_status IN ('present','absent','approved_leave')),
 revision bigint NOT NULL DEFAULT 1,recorded_by uuid NOT NULL REFERENCES public.profiles(id),recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(session_id,student_id),FOREIGN KEY(session_id,student_id) REFERENCES public.period_session_roster(session_id,student_id),FOREIGN KEY(institution_id,session_id) REFERENCES public.period_sessions(institution_id,id)
);
CREATE TABLE public.period_drafts (
 institution_id uuid NOT NULL,session_id uuid PRIMARY KEY,faculty_id uuid NOT NULL,records jsonb NOT NULL CHECK(jsonb_typeof(records)='array' AND jsonb_array_length(records)<=5000),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(institution_id,session_id) REFERENCES public.period_sessions(institution_id,id),FOREIGN KEY(institution_id,faculty_id) REFERENCES public.staff_records(institution_id,id)
);
CREATE TABLE public.student_day_leave (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),institution_id uuid NOT NULL,student_id uuid NOT NULL,section_id uuid NOT NULL,leave_date date NOT NULL,
 scope text NOT NULL DEFAULT 'full_day' CHECK(scope='full_day'),applies_from timestamptz NOT NULL DEFAULT now(),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(institution_id,student_id,leave_date),FOREIGN KEY(institution_id,student_id) REFERENCES public.students(institution_id,id),FOREIGN KEY(institution_id,section_id) REFERENCES public.academic_sections(institution_id,id)
);
CREATE TABLE public.period_attendance_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),institution_id uuid NOT NULL REFERENCES public.institutions(id),session_id uuid,student_id uuid,rule_id uuid,
 actor_profile_id uuid NOT NULL REFERENCES public.profiles(id),action text NOT NULL,previous jsonb,current jsonb,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(institution_id,session_id) REFERENCES public.period_sessions(institution_id,id),FOREIGN KEY(institution_id,student_id) REFERENCES public.students(institution_id,id),FOREIGN KEY(institution_id,rule_id) REFERENCES public.timetable_rules(institution_id,id)
);
CREATE INDEX period_sessions_day ON public.period_sessions(institution_id,session_date,starts_at);
CREATE INDEX period_audit_session ON public.period_attendance_events(institution_id,session_id,created_at);
CREATE FUNCTION public.period_identity(p_institution uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.is_institution_member(p_institution) AND public.has_current_policy_acceptance(auth.uid()) AND EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL);
$$;
CREATE FUNCTION public.period_ci(p_section uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.staff_responsibilities r WHERE r.section_id=p_section AND r.kind='class_incharge' AND r.active
 AND public.period_identity(r.institution_id) AND public.setup_today(r.institution_id) BETWEEN r.effective_from AND least(r.effective_until,coalesce(r.ended_on,r.effective_until))
 AND public.staff_has_role(r.staff_id,'class_incharge',public.setup_today(r.institution_id)));
$$;
CREATE FUNCTION public.period_faculty_valid(p_staff uuid,p_institution uuid,p_on date) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.staff_records s JOIN public.profiles p ON p.id=s.profile_id JOIN auth.users u ON u.id=p.auth_user_id
 JOIN public.profile_institutions m ON m.profile_id=p.id AND m.institution_id=s.institution_id JOIN public.institutions i ON i.id=s.institution_id
 WHERE s.id=p_staff AND s.institution_id=p_institution AND s.status='active' AND p.status='active' AND i.status='active' AND m.status='active' AND u.email_confirmed_at IS NOT NULL
 AND public.lifecycle_current_policies(u.id) AND EXISTS(SELECT 1 FROM public.staff_role_grants g WHERE g.staff_id=s.id AND g.role='faculty' AND g.active
 AND p_on BETWEEN g.valid_from AND least(coalesce(g.valid_until,'infinity'),coalesce(g.ended_on,'infinity'))
 AND public.setup_today(p_institution) BETWEEN g.valid_from AND least(coalesce(g.valid_until,'infinity'),coalesce(g.ended_on,'infinity'))));
$$;
CREATE FUNCTION public.period_teaches(p_staff uuid,p_section uuid,p_subject uuid,p_on date) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.staff_responsibilities r JOIN public.academic_sections s ON s.id=r.section_id AND s.institution_id=r.institution_id AND s.term_id=r.term_id
 WHERE r.staff_id=p_staff AND r.kind='teaching' AND r.section_id=p_section AND r.subject_id=p_subject AND r.active
 AND p_on BETWEEN r.effective_from AND least(r.effective_until,coalesce(r.ended_on,r.effective_until)) AND public.period_faculty_valid(p_staff,r.institution_id,p_on));
$$;
CREATE FUNCTION public.period_can_mark(p_session uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.period_sessions s JOIN public.staff_records f ON f.id=coalesce(s.substitute_faculty_id,s.scheduled_faculty_id)
 WHERE s.id=p_session AND f.profile_id=public.current_profile_id() AND public.period_identity(s.institution_id)
 AND public.period_faculty_valid(f.id,s.institution_id,s.session_date) AND (s.substitute_faculty_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.period_session_sections ss WHERE ss.session_id=s.id AND NOT public.period_teaches(f.id,ss.section_id,s.subject_id,s.session_date))));
$$;
CREATE FUNCTION public.period_can_view(p_session uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.period_sessions s WHERE s.id=p_session AND public.period_identity(s.institution_id) AND (
 public.period_can_mark(s.id) OR public.setup_is_admin(s.institution_id) OR EXISTS(SELECT 1 FROM public.period_session_sections ss WHERE ss.session_id=s.id AND public.period_ci(ss.section_id))));
$$;
CREATE FUNCTION public.period_section_view(p_session uuid,p_section uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.period_can_view(p_session) AND (public.period_can_mark(p_session) OR public.period_ci(p_section) OR EXISTS(SELECT 1 FROM public.period_sessions WHERE id=p_session AND public.setup_is_admin(institution_id)));
$$;
CREATE FUNCTION public.period_effective_state(p public.period_sessions) RETURNS text LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN p.status='cancelled' THEN 'cancelled' WHEN p.submitted_at IS NULL THEN CASE WHEN clock_timestamp()>=p.starts_at THEN 'pending' ELSE 'scheduled' END
 WHEN p.status='corrected' THEN 'corrected' WHEN clock_timestamp()>=p.lock_at THEN 'locked' ELSE 'grace_period' END;
$$;
CREATE FUNCTION public.period_event(p_institution uuid,p_session uuid,p_student uuid,p_rule uuid,p_action text,p_old jsonb,p_new jsonb,p_reason text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 INSERT INTO public.period_attendance_events(institution_id,session_id,student_id,rule_id,actor_profile_id,action,previous,current,reason)
 VALUES(p_institution,p_session,p_student,p_rule,public.current_profile_id(),p_action,p_old,p_new,p_reason);
$$;
DO $$ DECLARE t text;f text;BEGIN
 FOREACH t IN ARRAY ARRAY['timetable_rules','timetable_rule_sections','timetable_exceptions','period_sessions','period_session_sections','period_session_roster','period_marks','period_drafts','student_day_leave','period_attendance_events'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);EXECUTE format('GRANT ALL ON public.%I TO service_role',t);END LOOP;
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('period_identity','period_ci','period_faculty_valid','period_teaches','period_can_mark','period_can_view','period_section_view','period_event') LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f||' FROM PUBLIC,anon,authenticated';END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.period_identity(uuid),public.period_ci(uuid),public.period_can_mark(uuid),public.period_can_view(uuid),public.period_section_view(uuid,uuid) TO authenticated;
CREATE POLICY period_session_read ON public.period_sessions FOR SELECT TO authenticated USING(public.period_can_view(id));
CREATE POLICY period_sections_read ON public.period_session_sections FOR SELECT TO authenticated USING(public.period_section_view(session_id,section_id));
CREATE POLICY period_roster_read ON public.period_session_roster FOR SELECT TO authenticated USING(public.period_section_view(session_id,section_id));
CREATE POLICY period_mark_read ON public.period_marks FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.period_session_roster r WHERE r.session_id=period_marks.session_id AND r.student_id=period_marks.student_id AND public.period_section_view(r.session_id,r.section_id)));
CREATE POLICY period_draft_read ON public.period_drafts FOR SELECT TO authenticated USING(public.period_can_mark(session_id));
CREATE POLICY timetable_read ON public.timetable_rules FOR SELECT TO authenticated USING(public.period_identity(institution_id) AND (public.setup_is_admin(institution_id) OR public.period_ci(owner_section_id) OR faculty_id IN (SELECT id FROM public.staff_records WHERE profile_id=public.current_profile_id())));
CREATE POLICY timetable_sections_read ON public.timetable_rule_sections FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.timetable_rules r WHERE r.id=rule_id));
CREATE POLICY timetable_exception_read ON public.timetable_exceptions FOR SELECT TO authenticated USING(public.period_identity(institution_id) AND (public.setup_is_admin(institution_id) OR public.period_ci(section_id)));
CREATE POLICY period_leave_read ON public.student_day_leave FOR SELECT TO authenticated USING(public.period_identity(institution_id) AND (public.setup_is_admin(institution_id) OR public.period_ci(section_id)));
CREATE POLICY period_audit_read ON public.period_attendance_events FOR SELECT TO authenticated USING(public.period_identity(institution_id) AND (public.setup_is_admin(institution_id) OR (session_id IS NOT NULL AND public.period_can_view(session_id) AND (student_id IS NULL OR EXISTS(SELECT 1 FROM public.period_session_roster r WHERE r.session_id=period_attendance_events.session_id AND r.student_id=period_attendance_events.student_id AND public.period_section_view(r.session_id,r.section_id))))));
COMMIT;
