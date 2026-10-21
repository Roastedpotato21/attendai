BEGIN;
-- Managed staff use the new capability model. The old operational role enum is
-- retained for legacy records; it is never a shortcut from HOD to attendance.
CREATE OR REPLACE FUNCTION public.has_institution_role(target_institution_id uuid,required_roles user_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.is_institution_member(target_institution_id) AND CASE
  WHEN EXISTS(SELECT 1 FROM public.staff_records WHERE institution_id=target_institution_id AND profile_id=public.current_profile_id())
   THEN 'admin'::user_role=ANY(required_roles) AND public.setup_is_admin(target_institution_id)
  ELSE EXISTS(SELECT 1 FROM public.profile_roles WHERE institution_id=target_institution_id
    AND profile_id=public.current_profile_id() AND role_code=ANY(required_roles)) END;
$$;
CREATE OR REPLACE FUNCTION public.can_manage_class(target_class_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.classes c WHERE c.id=target_class_id AND
  CASE WHEN EXISTS(SELECT 1 FROM public.staff_records WHERE institution_id=c.institution_id AND profile_id=public.current_profile_id())
   THEN public.setup_is_admin(c.institution_id)
  ELSE public.has_institution_role(c.institution_id,ARRAY['admin','staff']::user_role[])
   OR EXISTS(SELECT 1 FROM public.faculty f JOIN public.class_faculty a ON a.faculty_id=f.id AND a.institution_id=f.institution_id
    WHERE a.class_id=c.id AND f.user_id=public.current_profile_id() AND f.active
     AND public.has_institution_role(c.institution_id,ARRAY['faculty']::user_role[])) END);
$$;
CREATE FUNCTION public.can_view_setup_class(p_class uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.classes c WHERE c.id=p_class AND public.is_institution_member(c.institution_id) AND (
  NOT EXISTS(SELECT 1 FROM public.staff_records WHERE institution_id=c.institution_id AND profile_id=public.current_profile_id())
  OR public.setup_is_admin(c.institution_id)
  OR EXISTS(SELECT 1 FROM public.academic_sections s JOIN public.academic_programs p ON p.id=s.program_id
    JOIN public.staff_responsibilities a ON a.institution_id=s.institution_id AND a.active
    WHERE s.class_id=c.id AND public.setup_today(s.institution_id) BETWEEN a.effective_from AND a.effective_until AND (
      (a.kind='teaching' AND a.section_id=s.id AND public.can_mark_assigned_subject(s.id,a.subject_id,s.term_id,public.setup_today(s.institution_id)))
      OR (a.kind='class_incharge' AND a.section_id=s.id AND public.staff_has_role(a.staff_id,'class_incharge',public.setup_today(s.institution_id)))
      OR (a.kind='hod' AND a.department_id=p.department_id AND public.staff_has_role(a.staff_id,'hod',public.setup_today(s.institution_id)))
      OR (a.kind='coordinator' AND a.program_id=s.program_id AND (a.term_id IS NULL OR a.term_id=s.term_id)
          AND public.staff_has_role(a.staff_id,'coordinator',public.setup_today(s.institution_id)))))));
$$;
CREATE POLICY setup_class_scope ON public.classes AS RESTRICTIVE FOR SELECT TO authenticated USING(public.can_view_setup_class(id));

CREATE OR REPLACE FUNCTION public.activate_my_staff_invitation()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.has_current_policy_acceptance(auth.uid()) OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL) THEN
  RAISE EXCEPTION 'verified identity and current policies required' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_records WHERE profile_id=public.current_profile_id() AND status='invited') THEN
  RAISE EXCEPTION 'staff invitation token required' USING ERRCODE='42501'; END IF;
 RETURN public.activate_my_staff_invitation_after_policy();
END $$;

CREATE FUNCTION public.can_manage_assigned_section(p_section uuid,p_on date DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.staff_responsibilities a JOIN public.academic_sections s ON s.id=a.section_id AND s.term_id=a.term_id
  JOIN public.academic_terms t ON t.id=s.term_id AND t.institution_id=s.institution_id
  WHERE a.section_id=p_section AND a.kind='class_incharge' AND a.active
   AND coalesce(p_on,public.setup_today(a.institution_id)) BETWEEN a.effective_from AND a.effective_until
   AND coalesce(p_on,public.setup_today(a.institution_id)) BETWEEN t.starts_on AND t.ends_on
   AND public.staff_has_role(a.staff_id,'class_incharge',coalesce(p_on,public.setup_today(a.institution_id))));
$$;
CREATE FUNCTION public.can_oversee_department(p_department uuid,p_on date DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.staff_responsibilities a WHERE a.department_id=p_department AND a.kind='hod' AND a.active
  AND coalesce(p_on,public.setup_today(a.institution_id)) BETWEEN a.effective_from AND a.effective_until
  AND public.staff_has_role(a.staff_id,'hod',coalesce(p_on,public.setup_today(a.institution_id))));
$$;
CREATE FUNCTION public.can_coordinate_program(p_program uuid,p_term uuid DEFAULT NULL,p_on date DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.staff_responsibilities a WHERE a.program_id=p_program AND a.kind='coordinator' AND a.active
  AND (a.term_id IS NULL OR a.term_id=p_term)
  AND (p_term IS NULL OR EXISTS(SELECT 1 FROM public.academic_terms WHERE id=p_term AND program_id=p_program AND coalesce(p_on,public.setup_today(a.institution_id)) BETWEEN starts_on AND ends_on))
  AND coalesce(p_on,public.setup_today(a.institution_id)) BETWEEN a.effective_from AND a.effective_until
  AND public.staff_has_role(a.staff_id,'coordinator',coalesce(p_on,public.setup_today(a.institution_id))));
$$;
CREATE FUNCTION public.my_staff_memberships() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'can_manage',public.setup_is_admin(i.id)) ORDER BY i.name,i.id),'[]')
 FROM public.institutions i WHERE public.is_institution_member(i.id)
  AND (public.setup_is_admin(i.id) OR EXISTS(SELECT 1 FROM public.staff_records WHERE institution_id=i.id AND profile_id=public.current_profile_id() AND status='active'));
$$;
CREATE FUNCTION public.my_legacy_class_assignments(p_institution uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.full_name) ORDER BY c.full_name,c.id),'[]')
 FROM public.classes c WHERE c.institution_id=p_institution
  AND EXISTS(SELECT 1 FROM public.staff_records WHERE institution_id=p_institution AND profile_id=public.current_profile_id() AND legacy_class_assignments)
  AND EXISTS(SELECT 1 FROM public.faculty f JOIN public.class_faculty a ON a.faculty_id=f.id AND a.institution_id=f.institution_id
    WHERE f.user_id=public.current_profile_id() AND f.active AND a.class_id=c.id AND a.institution_id=p_institution)
  AND public.can_manage_class(c.id);
$$;
CREATE FUNCTION public.my_staff_portal_access(p_institution uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.staff_records; roles_value text[]; is_owner boolean; can_manage boolean; profile public.profiles;
BEGIN
 SELECT * INTO profile FROM public.profiles WHERE auth_user_id=auth.uid() AND status='active';
 IF profile.id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL) THEN RETURN NULL; END IF;
 SELECT r.* INTO s FROM public.staff_records r WHERE r.profile_id=profile.id AND r.status='active'
  AND public.is_institution_member(r.institution_id) AND (p_institution IS NULL OR r.institution_id=p_institution)
  ORDER BY r.created_at,r.id LIMIT 1;
 IF s.id IS NULL THEN
  IF p_institution IS NOT NULL AND EXISTS(SELECT 1 FROM public.staff_records WHERE profile_id=profile.id) THEN
   RAISE EXCEPTION 'selected institution unavailable; select an active membership' USING ERRCODE='42501'; END IF;
  RETURN NULL;
 END IF;
 SELECT owner_profile_id=profile.id INTO is_owner FROM public.institutions WHERE id=s.institution_id;
 SELECT coalesce(array_agg(role ORDER BY role),'{}') INTO roles_value FROM public.staff_role_grants
  WHERE staff_id=s.id AND active AND public.setup_today(s.institution_id)>=valid_from
    AND (valid_until IS NULL OR public.setup_today(s.institution_id)<=valid_until);
 IF coalesce(is_owner,false) THEN roles_value:=array_prepend('institution_owner',roles_value); END IF;
 IF cardinality(roles_value)=0 THEN RETURN jsonb_build_object('status','role_missing'); END IF;
 can_manage:=public.setup_is_admin(s.institution_id);
 RETURN jsonb_build_object('status','allowed','user',jsonb_build_object('id',profile.id,'name',s.full_name,'email',s.email,
  'role',CASE WHEN can_manage THEN 'admin' WHEN 'faculty'=ANY(roles_value) THEN 'faculty' ELSE 'staff' END,
  'createdAt',profile.created_at,'updatedAt',profile.updated_at,'staffModel',true,'institutionId',s.institution_id,
  'setupRoles',roles_value,'canManageSetup',can_manage,
  'legacyClassAccess',s.legacy_class_assignments AND 'faculty'=ANY(roles_value) AND jsonb_array_length(public.my_legacy_class_assignments(s.institution_id))>0));
END $$;
CREATE FUNCTION public.my_staff_workspace(p_institution uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.staff_records; portal jsonb; assignments jsonb; primary_name text; roles_value jsonb;
BEGIN
 IF NOT public.is_institution_member(p_institution) OR NOT public.has_current_policy_acceptance(auth.uid()) THEN
  RAISE EXCEPTION 'active staff identity and current policies required' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.staff_records WHERE institution_id=p_institution AND profile_id=public.current_profile_id() AND status='active';
 IF s.id IS NULL AND NOT public.setup_is_admin(p_institution) THEN RAISE EXCEPTION 'staff profile unavailable' USING ERRCODE='42501'; END IF;
 portal:=public.my_staff_portal_access(p_institution);
 IF s.id IS NOT NULL AND coalesce(portal->>'status','')<>'allowed' THEN
  RAISE EXCEPTION 'active system role required for this workspace' USING ERRCODE='42501'; END IF;
 roles_value:=CASE WHEN s.id IS NULL AND public.setup_is_admin(p_institution) THEN '["institution_admin"]'::jsonb
  ELSE coalesce(portal->'user'->'setupRoles','[]'::jsonb) END;
 SELECT name INTO primary_name FROM public.academic_departments WHERE id=s.primary_department_id AND institution_id=p_institution;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.kind,q.department_name,q.id),'[]') INTO assignments FROM (
  SELECT a.id,a.kind,a.department_id,d.name department_name,a.program_id,p.name program_name,a.term_id,t.name term_name,
   a.section_id,c.name section_name,a.subject_id,u.name subject_name,a.academic_year,a.effective_from,a.effective_until,
   CASE a.kind WHEN 'teaching' THEN public.staff_has_role(s.id,'faculty',public.setup_today(p_institution))
    WHEN 'department_member' THEN true ELSE public.staff_has_role(s.id,a.kind,public.setup_today(p_institution)) END role_effective,
   CASE WHEN a.kind='teaching' THEN public.can_mark_assigned_subject(a.section_id,a.subject_id,a.term_id,public.setup_today(p_institution)) ELSE false END can_mark_subject,
   CASE WHEN a.kind='hod' AND public.staff_has_role(s.id,'hod',public.setup_today(p_institution)) THEN
    (SELECT count(*) FROM public.academic_programs WHERE institution_id=p_institution AND department_id=a.department_id) END program_count,
   CASE WHEN a.kind IN ('hod','coordinator') AND public.staff_has_role(s.id,a.kind,public.setup_today(p_institution)) THEN
    (SELECT count(*) FROM public.academic_sections c JOIN public.academic_programs p ON p.id=c.program_id
     WHERE c.institution_id=p_institution AND ((a.kind='hod' AND p.department_id=a.department_id)
       OR (a.kind='coordinator' AND c.program_id=a.program_id AND (a.term_id IS NULL OR c.term_id=a.term_id)))) END section_count
  FROM public.staff_responsibilities a JOIN public.academic_departments d ON d.id=a.department_id
   LEFT JOIN public.academic_programs p ON p.id=a.program_id LEFT JOIN public.academic_terms t ON t.id=a.term_id
   LEFT JOIN public.academic_sections c ON c.id=a.section_id LEFT JOIN public.academic_subjects u ON u.id=a.subject_id
  WHERE a.staff_id=s.id AND a.active AND public.setup_today(p_institution) BETWEEN a.effective_from AND a.effective_until
 ) q;
 RETURN jsonb_build_object('staff',to_jsonb(s),'primary_department',primary_name,'roles',roles_value,
  'institution',public.institution_setup_profile(p_institution),'can_manage_setup',public.setup_is_admin(p_institution),
  'assignments',assignments,'memberships',public.my_staff_memberships(),'legacy_classes',public.my_legacy_class_assignments(p_institution));
END $$;
DO $$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['institution_settings','academic_departments','academic_programs','academic_terms','academic_sections','academic_subjects','staff_records','staff_role_grants','staff_responsibilities','staff_setup_audit','staff_invitations'] LOOP
  EXECUTE format('CREATE POLICY setup_current_policies ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING(public.has_current_policy_acceptance(auth.uid())) WITH CHECK(public.has_current_policy_acceptance(auth.uid()))',n);
 END LOOP;
 FOR n IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
 WHERE ns.nspname='public' AND p.proname IN ('can_view_setup_class','can_manage_assigned_section','can_oversee_department','can_coordinate_program','my_staff_memberships','my_staff_portal_access','my_staff_workspace','my_legacy_class_assignments') LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||n||' FROM PUBLIC,anon'; EXECUTE 'GRANT EXECUTE ON FUNCTION '||n||' TO authenticated';
 END LOOP;
END $$;
COMMIT;
