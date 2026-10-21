BEGIN;
CREATE FUNCTION public.institution_setup_profile(p_institution uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.is_institution_member(p_institution) THEN RAISE EXCEPTION 'institution unavailable' USING ERRCODE='42501'; END IF;
 SELECT (coalesce(to_jsonb(s),'{}')-'logo_bytes')||jsonb_build_object(
  'institution_id',i.id,'name',i.name,'state',coalesce(nullif(i.state,''),s.state,''),
  'institution_type',coalesce(a.institution_type,s.institution_type,''),
  'verified_identity',i.verification_application_id IS NOT NULL,'owner_profile_id',i.owner_profile_id,
  'logo_data_url',CASE WHEN s.logo_bytes IS NOT NULL THEN 'data:'||s.logo_mime||';base64,'||replace(encode(s.logo_bytes,'base64'),E'\n','') END
 ) INTO result FROM public.institutions i LEFT JOIN public.institution_settings s ON s.institution_id=i.id
 LEFT JOIN public.institution_verification_applications a ON a.id=i.verification_application_id WHERE i.id=p_institution;
 RETURN result;
END $$;
CREATE FUNCTION public.save_institution_setup_profile(p_institution uuid,p_details jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i public.institutions; a public.institution_verification_applications; type_value text; state_value text;
BEGIN
 PERFORM public.setup_actor(p_institution);
 SELECT * INTO i FROM public.institutions WHERE id=p_institution FOR UPDATE;
 SELECT * INTO a FROM public.institution_verification_applications WHERE id=i.verification_application_id;
 type_value:=coalesce(a.institution_type,p_details->>'institution_type','');
 state_value:=coalesce(nullif(i.state,''),p_details->>'state','');
 IF p_details->>'name' IS DISTINCT FROM i.name OR (a.id IS NOT NULL AND p_details->>'institution_type' IS DISTINCT FROM a.institution_type)
   OR (nullif(i.state,'') IS NOT NULL AND p_details->>'state' IS DISTINCT FROM i.state) THEN
  RAISE EXCEPTION 'verified institution identity cannot be renamed through setup' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_details) IS DISTINCT FROM 'object'
  OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_details->>'timezone')
  OR length(coalesce(p_details->>'academic_year','')) NOT BETWEEN 2 AND 80
  OR length(btrim(coalesce(p_details->>'official_address',''))) NOT BETWEEN 5 AND 2000
  OR length(btrim(coalesce(p_details->>'city',''))) NOT BETWEEN 2 AND 120
  OR length(btrim(state_value)) NOT BETWEEN 2 AND 120 OR length(btrim(type_value)) NOT BETWEEN 2 AND 100
  OR coalesce(p_details->>'official_email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  OR coalesce(p_details->>'official_phone','') !~ '^\+?[0-9 ()-]{7,25}$'
  OR (coalesce(p_details->>'website','')<>'' AND p_details->>'website' !~ '^https://[^/[:space:]@]+([/:]|$)')
  OR length(coalesce(p_details->>'official_email',''))>254 OR length(coalesce(p_details->>'website',''))>2000 THEN
  RAISE EXCEPTION 'institution profile is incomplete or invalid' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.institution_settings(institution_id,official_address,city,state,institution_type,academic_year,timezone,official_email,official_phone,website,brand_name,brand_color)
 VALUES(p_institution,btrim(p_details->>'official_address'),btrim(p_details->>'city'),state_value,type_value,
  p_details->>'academic_year',p_details->>'timezone',lower(p_details->>'official_email'),p_details->>'official_phone',
  coalesce(p_details->>'website',''),coalesce(p_details->>'brand_name',''),coalesce(p_details->>'brand_color','#2563eb'))
 ON CONFLICT(institution_id) DO UPDATE SET official_address=EXCLUDED.official_address,city=EXCLUDED.city,state=EXCLUDED.state,
  institution_type=EXCLUDED.institution_type,academic_year=EXCLUDED.academic_year,timezone=EXCLUDED.timezone,
  official_email=EXCLUDED.official_email,official_phone=EXCLUDED.official_phone,website=EXCLUDED.website,
  brand_name=EXCLUDED.brand_name,brand_color=EXCLUDED.brand_color,updated_at=now();
END $$;
CREATE FUNCTION public.set_institution_setup_logo(p_institution uuid,p_base64 text,p_mime text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE bytes bytea;
BEGIN
 PERFORM public.setup_actor(p_institution);
 IF p_base64 IS NOT NULL THEN
  IF length(p_base64)>349528 OR p_base64 !~ '^[A-Za-z0-9+/=]+$' OR p_mime IS NULL OR p_mime NOT IN ('image/png','image/jpeg') THEN
   RAISE EXCEPTION 'logo must be a PNG/JPEG up to 256 KiB' USING ERRCODE='22023'; END IF;
  bytes:=decode(p_base64,'base64');
  IF octet_length(bytes)<8 OR octet_length(bytes)>262144 OR NOT (
    (p_mime='image/png' AND substring(bytes FROM 1 FOR 8)=decode('89504e470d0a1a0a','hex'))
    OR (p_mime='image/jpeg' AND substring(bytes FROM 1 FOR 3)=decode('ffd8ff','hex'))) THEN
   RAISE EXCEPTION 'logo signature/size invalid' USING ERRCODE='22023'; END IF;
 ELSIF p_mime IS NOT NULL THEN RAISE EXCEPTION 'logo metadata invalid' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.institution_settings(institution_id,logo_bytes,logo_mime) VALUES(p_institution,bytes,p_mime)
 ON CONFLICT(institution_id) DO UPDATE SET logo_bytes=EXCLUDED.logo_bytes,logo_mime=EXCLUDED.logo_mime,updated_at=now();
END $$;

CREATE FUNCTION public.create_academic_entity(p_institution uuid,p_kind text,p_details jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result uuid; t public.academic_terms; class_value uuid; program_value public.academic_programs;
BEGIN
 PERFORM public.setup_actor(p_institution);
 IF jsonb_typeof(p_details) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'academic details required' USING ERRCODE='22023'; END IF;
 CASE p_kind
 WHEN 'department' THEN
  INSERT INTO public.academic_departments(institution_id,name,code) VALUES(p_institution,btrim(p_details->>'name'),btrim(p_details->>'code')) RETURNING id INTO result;
 WHEN 'program' THEN
  INSERT INTO public.academic_programs(institution_id,department_id,name,code) VALUES(p_institution,(p_details->>'department_id')::uuid,btrim(p_details->>'name'),btrim(p_details->>'code')) RETURNING id INTO result;
 WHEN 'term' THEN
  INSERT INTO public.academic_terms(institution_id,program_id,name,academic_year,term_kind,year_number,starts_on,ends_on)
  VALUES(p_institution,(p_details->>'program_id')::uuid,btrim(p_details->>'name'),btrim(p_details->>'academic_year'),
   p_details->>'term_kind',nullif(p_details->>'year_number','')::integer,(p_details->>'starts_on')::date,(p_details->>'ends_on')::date) RETURNING id INTO result;
 WHEN 'section' THEN
  SELECT * INTO t FROM public.academic_terms WHERE id=(p_details->>'term_id')::uuid AND institution_id=p_institution;
  IF t.id IS NULL THEN RAISE EXCEPTION 'term unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO program_value FROM public.academic_programs WHERE id=t.program_id AND institution_id=p_institution;
  class_value:=gen_random_uuid();
  INSERT INTO public.classes(id,institution_id,name,section,full_name,academic_year)
   VALUES(class_value,p_institution,program_value.code||' / '||t.name||' / '||t.academic_year,btrim(p_details->>'name'),program_value.name||' / '||t.name||' / '||btrim(p_details->>'name'),t.academic_year);
  INSERT INTO public.academic_sections(institution_id,program_id,term_id,class_id,name)
   VALUES(p_institution,t.program_id,t.id,class_value,btrim(p_details->>'name')) RETURNING id INTO result;
 WHEN 'subject' THEN
  INSERT INTO public.academic_subjects(institution_id,program_id,name,code)
   VALUES(p_institution,(p_details->>'program_id')::uuid,btrim(p_details->>'name'),btrim(p_details->>'code')) RETURNING id INTO result;
 ELSE RAISE EXCEPTION 'unknown academic entity' USING ERRCODE='22023';
 END CASE;
 RETURN result;
END $$;
CREATE FUNCTION public.set_staff_roles(p_staff uuid,p_roles text[],p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.staff_records; actor uuid; role_value text;
BEGIN
 SELECT * INTO s FROM public.staff_records WHERE id=p_staff FOR UPDATE;
 actor:=public.setup_actor(s.institution_id);
 IF p_roles IS NULL OR cardinality(p_roles) NOT BETWEEN 1 AND 6 OR array_position(p_roles,NULL) IS NOT NULL
  OR NOT p_roles <@ ARRAY['institution_admin','faculty','class_incharge','hod','coordinator','staff']::text[]
  OR length(btrim(coalesce(p_reason,'')))<10 THEN RAISE EXCEPTION 'valid roles and specific reason required' USING ERRCODE='22023'; END IF;
 UPDATE public.staff_role_grants SET active=false,closed_at=now(),reason=p_reason WHERE staff_id=s.id AND active
  AND (NOT role=ANY(p_roles) OR valid_until<public.setup_today(s.institution_id));
 FOREACH role_value IN ARRAY p_roles LOOP
  INSERT INTO public.staff_role_grants(institution_id,staff_id,role,valid_from,created_by,reason)
   VALUES(s.institution_id,s.id,role_value,public.setup_today(s.institution_id),actor,p_reason)
   ON CONFLICT(staff_id,role) WHERE active DO NOTHING;
 END LOOP;
END $$;
CREATE FUNCTION public.add_staff_responsibility(p_staff uuid,p_details jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.staff_records; actor uuid; result uuid;
BEGIN
 SELECT * INTO s FROM public.staff_records WHERE id=p_staff FOR UPDATE;
 actor:=public.setup_actor(s.institution_id);
 IF length(btrim(coalesce(p_details->>'reason','')))<10 THEN RAISE EXCEPTION 'assignment reason required' USING ERRCODE='22023'; END IF;
 INSERT INTO public.staff_responsibilities(institution_id,staff_id,kind,department_id,program_id,term_id,section_id,subject_id,academic_year,effective_from,effective_until,created_by,reason)
 VALUES(s.institution_id,s.id,p_details->>'kind',(p_details->>'department_id')::uuid,
  nullif(p_details->>'program_id','')::uuid,nullif(p_details->>'term_id','')::uuid,nullif(p_details->>'section_id','')::uuid,
  nullif(p_details->>'subject_id','')::uuid,coalesce(p_details->>'academic_year',''),
  (p_details->>'effective_from')::date,(p_details->>'effective_until')::date,actor,p_details->>'reason') RETURNING id INTO result;
 RETURN result;
END $$;
CREATE FUNCTION public.close_staff_responsibility(p_id uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.staff_responsibilities;
BEGIN
 SELECT * INTO a FROM public.staff_responsibilities WHERE id=p_id FOR UPDATE;
 PERFORM public.setup_actor(a.institution_id);
 IF length(btrim(coalesce(p_reason,'')))<10 THEN RAISE EXCEPTION 'assignment change reason required' USING ERRCODE='22023'; END IF;
 UPDATE public.staff_responsibilities SET active=false,closed_at=now(),reason=p_reason WHERE id=p_id AND active;
END $$;
CREATE FUNCTION public.create_staff_record(p_institution uuid,p_details jsonb,p_roles text[],p_assignments jsonb DEFAULT '[]') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid; result uuid; assignment jsonb;
BEGIN
 actor:=public.setup_actor(p_institution);
 IF length(btrim(coalesce(p_details->>'staff_code','')))<1 OR jsonb_typeof(p_assignments) IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_assignments)>50 THEN RAISE EXCEPTION 'staff ID and bounded assignments required' USING ERRCODE='22023'; END IF;
 INSERT INTO public.staff_records(institution_id,full_name,email,phone,staff_code,primary_department_id,designation,created_by)
 VALUES(p_institution,btrim(p_details->>'full_name'),lower(btrim(p_details->>'email')),coalesce(p_details->>'phone',''),
  btrim(p_details->>'staff_code'),nullif(p_details->>'primary_department_id','')::uuid,btrim(p_details->>'designation'),actor) RETURNING id INTO result;
 PERFORM public.set_staff_roles(result,p_roles,'Initial role selection by institution administrator.');
 FOR assignment IN SELECT * FROM jsonb_array_elements(p_assignments) LOOP PERFORM public.add_staff_responsibility(result,assignment); END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION public.update_staff_record(p_staff uuid,p_details jsonb,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.staff_records;
BEGIN
 SELECT * INTO s FROM public.staff_records WHERE id=p_staff FOR UPDATE;
 PERFORM public.setup_actor(s.institution_id);
 IF length(btrim(coalesce(p_reason,'')))<10 OR p_details->>'email' IS DISTINCT FROM s.email THEN
  RAISE EXCEPTION 'specific reason required; verified invitation identity cannot be changed here' USING ERRCODE='22023'; END IF;
 UPDATE public.staff_records SET full_name=btrim(p_details->>'full_name'),phone=coalesce(p_details->>'phone',''),
  staff_code=nullif(btrim(p_details->>'staff_code'),''),primary_department_id=nullif(p_details->>'primary_department_id','')::uuid,
  designation=btrim(p_details->>'designation'),updated_at=now() WHERE id=p_staff;
 -- Record the operator's explanation separately without altering older profile revisions.
 INSERT INTO public.staff_setup_audit(institution_id,actor_profile_id,action,entity_type,entity_id,current)
 VALUES(s.institution_id,public.current_profile_id(),'profile.edit_reason','staff_records',p_staff,jsonb_build_object('reason',p_reason));
END $$;

CREATE FUNCTION public.staff_invitation_context(p_staff uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.staff_records;
BEGIN
 SELECT * INTO s FROM public.staff_records WHERE id=p_staff FOR UPDATE;
 PERFORM public.setup_actor(s.institution_id);
 IF s.status NOT IN ('draft','invited') OR NOT EXISTS(SELECT 1 FROM public.staff_role_grants WHERE staff_id=s.id AND active) THEN
  RAISE EXCEPTION 'staff record is not awaiting invitation' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.staff_invitations WHERE institution_id=s.institution_id AND created_at>now()-interval '1 hour')>=30 THEN
  RAISE EXCEPTION 'institution invitation limit reached' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('id',s.id,'institution_id',s.institution_id,'email',s.email,'name',s.full_name);
END $$;
CREATE FUNCTION public.prepare_staff_invitation(p_staff uuid,p_auth_user uuid,p_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.staff_records; actor uuid; target public.profiles; result uuid;
BEGIN
 PERFORM public.staff_invitation_context(p_staff);
 SELECT * INTO s FROM public.staff_records WHERE id=p_staff FOR UPDATE;
 actor:=public.setup_actor(s.institution_id);
 SELECT p.* INTO target FROM public.profiles p JOIN auth.users u ON u.id=p.auth_user_id WHERE u.id=p_auth_user AND lower(u.email)=s.email
  AND p.status='active' AND p.student_id IS NULL;
 IF target.id IS NULL OR EXISTS(SELECT 1 FROM public.profile_institutions WHERE profile_id=target.id AND institution_id=s.institution_id AND status<>'invited') THEN
  RAISE EXCEPTION 'identity is unavailable or already belongs to the institution' USING ERRCODE='42501'; END IF;
 UPDATE public.staff_invitations SET superseded_at=now() WHERE staff_id=s.id AND accepted_at IS NULL AND superseded_at IS NULL;
 INSERT INTO public.profile_institutions(profile_id,institution_id,status,invited_at,invited_by)
 VALUES(target.id,s.institution_id,'invited',now(),actor)
 ON CONFLICT(profile_id,institution_id) DO UPDATE SET invited_at=now(),invited_by=actor WHERE public.profile_institutions.status='invited';
 UPDATE public.staff_records SET profile_id=target.id,status='invited',updated_at=now() WHERE id=s.id;
 INSERT INTO public.staff_invitations(institution_id,staff_id,auth_user_id,token_hash,expires_at,created_by)
 VALUES(s.institution_id,s.id,p_auth_user,p_hash,now()+interval '7 days',actor) RETURNING id INTO result;
 RETURN result;
END $$;
CREATE FUNCTION public.accept_staff_setup_invitation(p_token text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE invitation public.staff_invitations; s public.staff_records; verified_email text;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' OR NOT public.has_current_policy_acceptance(auth.uid()) THEN
  RAISE EXCEPTION 'verified invitation and current policies required' USING ERRCODE='42501'; END IF;
 SELECT lower(email) INTO verified_email FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL;
 -- SHA-256 is provided by pgcrypto in Supabase; use built-in sha256(bytea) for portable PostgreSQL.
 SELECT * INTO invitation FROM public.staff_invitations WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') FOR UPDATE;
 SELECT * INTO s FROM public.staff_records WHERE id=invitation.staff_id FOR UPDATE;
 IF invitation.id IS NULL OR invitation.auth_user_id IS DISTINCT FROM auth.uid() OR verified_email IS DISTINCT FROM s.email
  OR invitation.expires_at<=now() OR invitation.accepted_at IS NOT NULL OR invitation.superseded_at IS NOT NULL
  OR s.status<>'invited' OR s.profile_id IS DISTINCT FROM public.current_profile_id()
  OR NOT EXISTS(SELECT 1 FROM public.institutions WHERE id=s.institution_id AND status='active')
  OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=s.profile_id AND status='active')
  OR NOT EXISTS(SELECT 1 FROM public.profile_institutions WHERE profile_id=s.profile_id AND institution_id=s.institution_id AND status='invited') THEN
  RAISE EXCEPTION 'invitation invalid, expired, used or identity mismatch' USING ERRCODE='42501'; END IF;
 UPDATE public.profile_institutions SET status='active',activated_at=now() WHERE profile_id=s.profile_id AND institution_id=s.institution_id;
 UPDATE public.staff_records SET status='active',updated_at=now() WHERE id=s.id;
 UPDATE public.staff_invitations SET accepted_at=now() WHERE id=invitation.id;
 RETURN s.institution_id;
END $$;
DO $$
DECLARE n text;
BEGIN
 FOR n IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public'
 AND p.proname IN ('institution_setup_profile','save_institution_setup_profile','set_institution_setup_logo','create_academic_entity','set_staff_roles','add_staff_responsibility','close_staff_responsibility','create_staff_record','update_staff_record','staff_invitation_context','prepare_staff_invitation','accept_staff_setup_invitation') LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||n||' FROM PUBLIC,anon'; EXECUTE 'GRANT EXECUTE ON FUNCTION '||n||' TO authenticated';
 END LOOP;
END $$;
COMMIT;
