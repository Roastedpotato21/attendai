BEGIN;
ALTER TABLE public.student_import_batches DROP CONSTRAINT student_import_batches_kind_check;
ALTER TABLE public.student_import_batches ADD CHECK(kind IN ('import','promotion','guardian_import'));
-- Guardian-bearing previews contain private contacts: owner/admin and creator only.
DROP POLICY student_import_read ON public.student_import_batches;
CREATE POLICY student_import_read ON public.student_import_batches FOR SELECT TO authenticated USING(created_by=public.current_profile_id() AND public.is_institution_member(institution_id) AND public.has_current_policy_acceptance(auth.uid()) AND (kind='promotion' OR public.setup_is_admin(institution_id)));
CREATE FUNCTION public.guardian_import_row(p_institution uuid,p_student uuid,p_data jsonb,p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c jsonb; errors jsonb;from_day date;until_day date;relationship text;
BEGIN
 c:=public.guardian_candidate(p_institution,p_data);errors:=c->'errors';
 relationship:=p_data->>'guardian_relationship';
 IF relationship NOT IN ('father','mother','guardian','other') OR relationship IS NULL THEN errors:=errors||jsonb_build_array('Choose father, mother, guardian or other relationship.');END IF;
 IF coalesce(nullif(p_data->>'guardian_is_primary',''),'false') NOT IN ('true','false') OR coalesce(nullif(p_data->>'guardian_receives_notifications',''),'false') NOT IN ('true','false') THEN errors:=errors||jsonb_build_array('Guardian preference fields must be literal true or false.'); END IF;
 from_day:=coalesce(nullif(p_data->>'guardian_effective_from',''),p_data->>'starts_on')::date;until_day:=nullif(p_data->>'guardian_effective_until','')::date;
 IF from_day IS NULL OR from_day>public.setup_today(p_institution) OR until_day<public.setup_today(p_institution) OR until_day<from_day THEN errors:=errors||jsonb_build_array('Supply actual guardian effective date on/before today and an optional future/current cutoff.'); END IF;
 IF p_student IS NOT NULL AND EXISTS(SELECT 1 FROM public.student_guardian_relationships WHERE student_id=p_student AND status='active' AND coalesce(effective_until,'infinity')>=from_day AND (guardian_id=(c->>'guardian_id')::uuid OR (is_primary AND p_data->>'guardian_is_primary'='true'))) THEN errors:=errors||jsonb_build_array('Active relationship or primary already exists; review/change the student profile rather than importing over history.');END IF;
 IF nullif(p_data->>'guardian_id','') IS NULL AND (SELECT count(*) FROM jsonb_array_elements(p_rows) x WHERE coalesce(x->>'action','')<>'skip' AND nullif(x->>'guardian_id','') IS NULL AND public.guardian_phone(x->>'guardian_mobile')=c->>'phone_normalized' AND public.student_identifier(x->>'guardian_name')=public.student_identifier(p_data->>'guardian_name'))>1 THEN errors:=errors||jsonb_build_array('Same new guardian occurs multiple times: import one first, then explicitly reuse its identity in the other rows.');END IF;
 RETURN c||jsonb_build_object('errors',errors,'relationship',jsonb_build_object('relationship',relationship,'is_primary',coalesce(nullif(p_data->>'guardian_is_primary',''),'false'),'receives_notifications',coalesce(nullif(p_data->>'guardian_receives_notifications',''),'false'),'effective_from',from_day,'effective_until',until_day));
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN RETURN jsonb_build_object('errors',jsonb_build_array('Invalid guardian date or identifier.'),'matches','[]'::jsonb);END $$;
ALTER FUNCTION public.student_import_preview(uuid,jsonb) RENAME TO student_import_preview_before_guardians;
CREATE FUNCTION public.student_import_preview(p_institution uuid,p_rows jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE preview jsonb;result jsonb:='[]';r jsonb;g jsonb;
BEGIN
 preview:=public.student_import_preview_before_guardians(p_institution,p_rows);
 FOR r IN SELECT * FROM jsonb_array_elements(preview) LOOP
  IF r->>'outcome'<>'skipped' AND (nullif(r->'data'->>'guardian_name','') IS NOT NULL OR nullif(r->'data'->>'guardian_mobile','') IS NOT NULL OR nullif(r->'data'->>'guardian_email','') IS NOT NULL OR nullif(r->'data'->>'guardian_relationship','') IS NOT NULL OR nullif(r->'data'->>'guardian_id','') IS NOT NULL) THEN
   g:=public.guardian_import_row(p_institution,(r->'normalized'->>'student_id')::uuid,r->'data',p_rows);
   r:=r||jsonb_build_object('guardian',g,'errors',(r->'errors')||(g->'errors'),'warnings',(r->'warnings')||jsonb_build_array('Guardian preference is separate from consent; import grants no communication or device consent.'));
   IF jsonb_array_length(r->'errors')>0 THEN r:=r||jsonb_build_object('outcome','rejected');END IF;
  END IF;result:=result||jsonb_build_array(r);
 END LOOP;RETURN result;
END $$;
ALTER FUNCTION public.commit_student_import(uuid,integer,integer[],text,text) RENAME TO commit_student_import_before_guardians;
CREATE FUNCTION public.commit_student_import(p_batch uuid,p_revision integer,p_selected integer[],p_confirmation text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.student_import_batches;fresh jsonb;result jsonb;r jsonb;g jsonb;n integer;
BEGIN
 SELECT * INTO b FROM public.student_import_batches WHERE id=p_batch;PERFORM public.lock_staff_lifecycle(b.institution_id);PERFORM public.student_academic_actor(b.institution_id,NULL,true);
 SELECT * INTO b FROM public.student_import_batches WHERE id=p_batch FOR UPDATE;fresh:=public.student_import_preview(b.institution_id,b.rows);
 IF p_selected IS NULL THEN RAISE EXCEPTION 'selected valid rows required' USING ERRCODE='42501';END IF;
 FOREACH n IN ARRAY p_selected LOOP
  IF fresh->(n-1)->'guardian'->'contact_version' IS DISTINCT FROM b.preview->(n-1)->'guardian'->'contact_version' THEN RAISE EXCEPTION 'guardian changed since preview; review again' USING ERRCODE='42501';END IF;
 END LOOP;
 result:=public.commit_student_import_before_guardians(p_batch,p_revision,p_selected,p_confirmation,p_reason);
 FOR r IN SELECT * FROM jsonb_array_elements(result) LOOP
  n:=(r->>'row_number')::integer;g:=fresh->(n-1)->'guardian';
  IF g IS NOT NULL THEN PERFORM public.link_student_guardian((r->>'student_id')::uuid,b.rows->(n-1),g->'relationship',(g->>'contact_version')::bigint,p_reason);END IF;
 END LOOP;RETURN result;
END $$;
CREATE FUNCTION public.guardian_relationship_import_preview(p_institution uuid,p_rows jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb:='[]';r jsonb;g jsonb;s public.students;errors jsonb;n integer:=0;
BEGIN
 PERFORM public.student_academic_actor(p_institution,NULL,true);
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 OR octet_length(p_rows::text)>2000000 THEN RAISE EXCEPTION '1-500 bounded guardian rows required' USING ERRCODE='22023';END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
  n:=n+1;errors:='[]';g:=NULL;
  IF jsonb_typeof(r)<>'object' OR octet_length(r::text)>4000 THEN RAISE EXCEPTION 'invalid guardian row' USING ERRCODE='22023';END IF;
  SELECT * INTO s FROM public.students WHERE institution_id=p_institution AND public.student_identifier(admission_number)=public.student_identifier(r->>'admission_number');
  IF coalesce(r->>'action','')<>'skip' THEN
   IF s.id IS NULL THEN errors:=errors||jsonb_build_array('Unknown existing student admission number.');END IF;
   g:=public.guardian_import_row(p_institution,s.id,r,p_rows);errors:=errors||(g->'errors');
   IF r->>'guardian_is_primary'='true' AND (SELECT count(*) FROM jsonb_array_elements(p_rows) x WHERE coalesce(x->>'action','')<>'skip' AND public.student_identifier(x->>'admission_number')=public.student_identifier(r->>'admission_number') AND x->>'guardian_is_primary'='true')>1 THEN errors:=errors||jsonb_build_array('More than one primary in this student import.');END IF;
   IF nullif(r->>'guardian_id','') IS NOT NULL AND (SELECT count(*) FROM jsonb_array_elements(p_rows) x WHERE coalesce(x->>'action','')<>'skip' AND public.student_identifier(x->>'admission_number')=public.student_identifier(r->>'admission_number') AND x->>'guardian_id'=r->>'guardian_id')>1 THEN errors:=errors||jsonb_build_array('Duplicate student/guardian relationship in this file.');END IF;
  END IF;
  result:=result||jsonb_build_array(jsonb_build_object('row_number',n,'data',r,'guardian',g,'student_id',s.id,'student_version',s.academic_version,'errors',errors,'warnings',jsonb_build_array('Import records contacts and preferences only; consent remains separate.'),'outcome',CASE WHEN r->>'action'='skip' THEN 'skipped' WHEN jsonb_array_length(errors)>0 THEN 'rejected' ELSE 'valid' END));
 END LOOP;RETURN result;
END $$;
CREATE FUNCTION public.stage_guardian_relationship_import(p_institution uuid,p_filename text,p_sha256 text,p_rows jsonb,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.student_import_batches;
BEGIN
 PERFORM public.student_academic_actor(p_institution,NULL,true);PERFORM public.lock_staff_lifecycle(p_institution);
 IF p_sha256 IS NULL OR p_filename !~* '\.(csv|xlsx)$' OR (SELECT count(*) FROM public.student_import_batches WHERE institution_id=p_institution AND created_at>now()-interval '1 hour')>=30 THEN RAISE EXCEPTION 'bounded reviewed guardian file required' USING ERRCODE='22023';END IF;
 INSERT INTO public.student_import_batches(institution_id,kind,filename,file_sha256,rows,preview,created_by,reason) VALUES(p_institution,'guardian_import',p_filename,p_sha256,p_rows,public.guardian_relationship_import_preview(p_institution,p_rows),public.current_profile_id(),p_reason) RETURNING * INTO b;
 PERFORM public.student_academic_event(p_institution,NULL,b.id,'guardian_import.previewed',NULL,jsonb_build_object('filename',p_filename,'sha256',p_sha256,'rows',jsonb_array_length(p_rows)),p_reason);RETURN to_jsonb(b);
END $$;
CREATE FUNCTION public.revise_guardian_relationship_import(p_batch uuid,p_revision integer,p_rows jsonb,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.student_import_batches;old_rows jsonb;
BEGIN
 SELECT * INTO b FROM public.student_import_batches WHERE id=p_batch;PERFORM public.student_academic_actor(b.institution_id,NULL,true);PERFORM public.lock_staff_lifecycle(b.institution_id);
 SELECT * INTO b FROM public.student_import_batches WHERE id=p_batch FOR UPDATE;
 IF b.kind<>'guardian_import' OR b.created_by<>public.current_profile_id() OR b.status<>'preview' OR b.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'current editable guardian preview required' USING ERRCODE='42501';END IF;
 old_rows:=b.rows;UPDATE public.student_import_batches SET rows=p_rows,preview=public.guardian_relationship_import_preview(b.institution_id,p_rows),revision=revision+1,reason=p_reason WHERE id=b.id RETURNING * INTO b;
 PERFORM public.student_academic_event(b.institution_id,NULL,b.id,'guardian_import.corrected',old_rows,p_rows,p_reason);RETURN to_jsonb(b);
END $$;
CREATE FUNCTION public.commit_guardian_relationship_import(p_batch uuid,p_revision integer,p_selected integer[],p_confirmation text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.student_import_batches;fresh jsonb;r jsonb;commit_result jsonb:='[]';n integer;rid uuid;
BEGIN
 SELECT * INTO b FROM public.student_import_batches WHERE id=p_batch;PERFORM public.student_academic_actor(b.institution_id,NULL,true);PERFORM public.lock_staff_lifecycle(b.institution_id);
 SELECT * INTO b FROM public.student_import_batches WHERE id=p_batch FOR UPDATE;
 IF b.kind<>'guardian_import' OR b.created_by<>public.current_profile_id() OR b.status<>'preview' OR b.revision IS DISTINCT FROM p_revision OR p_selected IS NULL OR cardinality(p_selected) NOT BETWEEN 1 AND 500 OR cardinality(p_selected)<>(SELECT count(DISTINCT x) FROM unnest(p_selected) x) OR p_confirmation IS DISTINCT FROM 'IMPORT '||cardinality(p_selected)::text THEN RAISE EXCEPTION 'current guardian preview and typed IMPORT count required' USING ERRCODE='42501';END IF;
 fresh:=public.guardian_relationship_import_preview(b.institution_id,b.rows);
 FOREACH n IN ARRAY p_selected LOOP
  r:=fresh->(n-1);
  IF n<1 OR r IS NULL OR r->>'outcome'<>'valid' OR r->'student_version' IS DISTINCT FROM b.preview->(n-1)->'student_version' OR r->'guardian'->'contact_version' IS DISTINCT FROM b.preview->(n-1)->'guardian'->'contact_version' THEN RAISE EXCEPTION 'guardian/student changed or row invalid; correct and preview again' USING ERRCODE='42501';END IF;
  rid:=public.link_student_guardian((r->>'student_id')::uuid,r->'data',r->'guardian'->'relationship',(r->'guardian'->>'contact_version')::bigint,p_reason);
  commit_result:=commit_result||jsonb_build_array(jsonb_build_object('row_number',n,'student_id',r->>'student_id','relationship_id',rid));
 END LOOP;
 UPDATE public.student_import_batches SET status='committed',committed_at=now(),preview=fresh,result=commit_result WHERE id=b.id;
 PERFORM public.student_academic_event(b.institution_id,NULL,b.id,'guardian_import.committed',NULL,commit_result,p_reason);RETURN commit_result;
END $$;
DO $$ DECLARE f text;BEGIN
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('guardian_import_row','student_import_preview','student_import_preview_before_guardians','commit_student_import_before_guardians','commit_student_import','guardian_relationship_import_preview','stage_guardian_relationship_import','revise_guardian_relationship_import','commit_guardian_relationship_import') LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f||' FROM PUBLIC,anon,authenticated';END LOOP;
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('commit_student_import','stage_guardian_relationship_import','revise_guardian_relationship_import','commit_guardian_relationship_import') LOOP EXECUTE 'GRANT EXECUTE ON FUNCTION '||f||' TO authenticated';END LOOP;
END $$;
COMMIT;
