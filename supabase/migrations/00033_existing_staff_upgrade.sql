-- Upgrade existing active memberships from recorded data only. Descriptive
-- faculty.role values do not become HOD/coordinator permission grants.
BEGIN;
ALTER TABLE public.staff_role_grants ALTER COLUMN created_by DROP NOT NULL;

CREATE FUNCTION public.import_existing_staff_membership(p_profile uuid,p_institution uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.profiles; f public.faculty; department_value uuid; staff_value uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profile_institutions WHERE profile_id=p_profile AND institution_id=p_institution AND status='active')
  OR NOT EXISTS(SELECT 1 FROM public.profile_roles WHERE profile_id=p_profile AND institution_id=p_institution AND role_code IN ('admin','faculty','staff'))
  OR EXISTS(SELECT 1 FROM public.staff_records WHERE profile_id=p_profile AND institution_id=p_institution) THEN RETURN; END IF;
 SELECT * INTO p FROM public.profiles WHERE id=p_profile AND student_id IS NULL;
 IF p.id IS NULL THEN RETURN; END IF;
 SELECT * INTO f FROM public.faculty WHERE user_id=p_profile AND institution_id=p_institution ORDER BY created_at,id LIMIT 1;
 IF nullif(btrim(f.department),'') IS NOT NULL THEN
  SELECT min(id::text)::uuid INTO department_value FROM public.academic_departments
   WHERE institution_id=p_institution AND lower(btrim(name))=lower(btrim(f.department)) HAVING count(*)=1;
  IF department_value IS NULL THEN
  -- The source has a department name but no institutional code. Preserve the
  -- name and use a stable imported code, clearly identified for admin review.
  INSERT INTO public.academic_departments(institution_id,name,code)
   VALUES(p_institution,btrim(f.department),'import-'||left(md5(btrim(f.department)),12))
   ON CONFLICT(institution_id,lower(code)) DO NOTHING;
  SELECT id INTO department_value FROM public.academic_departments
   WHERE institution_id=p_institution AND lower(code)='import-'||left(md5(btrim(f.department)),12);
  END IF;
 END IF;
 INSERT INTO public.staff_records(institution_id,profile_id,full_name,email,phone,designation,primary_department_id,status,legacy_class_assignments)
 VALUES(p_institution,p.id,p.name,lower(btrim(p.email)),'',coalesce(initcap(replace(f.role::text,'_',' ')),'Not recorded'),department_value,'active',true)
 RETURNING id INTO staff_value;
 INSERT INTO public.staff_role_grants(institution_id,staff_id,role,valid_from,created_by,reason)
 SELECT p_institution,staff_value,CASE role_code WHEN 'admin' THEN 'institution_admin' ELSE role_code::text END,
  assigned_at::date,assigned_by,'Imported existing system role; original assignment identity retained where recorded.'
 FROM public.profile_roles WHERE profile_id=p_profile AND institution_id=p_institution AND role_code IN ('admin','faculty','staff');
END $$;
REVOKE ALL ON FUNCTION public.import_existing_staff_membership(uuid,uuid) FROM PUBLIC,anon,authenticated;
DO $$
DECLARE m record;
BEGIN
 FOR m IN SELECT profile_id,institution_id FROM public.profile_institutions WHERE status='active' LOOP
  PERFORM public.import_existing_staff_membership(m.profile_id,m.institution_id);
 END LOOP;
END $$;
CREATE FUNCTION public.import_accepted_legacy_staff() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status='active' THEN PERFORM public.import_existing_staff_membership(NEW.profile_id,NEW.institution_id); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.import_accepted_legacy_staff() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER import_accepted_legacy_staff AFTER UPDATE OF status ON public.profile_institutions
 FOR EACH ROW WHEN(OLD.status='invited' AND NEW.status='active') EXECUTE FUNCTION public.import_accepted_legacy_staff();

-- Preserve only actual legacy class assignments. New subject assignments must
-- never grant an old class-wide attendance submission permission.
CREATE OR REPLACE FUNCTION public.can_manage_class(target_class_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.classes c WHERE c.id=target_class_id AND
  CASE WHEN EXISTS(SELECT 1 FROM public.staff_records WHERE institution_id=c.institution_id AND profile_id=public.current_profile_id())
   THEN public.setup_is_admin(c.institution_id) OR EXISTS(
    SELECT 1 FROM public.staff_records s JOIN public.faculty f ON f.user_id=s.profile_id AND f.institution_id=s.institution_id
    JOIN public.class_faculty a ON a.faculty_id=f.id AND a.institution_id=f.institution_id
    WHERE s.institution_id=c.institution_id AND s.profile_id=public.current_profile_id() AND s.legacy_class_assignments
      AND a.class_id=c.id AND f.active AND public.staff_has_role(s.id,'faculty',public.setup_today(c.institution_id)))
  ELSE public.has_institution_role(c.institution_id,ARRAY['admin','staff']::user_role[])
   OR EXISTS(SELECT 1 FROM public.faculty f JOIN public.class_faculty a ON a.faculty_id=f.id AND a.institution_id=f.institution_id
    WHERE a.class_id=c.id AND f.user_id=public.current_profile_id() AND f.active
     AND public.has_institution_role(c.institution_id,ARRAY['faculty']::user_role[])) END);
$$;
CREATE OR REPLACE FUNCTION public.can_view_setup_class(p_class uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.classes c WHERE c.id=p_class AND public.is_institution_member(c.institution_id) AND (
  NOT EXISTS(SELECT 1 FROM public.staff_records WHERE institution_id=c.institution_id AND profile_id=public.current_profile_id())
  OR public.can_manage_class(c.id)
  OR EXISTS(SELECT 1 FROM public.academic_sections s JOIN public.academic_programs p ON p.id=s.program_id
    JOIN public.staff_responsibilities a ON a.institution_id=s.institution_id AND a.active
    WHERE s.class_id=c.id AND public.setup_today(s.institution_id) BETWEEN a.effective_from AND a.effective_until AND (
      (a.kind='teaching' AND a.section_id=s.id AND public.can_mark_assigned_subject(s.id,a.subject_id,s.term_id,public.setup_today(s.institution_id)))
      OR (a.kind='class_incharge' AND a.section_id=s.id AND public.staff_has_role(a.staff_id,'class_incharge',public.setup_today(s.institution_id)))
      OR (a.kind='hod' AND a.department_id=p.department_id AND public.staff_has_role(a.staff_id,'hod',public.setup_today(s.institution_id)))
      OR (a.kind='coordinator' AND a.program_id=s.program_id AND (a.term_id IS NULL OR a.term_id=s.term_id)
          AND public.staff_has_role(a.staff_id,'coordinator',public.setup_today(s.institution_id)))))));
$$;
CREATE OR REPLACE FUNCTION public.my_legacy_class_assignments(p_institution uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.full_name) ORDER BY c.full_name,c.id),'[]')
 FROM public.classes c WHERE c.institution_id=p_institution
  AND EXISTS(SELECT 1 FROM public.staff_records WHERE institution_id=p_institution AND profile_id=public.current_profile_id() AND legacy_class_assignments)
  AND EXISTS(SELECT 1 FROM public.faculty f JOIN public.class_faculty a ON a.faculty_id=f.id AND a.institution_id=f.institution_id
    WHERE f.user_id=public.current_profile_id() AND f.active AND a.class_id=c.id AND a.institution_id=p_institution)
  AND public.can_manage_class(c.id);
$$;
REVOKE ALL ON FUNCTION public.my_legacy_class_assignments(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.my_legacy_class_assignments(uuid) TO authenticated;
CREATE FUNCTION public.can_read_staff_identity(p_profile uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p_profile=public.current_profile_id() OR
  NOT EXISTS(SELECT 1 FROM public.staff_records WHERE profile_id=public.current_profile_id()) OR
  EXISTS(SELECT 1 FROM public.profile_institutions m WHERE m.profile_id=p_profile AND public.setup_is_admin(m.institution_id));
$$;
REVOKE ALL ON FUNCTION public.can_read_staff_identity(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_staff_identity(uuid) TO authenticated;
CREATE POLICY setup_profile_scope ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated USING(public.can_read_staff_identity(id));

-- An ended migrated admin grant cannot leave an older privileged assignment
-- usable by a legacy server endpoint. This changes a role, not the staff lifecycle.
CREATE FUNCTION public.close_legacy_admin_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.staff_records;
BEGIN
 IF OLD.role='institution_admin' AND OLD.active AND NOT NEW.active THEN
  SELECT * INTO s FROM public.staff_records WHERE id=NEW.staff_id;
  IF s.profile_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.institutions WHERE id=s.institution_id AND owner_profile_id=s.profile_id) THEN
   DELETE FROM public.profile_roles WHERE profile_id=s.profile_id AND institution_id=s.institution_id AND role_code='admin';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.close_legacy_admin_grant() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER close_legacy_admin_grant AFTER UPDATE ON public.staff_role_grants FOR EACH ROW EXECUTE FUNCTION public.close_legacy_admin_grant();
-- Server-side role lookup for existing admin APIs. Uses current dated grants,
-- rather than materializing stale enum permissions onto new staff.
CREATE FUNCTION public.authorized_staff_admin_institutions(p_user uuid)
RETURNS TABLE(profile_id uuid,institution_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'trusted server role required' USING ERRCODE='42501'; END IF;
 IF NOT public.has_current_policy_acceptance(p_user) THEN RETURN; END IF;
 RETURN QUERY SELECT p.id,i.id FROM public.profiles p JOIN auth.users u ON u.id=p.auth_user_id
 JOIN public.profile_institutions m ON m.profile_id=p.id JOIN public.institutions i ON i.id=m.institution_id
 WHERE u.id=p_user AND u.email_confirmed_at IS NOT NULL AND p.status='active' AND m.status='active' AND i.status='active'
  AND (i.owner_profile_id=p.id OR EXISTS(
   SELECT 1 FROM public.staff_records s JOIN public.staff_role_grants r ON r.staff_id=s.id AND r.institution_id=s.institution_id
   WHERE s.profile_id=p.id AND s.institution_id=i.id AND s.status='active' AND r.role='institution_admin' AND r.active
    AND public.setup_today(i.id)>=r.valid_from AND (r.valid_until IS NULL OR public.setup_today(i.id)<=r.valid_until))
   OR (NOT EXISTS(SELECT 1 FROM public.staff_records WHERE staff_records.institution_id=i.id AND staff_records.profile_id=p.id)
    AND EXISTS(SELECT 1 FROM public.profile_roles WHERE profile_roles.profile_id=p.id AND profile_roles.institution_id=i.id AND role_code='admin')));
END $$;
REVOKE ALL ON FUNCTION public.authorized_staff_admin_institutions(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorized_staff_admin_institutions(uuid) TO service_role;
COMMIT;
