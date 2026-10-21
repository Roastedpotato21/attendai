BEGIN;
CREATE FUNCTION public.guardian_candidate(p_institution uuid,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.parents; mobile text:=public.guardian_phone(p_data->>'guardian_mobile'); errors text[]:='{}'; matches jsonb;
BEGIN
 IF length(btrim(coalesce(p_data->>'guardian_name',''))) NOT BETWEEN 2 AND 120 OR mobile IS NULL THEN errors:=array_append(errors,'Guardian name and an international mobile with explicit +country code are required.'); END IF;
 IF nullif(p_data->>'guardian_email','') IS NOT NULL AND (length(p_data->>'guardian_email')>200 OR p_data->>'guardian_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN errors:=array_append(errors,'Invalid guardian email.'); END IF;
 IF coalesce(nullif(p_data->>'guardian_language',''),'en') NOT IN ('en','hi','te','ta','kn') THEN errors:=array_append(errors,'Unsupported preferred language.'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'phone',phone,'contact_version',contact_version)),'[]') INTO matches FROM public.parents WHERE institution_id=p_institution
 AND (phone_normalized=mobile OR public.student_identifier(name)=public.student_identifier(p_data->>'guardian_name')) AND public.guardian_identity_visible(id);
 IF nullif(p_data->>'guardian_id','') IS NOT NULL THEN
  SELECT * INTO p FROM public.parents WHERE id=(p_data->>'guardian_id')::uuid AND institution_id=p_institution;
  IF p.id IS NULL OR NOT p.active OR NOT public.guardian_identity_visible(p.id) OR public.guardian_phone(p.phone) IS DISTINCT FROM mobile OR public.student_identifier(p.name) IS DISTINCT FROM public.student_identifier(p_data->>'guardian_name') THEN errors:=array_append(errors,'Selected guardian identity is unavailable or differs; review exact name and mobile.'); END IF;
  IF nullif(p_data->>'guardian_email','') IS NOT NULL AND public.student_identifier(p.email) IS DISTINCT FROM public.student_identifier(p_data->>'guardian_email') THEN errors:=array_append(errors,'Existing guardian email differs; review/edit the contact separately before reuse.');END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.parents WHERE institution_id=p_institution AND (phone_normalized=mobile OR public.guardian_phone(phone)=mobile) AND public.student_identifier(name)=public.student_identifier(p_data->>'guardian_name')) THEN errors:=array_append(errors,'An exact guardian candidate already exists; explicitly select the reviewed identity.');
  ELSIF EXISTS(SELECT 1 FROM public.parents WHERE institution_id=p_institution AND (phone_normalized=mobile OR public.guardian_phone(phone)=mobile OR public.student_identifier(name)=public.student_identifier(p_data->>'guardian_name'))) AND coalesce(p_data->>'guardian_distinct_acknowledged','false')<>'true' THEN errors:=array_append(errors,'Possible guardian match; explicitly review and confirm a distinct person or select an existing identity.'); END IF;
 END IF;
 RETURN jsonb_build_object('errors',to_jsonb(errors),'matches',matches,'guardian_id',p.id,'contact_version',p.contact_version,'phone_normalized',mobile);
EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('errors',jsonb_build_array('Invalid guardian identifier.'),'matches','[]'::jsonb);END $$;
CREATE FUNCTION public.student_guardians(p_student uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.can_read_academic_student(p_student) THEN RAISE EXCEPTION 'student unavailable' USING ERRCODE='42501'; END IF;
 IF NOT public.guardian_student_allowed(p_student) THEN RETURN jsonb_build_object('can_manage',false,'relationships','[]'::jsonb);END IF;
 RETURN jsonb_build_object('can_manage',true,'relationships',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.effective_from,q.id),'[]') FROM (
 SELECT r.*,p.name,p.phone,p.phone_normalized,p.email,p.language,p.active guardian_active,p.contact_version,p.contact_metadata,p.communication_consent,
 public.guardian_identity_editable(p.id) can_edit_identity,public.guardian_relationship_eligible(r.institution_id,r.student_id,r.guardian_id) preference_eligible,
 (SELECT count(*)::int FROM public.guardian_notification_installations d WHERE d.institution_id=r.institution_id AND d.guardian_id=r.guardian_id AND d.active AND d.revoked_at IS NULL AND d.permission_state='granted' AND d.firebase_project_id='attendai-41f64' AND d.last_seen_at>now()-interval '90 days' AND EXISTS(SELECT 1 FROM public.guardian_notification_consents c WHERE c.installation_id=d.id AND c.status='accepted' AND c.revoked_at IS NULL AND c.consent_version='2026-10-16.1')) registered_devices
 FROM public.student_guardian_relationships r JOIN public.parents p ON p.id=r.guardian_id AND p.institution_id=r.institution_id WHERE r.student_id=p_student) q));
END $$;
CREATE FUNCTION public.search_student_guardians(p_student uuid,p_query text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE tenant uuid;
BEGIN
 IF NOT public.guardian_student_allowed(p_student) OR length(btrim(p_query)) NOT BETWEEN 3 AND 120 THEN RAISE EXCEPTION 'scoped student and specific search required' USING ERRCODE='42501';END IF;
 SELECT institution_id INTO tenant FROM public.students WHERE id=p_student;
 RETURN (SELECT coalesce(jsonb_agg(q),'[]') FROM (SELECT p.id,p.name,p.phone,p.email,p.language,p.contact_version FROM public.parents p WHERE p.institution_id=tenant AND p.active AND public.guardian_identity_visible(p.id)
 AND (strpos(public.student_identifier(p.name),public.student_identifier(p_query))>0 OR p.phone_normalized=public.guardian_phone(p_query)) ORDER BY p.name,p.id LIMIT 20) q);
END $$;
-- Private projection for compatibility; canonical history lives in the new table.
CREATE FUNCTION public.sync_guardian_projection(p_student uuid,p_guardian uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.student_guardian_relationships;tenant uuid;
BEGIN
 SELECT institution_id INTO tenant FROM public.students WHERE id=p_student;
 SELECT * INTO r FROM public.student_guardian_relationships WHERE student_id=p_student AND guardian_id=p_guardian AND status='active'
 AND public.setup_today(tenant) BETWEEN effective_from AND coalesce(effective_until,'infinity') ORDER BY effective_from DESC LIMIT 1;
 IF r.id IS NULL THEN UPDATE public.student_parents SET is_primary=false,receives_notifications=false WHERE student_id=p_student AND parent_id=p_guardian;
 ELSE
  INSERT INTO public.student_parents(institution_id,student_id,parent_id,relationship,is_primary,receives_notifications)
  VALUES(tenant,p_student,p_guardian,r.relationship,r.is_primary,r.receives_notifications)
  ON CONFLICT(student_id,parent_id) DO UPDATE SET relationship=excluded.relationship,is_primary=excluded.is_primary,receives_notifications=excluded.receives_notifications;
 END IF;
END $$;
CREATE FUNCTION public.link_student_guardian(p_student uuid,p_guardian jsonb,p_relationship jsonb,p_expected_contact_version bigint,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE tenant uuid; candidate jsonb;p public.parents;rid uuid;from_day date;until_day date;
BEGIN
 SELECT institution_id INTO tenant FROM public.students WHERE id=p_student;PERFORM public.lock_staff_lifecycle(tenant);
 IF NOT public.guardian_student_allowed(p_student) OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'scoped student and specific reason required' USING ERRCODE='42501'; END IF;
 candidate:=public.guardian_candidate(tenant,p_guardian);
 IF jsonb_array_length(candidate->'errors')>0 THEN RAISE EXCEPTION '%',candidate->'errors' USING ERRCODE='22023'; END IF;
 IF candidate->>'guardian_id' IS NOT NULL THEN
  SELECT * INTO p FROM public.parents WHERE id=(candidate->>'guardian_id')::uuid FOR UPDATE;
  IF p.contact_version IS DISTINCT FROM p_expected_contact_version THEN RAISE EXCEPTION 'guardian changed; review again' USING ERRCODE='42501';END IF;
 ELSE
  INSERT INTO public.parents(institution_id,name,phone,phone_normalized,email,language,communication_consent,guardian_managed)
  VALUES(tenant,btrim(p_guardian->>'guardian_name'),btrim(p_guardian->>'guardian_mobile'),candidate->>'phone_normalized',nullif(btrim(p_guardian->>'guardian_email'),''),coalesce(nullif(p_guardian->>'guardian_language',''),'en')::public.language_type,false,true) RETURNING * INTO p;
  PERFORM public.guardian_mapping_event(p_student,p.id,'guardian.created',NULL,jsonb_build_object('name',p.name,'phone',p.phone,'email',p.email,'communication_consent',false),p_reason);
 END IF;
 from_day:=(p_relationship->>'effective_from')::date;until_day:=nullif(p_relationship->>'effective_until','')::date;
 IF from_day IS NULL OR from_day>public.setup_today(tenant) OR until_day<public.setup_today(tenant) THEN RAISE EXCEPTION 'link must start on/before today and not already have expired; record the actual start date' USING ERRCODE='22023';END IF;
 INSERT INTO public.student_guardian_relationships(institution_id,student_id,guardian_id,relationship,is_primary,receives_notifications,preferred_channel,effective_from,effective_until,created_by,reason)
 VALUES(tenant,p_student,p.id,p_relationship->>'relationship',coalesce((p_relationship->>'is_primary')::boolean,false),coalesce((p_relationship->>'receives_notifications')::boolean,false),nullif(p_relationship->>'preferred_channel',''),from_day,until_day,public.current_profile_id(),p_reason) RETURNING id INTO rid;
 PERFORM public.sync_guardian_projection(p_student,p.id);
 PERFORM public.guardian_mapping_event(p_student,p.id,'relationship.linked',NULL,(SELECT to_jsonb(r) FROM public.student_guardian_relationships r WHERE id=rid),p_reason);RETURN rid;
END $$;
CREATE FUNCTION public.change_guardian_relationship(p_relationship uuid,p_revision bigint,p_changes jsonb,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.student_guardian_relationships;other public.student_guardian_relationships;until_day date;
BEGIN
 SELECT * INTO r FROM public.student_guardian_relationships WHERE id=p_relationship;PERFORM public.lock_staff_lifecycle(r.institution_id);
 SELECT * INTO r FROM public.student_guardian_relationships WHERE id=p_relationship FOR UPDATE;
 IF r.id IS NULL OR NOT public.guardian_student_allowed(r.student_id) OR r.revision IS DISTINCT FROM p_revision OR r.status<>'active'
 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'current active scoped relationship and specific reason required' USING ERRCODE='42501';END IF;
 IF r.effective_until<public.setup_today(r.institution_id) AND coalesce(p_changes->>'action','')<>'end' THEN RAISE EXCEPTION 'expired relationship must be closed; append a fresh reviewed relationship' USING ERRCODE='42501';END IF;
 IF coalesce(p_changes->>'action','')='end' THEN
  until_day:=(p_changes->>'effective_until')::date;
  IF until_day IS NULL OR until_day<r.effective_from-1 OR until_day>public.setup_today(r.institution_id) OR until_day>r.effective_until THEN RAISE EXCEPTION 'actual relationship cutoff must be on/before today and cannot extend its recorded period' USING ERRCODE='22023';END IF;
  UPDATE public.student_guardian_relationships SET status='ended',effective_until=until_day,ended_by=public.current_profile_id(),ended_at=now(),end_reason=p_reason,revision=revision+1 WHERE id=r.id;
 ELSIF p_changes->>'action'='primary' THEN
  FOR other IN SELECT * FROM public.student_guardian_relationships WHERE student_id=r.student_id AND status='active' AND is_primary AND id<>r.id LOOP
   UPDATE public.student_guardian_relationships SET is_primary=false,revision=revision+1 WHERE id=other.id;
   PERFORM public.sync_guardian_projection(other.student_id,other.guardian_id);
   PERFORM public.guardian_mapping_event(other.student_id,other.guardian_id,'primary.changed',to_jsonb(other),(SELECT to_jsonb(x) FROM public.student_guardian_relationships x WHERE id=other.id),p_reason);
  END LOOP;
  UPDATE public.student_guardian_relationships SET is_primary=true,revision=revision+1 WHERE id=r.id;
 ELSIF p_changes->>'action'='preference' THEN
  IF p_changes->>'receives_notifications' IS NULL THEN RAISE EXCEPTION 'explicit notification preference required' USING ERRCODE='22023';END IF;
  UPDATE public.student_guardian_relationships SET receives_notifications=(p_changes->>'receives_notifications')::boolean,preferred_channel=nullif(p_changes->>'preferred_channel',''),revision=revision+1 WHERE id=r.id;
 ELSE RAISE EXCEPTION 'choose primary, preference or end; replace by closing and linking explicitly' USING ERRCODE='22023';END IF;
 PERFORM public.sync_guardian_projection(r.student_id,r.guardian_id);
 PERFORM public.guardian_mapping_event(r.student_id,r.guardian_id,CASE p_changes->>'action' WHEN 'end' THEN 'relationship.ended' WHEN 'primary' THEN 'primary.changed' ELSE 'preference.changed' END,to_jsonb(r),(SELECT to_jsonb(x) FROM public.student_guardian_relationships x WHERE id=r.id),p_reason);
END $$;
CREATE FUNCTION public.update_guardian_contact(p_student uuid,p_guardian uuid,p_details jsonb,p_version bigint,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.parents;mobile text;changed_destination boolean;
BEGIN
 SELECT * INTO p FROM public.parents WHERE id=p_guardian;PERFORM public.lock_staff_lifecycle(p.institution_id);SELECT * INTO p FROM public.parents WHERE id=p_guardian FOR UPDATE;
 IF NOT public.guardian_student_allowed(p_student) OR NOT EXISTS(SELECT 1 FROM public.student_guardian_relationships WHERE student_id=p_student AND guardian_id=p.id AND institution_id=p.institution_id)
 OR NOT public.guardian_identity_editable(p.id) OR p.contact_version IS DISTINCT FROM p_version OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'current guardian version and authority over all linked students required' USING ERRCODE='42501';END IF;
 mobile:=public.guardian_phone(p_details->>'phone');
 IF mobile IS NULL OR length(btrim(coalesce(p_details->>'name',''))) NOT BETWEEN 2 AND 120 OR nullif(p_details->>'email','') IS NOT NULL AND (length(p_details->>'email')>200 OR p_details->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN RAISE EXCEPTION 'valid contact name, international phone and optional email required' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.parents WHERE institution_id=p.institution_id AND id<>p.id AND public.guardian_phone(phone)=mobile) AND coalesce(p_details->>'distinct_acknowledged','false')<>'true' THEN RAISE EXCEPTION 'possible shared contact; explicit distinct-person review required' USING ERRCODE='22023';END IF;
 changed_destination:=mobile IS DISTINCT FROM public.guardian_phone(p.phone) OR coalesce((p_details->>'active')::boolean,p.active) IS DISTINCT FROM p.active;
 UPDATE public.parents SET name=btrim(p_details->>'name'),phone=btrim(p_details->>'phone'),phone_normalized=mobile,email=nullif(btrim(p_details->>'email'),''),language=coalesce(nullif(p_details->>'language',''),p.language::text)::public.language_type,
 active=coalesce((p_details->>'active')::boolean,p.active),contact_metadata=coalesce(p_details->'contact_metadata',contact_metadata),guardian_managed=true,contact_version=contact_version+1,
 communication_consent=CASE WHEN changed_destination THEN false ELSE communication_consent END WHERE id=p.id;
 IF changed_destination THEN
  UPDATE public.guardian_notification_invitations SET revoked_at=coalesce(revoked_at,now()) WHERE guardian_id=p.id AND consumed_at IS NULL;
  UPDATE public.guardian_notification_installations SET active=false,revoked_at=coalesce(revoked_at,now()),failure_reason='guardian_contact_changed' WHERE guardian_id=p.id;
  UPDATE public.guardian_notification_consents SET status='revoked',revoked_at=now() WHERE guardian_id=p.id AND status='accepted';
 END IF;
 PERFORM public.guardian_mapping_event(p_student,p.id,'guardian.contact_changed',jsonb_build_object('name',p.name,'phone',p.phone,'email',p.email,'active',p.active,'language',p.language,'contact_metadata',p.contact_metadata,'contact_version',p.contact_version,'communication_consent',p.communication_consent),
 (SELECT jsonb_build_object('name',name,'phone',phone,'email',email,'active',active,'language',language,'contact_metadata',contact_metadata,'contact_version',contact_version,'communication_consent',communication_consent,'registrations_revoked',changed_destination) FROM public.parents WHERE id=p.id),p_reason);
END $$;
CREATE FUNCTION public.record_guardian_communication_consent(p_student uuid,p_guardian uuid,p_version bigint,p_accepted boolean,p_reference text,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.parents;
BEGIN
 SELECT * INTO p FROM public.parents WHERE id=p_guardian;PERFORM public.lock_staff_lifecycle(p.institution_id);SELECT * INTO p FROM public.parents WHERE id=p_guardian FOR UPDATE;
 IF p_accepted IS NULL OR NOT public.guardian_student_allowed(p_student) OR NOT public.guardian_identity_editable(p.id) OR p.contact_version IS DISTINCT FROM p_version
 OR NOT EXISTS(SELECT 1 FROM public.student_guardian_relationships WHERE student_id=p_student AND guardian_id=p.id AND institution_id=p.institution_id)
 OR length(btrim(coalesce(p_reference,''))) NOT BETWEEN 10 AND 300 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'scoped guardian, current version and actual consent/withdrawal evidence reference required' USING ERRCODE='42501';END IF;
 UPDATE public.parents SET communication_consent=p_accepted,contact_version=contact_version+1 WHERE id=p.id;
 IF NOT p_accepted THEN
  UPDATE public.guardian_notification_invitations SET revoked_at=coalesce(revoked_at,now()) WHERE guardian_id=p.id AND consumed_at IS NULL;
  UPDATE public.guardian_notification_installations SET active=false,revoked_at=coalesce(revoked_at,now()),failure_reason='communication_consent_withdrawn' WHERE guardian_id=p.id;
  UPDATE public.guardian_notification_consents SET status='revoked',revoked_at=now() WHERE guardian_id=p.id AND status='accepted';
 END IF;
 PERFORM public.guardian_mapping_event(p_student,p.id,'communication_consent.recorded',jsonb_build_object('accepted',p.communication_consent),jsonb_build_object('accepted',p_accepted,'evidence_reference',p_reference,'contact_version',p.contact_version+1),p_reason);
END $$;
DO $$ DECLARE f text;BEGIN
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('guardian_candidate','student_guardians','search_student_guardians','sync_guardian_projection','link_student_guardian','change_guardian_relationship','update_guardian_contact','record_guardian_communication_consent') LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f||' FROM PUBLIC,anon,authenticated';END LOOP;
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('student_guardians','search_student_guardians','link_student_guardian','change_guardian_relationship','update_guardian_contact','record_guardian_communication_consent') LOOP EXECUTE 'GRANT EXECUTE ON FUNCTION '||f||' TO authenticated';END LOOP;
END $$;
COMMIT;
