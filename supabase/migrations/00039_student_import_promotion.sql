BEGIN;
CREATE FUNCTION public.validate_student_import_row(p_institution uuid,p_row jsonb,p_rows jsonb,p_number integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE errors text[]:='{}'; warnings text[]:='{}'; matches jsonb:='[]'; possible jsonb:='[]';
 department public.academic_departments; program public.academic_programs; term public.academic_terms; entry_term public.academic_terms;
 section public.academic_sections; cohort public.student_cohorts; s public.students; action text:=coalesce(nullif(p_row->>'action',''),'create');
 admission text:=public.student_identifier(p_row->>'admission_number'); roll_value text:=public.student_identifier(p_row->>'roll_number'); from_day date; admission_day date;
BEGIN
 IF action='skip' THEN RETURN jsonb_build_object('row_number',p_number,'data',p_row,'errors','[]'::jsonb,'warnings','[]'::jsonb,'outcome','skipped'); END IF;
 IF action NOT IN ('create','enroll_existing') THEN errors:=array_append(errors,'Choose create, enroll_existing or skip.'); END IF;
 IF length(btrim(coalesce(p_row->>'full_name',''))) NOT BETWEEN 2 AND 120 OR admission IS NULL OR length(coalesce(p_row->>'admission_number',''))>80
 OR length(coalesce(p_row->>'roll_number',''))>80 THEN errors:=array_append(errors,'Full name and admission number are required; identifiers are at most 80 characters.'); END IF;
 IF p_row->>'entry_type' IS NULL OR p_row->>'entry_type' NOT IN ('normal','lateral','transfer') THEN errors:=array_append(errors,'Entry type must be normal, lateral or transfer.'); END IF;
 IF coalesce(p_row->>'admitted_on','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(p_row->>'starts_on','') !~ '^\d{4}-\d{2}-\d{2}$' THEN errors:=array_append(errors,'Admission and placement dates must be YYYY-MM-DD.');
 ELSE admission_day:=(p_row->>'admitted_on')::date;from_day:=(p_row->>'starts_on')::date;IF admission_day>from_day THEN errors:=array_append(errors,'Placement cannot precede actual admission.'); END IF;END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_rows) x WHERE coalesce(x->>'action','create')<>'skip' AND public.student_identifier(x->>'admission_number')=admission)>1 THEN errors:=array_append(errors,'Duplicate admission number in this import.'); END IF;
 IF roll_value IS NOT NULL AND (SELECT count(*) FROM jsonb_array_elements(p_rows) x WHERE coalesce(x->>'action','create')<>'skip' AND public.student_identifier(x->>'roll_number')=roll_value)>1 THEN errors:=array_append(errors,'Duplicate roll number in this import.'); END IF;
 SELECT * INTO department FROM public.academic_departments WHERE institution_id=p_institution AND lower(code)=lower(btrim(p_row->>'department_code'));
 SELECT * INTO program FROM public.academic_programs WHERE institution_id=p_institution AND lower(code)=lower(btrim(p_row->>'program_code'));
 SELECT * INTO term FROM public.academic_terms WHERE institution_id=p_institution AND program_id=program.id AND name=p_row->>'term_name' AND academic_year=p_row->>'academic_year';
 SELECT * INTO entry_term FROM public.academic_terms WHERE institution_id=p_institution AND program_id=program.id AND name=p_row->>'entry_term_name' AND academic_year=p_row->>'entry_academic_year';
 SELECT * INTO section FROM public.academic_sections WHERE institution_id=p_institution AND term_id=term.id AND name=p_row->>'section_name';
 SELECT * INTO cohort FROM public.student_cohorts WHERE institution_id=p_institution AND lower(code)=lower(btrim(p_row->>'cohort_code'));
 IF department.id IS NULL OR program.department_id IS DISTINCT FROM department.id THEN errors:=array_append(errors,'Unknown or mismatched department/program code.'); END IF;
 IF term.id IS NULL OR entry_term.id IS NULL OR from_day NOT BETWEEN term.starts_on AND term.ends_on OR entry_term.starts_on>from_day THEN errors:=array_append(errors,'Unknown/invalid current or actual entry term, academic year or placement date.'); END IF;
 IF nullif(p_row->>'entry_year','') IS NOT NULL AND (p_row->>'entry_year')::integer IS DISTINCT FROM entry_term.year_number THEN errors:=array_append(errors,'Entry year does not match the actual entry term.'); END IF;
 IF nullif(p_row->>'current_year','') IS NOT NULL AND (p_row->>'current_year')::integer IS DISTINCT FROM term.year_number THEN errors:=array_append(errors,'Current year does not match the selected term.'); END IF;
 IF section.id IS NULL THEN errors:=array_append(errors,'Unknown section for the selected term.'); END IF;
 IF cohort.id IS NULL OR cohort.program_id IS DISTINCT FROM program.id THEN errors:=array_append(errors,'Unknown or mismatched cohort.'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'admission_number',x.admission_number,'roll_number',x.roll)),'[]') INTO matches
 FROM public.students x WHERE x.institution_id=p_institution AND ((admission IS NOT NULL AND public.student_identifier(x.admission_number)=admission) OR (roll_value IS NOT NULL AND public.student_identifier(x.roll)=roll_value));
 IF jsonb_array_length(matches)>0 THEN
  SELECT * INTO s FROM public.students WHERE institution_id=p_institution AND public.student_identifier(admission_number)=admission;
  IF action<>'enroll_existing' THEN errors:=array_append(errors,'Existing student found: explicitly enroll this identity or skip; never create a duplicate.');
  ELSIF s.id IS NULL OR s.id::text IS DISTINCT FROM p_row->>'existing_student_id' OR jsonb_array_length(matches)<>1 OR s.academic_managed OR s.enrollment_status<>'active'
   OR (roll_value IS NOT NULL AND public.student_identifier(s.roll) IS DISTINCT FROM roll_value) OR public.student_identifier(s.name) IS DISTINCT FROM public.student_identifier(p_row->>'full_name') THEN
   errors:=array_append(errors,'Existing identity is ambiguous, differs or already enrolled. Correct the row or use the existing student profile/placement tools.'); END IF;
  IF s.legacy_roster_linked AND from_day>public.setup_today(p_institution) THEN errors:=array_append(errors,'Apply legacy attendance-linked enrollment on its effective date to keep the class projection consistent.'); END IF;
 ELSIF action='enroll_existing' THEN errors:=array_append(errors,'Selected existing identity does not match this admission number.'); END IF;
 IF jsonb_array_length(matches)=0 THEN
  SELECT coalesce(jsonb_agg(q),'[]') INTO possible FROM (SELECT x.id,x.name,x.admission_number,x.roll FROM public.students x WHERE x.institution_id=p_institution
   AND public.student_identifier(x.name)=public.student_identifier(p_row->>'full_name') LIMIT 10) q;
  IF jsonb_array_length(possible)>0 THEN warnings:=array_append(warnings,'Possible same-name student: review identity; no automatic merge.');
   IF coalesce(p_row->>'duplicate_acknowledged','false')<>'true' THEN errors:=array_append(errors,'Explicitly acknowledge possible duplicates or skip/correct the row.'); END IF;
  END IF;
 END IF;
 IF roll_value IS NULL THEN warnings:=array_append(warnings,'Roll number not supplied.'); END IF;
 IF p_row->>'entry_type' IN ('lateral','transfer') THEN warnings:=array_append(warnings,'Only the actual entry/current placement is recorded; no earlier history will be invented.'); END IF;
 RETURN jsonb_build_object('row_number',p_number,'data',p_row,'errors',to_jsonb(errors),'warnings',to_jsonb(warnings),'existing_students',matches,'potential_duplicates',possible,
 'outcome',CASE WHEN cardinality(errors)>0 THEN 'rejected' ELSE 'valid' END,'student_version',s.academic_version,
 'normalized',jsonb_build_object('student_id',s.id,'section_id',section.id,'term_id',term.id,'cohort_id',cohort.id,'entry_term_id',entry_term.id,'starts_on',from_day));
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR numeric_value_out_of_range THEN
 RETURN jsonb_build_object('row_number',p_number,'data',p_row,'errors',jsonb_build_array('Invalid date, year or identifier format.'),'warnings','[]'::jsonb,'outcome','rejected');
END $$;
CREATE FUNCTION public.student_import_preview(p_institution uuid,p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb:='[]'; row_value jsonb; n integer:=0;
BEGIN
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 OR octet_length(p_rows::text)>2000000 THEN RAISE EXCEPTION 'import must contain 1–500 bounded rows' USING ERRCODE='22023'; END IF;
 FOR row_value IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(row_value)<>'object' OR octet_length(row_value::text)>4000 THEN RAISE EXCEPTION 'invalid or oversized import row' USING ERRCODE='22023'; END IF;
  n:=n+1;result:=result||jsonb_build_array(public.validate_student_import_row(p_institution,row_value,p_rows,n));
 END LOOP;RETURN result;
END $$;
CREATE FUNCTION public.stage_student_import(p_institution uuid,p_filename text,p_sha256 text,p_rows jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result public.student_import_batches; actor uuid; preview jsonb;
BEGIN
 actor:=public.student_academic_actor(p_institution,NULL,true);PERFORM public.lock_staff_lifecycle(p_institution);
 preview:=public.student_import_preview(p_institution,p_rows);
 IF p_sha256 IS NULL OR p_filename !~* '\.(csv|xlsx)$' OR (SELECT count(*) FROM public.student_import_batches WHERE institution_id=p_institution AND created_at>now()-interval '1 hour')>=30 THEN RAISE EXCEPTION 'valid bounded file/import context required' USING ERRCODE='22023'; END IF;
 INSERT INTO public.student_import_batches(institution_id,kind,filename,file_sha256,rows,preview,created_by,reason)
 VALUES(p_institution,'import',p_filename,p_sha256,p_rows,preview,actor,p_reason) RETURNING * INTO result;
 PERFORM public.student_academic_event(p_institution,NULL,result.id,'import.previewed',NULL,jsonb_build_object('file',p_filename,'sha256',p_sha256,'rows',jsonb_array_length(p_rows)),p_reason);RETURN to_jsonb(result);
END $$;
CREATE FUNCTION public.revise_student_import(p_batch uuid,p_revision integer,p_rows jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.student_import_batches; old_rows jsonb;
BEGIN
 SELECT * INTO b FROM public.student_import_batches WHERE id=p_batch;PERFORM public.student_academic_actor(b.institution_id,NULL,true);PERFORM public.lock_staff_lifecycle(b.institution_id);
 SELECT * INTO b FROM public.student_import_batches WHERE id=p_batch FOR UPDATE;
 IF b.kind<>'import' OR b.created_by<>public.current_profile_id() OR b.status<>'preview' OR b.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'current editable import preview required' USING ERRCODE='42501'; END IF;
 old_rows:=b.rows;
 UPDATE public.student_import_batches SET rows=p_rows,preview=public.student_import_preview(b.institution_id,p_rows),revision=revision+1,reason=p_reason WHERE id=b.id RETURNING * INTO b;
 PERFORM public.student_academic_event(b.institution_id,NULL,b.id,'import.rows_corrected',old_rows,p_rows,p_reason);RETURN to_jsonb(b);
END $$;
CREATE FUNCTION public.commit_student_import(p_batch uuid,p_revision integer,p_selected integer[],p_confirmation text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.student_import_batches; old_preview jsonb; fresh jsonb; row_value jsonb; original jsonb; s public.students; sid uuid; commit_result jsonb:='[]'; n integer;
BEGIN
 SELECT * INTO b FROM public.student_import_batches WHERE id=p_batch;PERFORM public.student_academic_actor(b.institution_id,NULL,true);PERFORM public.lock_staff_lifecycle(b.institution_id);
 SELECT * INTO b FROM public.student_import_batches WHERE id=p_batch FOR UPDATE;
 IF b.kind<>'import' OR b.created_by<>public.current_profile_id() OR b.status<>'preview' OR b.revision IS DISTINCT FROM p_revision
 OR p_selected IS NULL OR cardinality(p_selected) NOT BETWEEN 1 AND 500 OR cardinality(p_selected)<>(SELECT count(DISTINCT x) FROM unnest(p_selected) x)
 OR p_confirmation IS DISTINCT FROM 'IMPORT '||cardinality(p_selected)::text THEN RAISE EXCEPTION 'current preview, selected valid rows and explicit IMPORT count required' USING ERRCODE='42501'; END IF;
 old_preview:=b.preview;fresh:=public.student_import_preview(b.institution_id,b.rows);
 FOREACH n IN ARRAY p_selected LOOP
  row_value:=fresh->(n-1);original:=old_preview->(n-1);
  IF n<1 OR row_value IS NULL OR row_value->>'outcome'<>'valid' OR row_value->'student_version' IS DISTINCT FROM original->'student_version' THEN RAISE EXCEPTION 'selected row is rejected, ambiguous or stale; correct and preview again' USING ERRCODE='42501'; END IF;
  IF row_value->'data'->>'action'='enroll_existing' THEN
   sid:=(row_value->'normalized'->>'student_id')::uuid;
   SELECT * INTO s FROM public.students WHERE id=sid FOR UPDATE;
   UPDATE public.students SET admitted_on=(row_value->'data'->>'admitted_on')::date,entry_type=row_value->'data'->>'entry_type',entry_term_id=(row_value->'normalized'->>'entry_term_id')::uuid,
    entry_cohort_id=(row_value->'normalized'->>'cohort_id')::uuid,academic_managed=true,academic_version=academic_version+1,updated_at=now() WHERE id=sid;
  ELSE
   INSERT INTO public.students(institution_id,name,admission_number,roll,status,admitted_on,entry_type,entry_term_id,entry_cohort_id,academic_managed)
    VALUES(b.institution_id,btrim(row_value->'data'->>'full_name'),btrim(row_value->'data'->>'admission_number'),nullif(btrim(row_value->'data'->>'roll_number'),''),NULL,
     (row_value->'data'->>'admitted_on')::date,row_value->'data'->>'entry_type',(row_value->'normalized'->>'entry_term_id')::uuid,(row_value->'normalized'->>'cohort_id')::uuid,true) RETURNING id INTO sid;
  END IF;
  PERFORM public.apply_student_placement(sid,(row_value->'normalized')||jsonb_build_object('change_type','entry'),(SELECT academic_version FROM public.students WHERE id=sid),p_reason,b.id);
  PERFORM public.student_academic_event(b.institution_id,sid,b.id,'student.imported',CASE WHEN s.id=sid THEN jsonb_build_object('existing_id',s.id) END,row_value->'data',p_reason);
  commit_result:=commit_result||jsonb_build_array(jsonb_build_object('row_number',n,'student_id',sid));
 END LOOP;
 UPDATE public.student_import_batches SET status='committed',committed_at=now(),preview=fresh,result=commit_result WHERE id=b.id;
 PERFORM public.student_academic_event(b.institution_id,NULL,b.id,'import.committed',NULL,commit_result,p_reason);RETURN commit_result;
END $$;
-- Promotion is a second durable preview: selected individuals and explicit
-- exclusions/repeats/breaks override the shared cohort target.
CREATE FUNCTION public.promotion_rows_preview(p_institution uuid,p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb:='[]'; r jsonb; s public.students; old public.student_placements; target public.academic_sections; cohort public.student_cohorts; term public.academic_terms; errors text[]; n integer:=0;
BEGIN
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'bounded promotion rows required' USING ERRCODE='22023'; END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
  n:=n+1;errors:='{}';
  SELECT * INTO s FROM public.students WHERE id=(r->>'student_id')::uuid AND institution_id=p_institution;
  SELECT * INTO old FROM public.student_placements WHERE student_id=s.id AND closed_at IS NULL;
  IF s.id IS NULL OR old.id IS NULL OR NOT public.student_scope_allowed(p_institution,old.section_id,true) THEN RAISE EXCEPTION 'promotion source outside authorized scope' USING ERRCODE='42501'; END IF;
  IF coalesce(r->>'action','promote') NOT IN ('promote','repeat','exclude','break') THEN errors:=array_append(errors,'Unknown promotion exception.'); END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_rows) x WHERE x->>'student_id'=s.id::text)>1 THEN errors:=array_append(errors,'Student selected more than once.'); END IF;
  IF coalesce(r->>'action','promote') NOT IN ('exclude','break') THEN
   SELECT * INTO target FROM public.academic_sections WHERE id=(r->>'section_id')::uuid AND institution_id=p_institution;
   SELECT * INTO term FROM public.academic_terms WHERE id=target.term_id;
   SELECT * INTO cohort FROM public.student_cohorts WHERE id=(r->>'cohort_id')::uuid AND institution_id=p_institution;
   IF target.id IS NULL OR cohort.program_id IS DISTINCT FROM target.program_id OR NOT public.student_scope_allowed(p_institution,target.id,true)
   OR (r->>'starts_on')::date NOT BETWEEN term.starts_on AND term.ends_on OR (r->>'starts_on')::date<=old.starts_on OR s.enrollment_status<>'active' THEN errors:=array_append(errors,'Invalid promotion target, date, state or scope.'); END IF;
   IF s.legacy_roster_linked AND (r->>'starts_on')::date>public.setup_today(p_institution) THEN errors:=array_append(errors,'Apply legacy attendance-linked promotion on its effective date.'); END IF;
  END IF;
  result:=result||jsonb_build_array(jsonb_build_object('row_number',n,'data',r,'name',s.name,'student_version',s.academic_version,'placement_id',old.id,'errors',to_jsonb(errors),'warnings','[]'::jsonb,'outcome',CASE WHEN r->>'action'='exclude' THEN 'skipped' WHEN cardinality(errors)>0 THEN 'rejected' ELSE 'valid' END));
 END LOOP;RETURN result;
END $$;
CREATE FUNCTION public.stage_student_promotion(p_institution uuid,p_rows jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result public.student_import_batches; preview jsonb;
BEGIN
 IF octet_length(p_rows::text)>1000000 THEN RAISE EXCEPTION 'promotion request too large' USING ERRCODE='22023'; END IF;
 PERFORM public.lock_staff_lifecycle(p_institution);preview:=public.promotion_rows_preview(p_institution,p_rows);
 INSERT INTO public.student_import_batches(institution_id,kind,filename,rows,preview,created_by,reason) VALUES(p_institution,'promotion','cohort promotion',p_rows,preview,public.current_profile_id(),p_reason) RETURNING * INTO result;
 PERFORM public.student_academic_event(p_institution,NULL,result.id,'promotion.previewed',NULL,p_rows,p_reason);RETURN to_jsonb(result);
END $$;
CREATE FUNCTION public.commit_student_promotion(p_batch uuid,p_revision integer,p_confirmation text,p_reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.student_import_batches; fresh jsonb; r jsonb; original jsonb; n integer:=0; count_value integer;
BEGIN
 SELECT * INTO b FROM public.student_import_batches WHERE id=p_batch;PERFORM public.lock_staff_lifecycle(b.institution_id);
 SELECT * INTO b FROM public.student_import_batches WHERE id=p_batch FOR UPDATE;
 IF b.kind<>'promotion' OR b.created_by<>public.current_profile_id() OR b.status<>'preview' OR b.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'current authorized promotion preview required' USING ERRCODE='42501'; END IF;
 fresh:=public.promotion_rows_preview(b.institution_id,b.rows);
 SELECT count(*) INTO count_value FROM jsonb_array_elements(fresh) x WHERE x->>'outcome'='valid';
 IF count_value=0 OR p_confirmation IS DISTINCT FROM 'PROMOTE '||count_value::text OR EXISTS(SELECT 1 FROM jsonb_array_elements(fresh) x WHERE x->>'outcome'='rejected') THEN RAISE EXCEPTION 'resolve promotion errors and explicitly confirm PROMOTE count' USING ERRCODE='42501'; END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(fresh) LOOP
  n:=n+1;original:=b.preview->(n-1);
  IF r->'student_version' IS DISTINCT FROM original->'student_version' OR r->'placement_id' IS DISTINCT FROM original->'placement_id' THEN RAISE EXCEPTION 'student changed since promotion preview' USING ERRCODE='42501'; END IF;
  IF r->>'outcome'='skipped' THEN CONTINUE; END IF;
  IF r->'data'->>'action'='break' THEN PERFORM public.change_student_academic_status((r->'data'->>'student_id')::uuid,'inactive',(r->>'student_version')::bigint,p_reason);
  ELSE PERFORM public.apply_student_placement((r->'data'->>'student_id')::uuid,r->'data'||jsonb_build_object('change_type',CASE WHEN r->'data'->>'action'='repeat' THEN 'repeat' ELSE 'promotion' END),(r->>'student_version')::bigint,p_reason,b.id);END IF;
 END LOOP;
 UPDATE public.student_import_batches SET status='committed',committed_at=now(),result=jsonb_build_object('changed',count_value) WHERE id=b.id;
 PERFORM public.student_academic_event(b.institution_id,NULL,b.id,'promotion.committed',b.preview,fresh,p_reason);RETURN count_value;
END $$;
DO $$ DECLARE f text;
BEGIN
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('validate_student_import_row','student_import_preview','promotion_rows_preview','stage_student_import','revise_student_import','commit_student_import','stage_student_promotion','commit_student_promotion') LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||f||' FROM PUBLIC,anon,authenticated';END LOOP;
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('stage_student_import','revise_student_import','commit_student_import','stage_student_promotion','commit_student_promotion') LOOP
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||f||' TO authenticated';END LOOP;
END $$;
COMMIT;
