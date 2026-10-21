-- Eligibility adapters only. Transport, providers and attendance enqueue remain unchanged.
BEGIN;
CREATE VIEW public.guardian_current_relationships WITH (security_invoker=true) AS
 SELECT sp.* FROM public.student_parents sp WHERE public.guardian_relationship_eligible(sp.institution_id,sp.student_id,sp.parent_id);
REVOKE ALL ON public.guardian_current_relationships FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.guardian_current_relationships TO service_role;
CREATE FUNCTION public.guardian_communication_eligible(p_communication uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.communications c JOIN public.parents p ON p.id=c.parent_id AND p.institution_id=c.institution_id
 WHERE c.id=p_communication AND c.guardian_contact_version=p.contact_version AND p.communication_consent
 AND public.guardian_relationship_eligible(c.institution_id,c.student_id,c.parent_id)
 AND NOT EXISTS(SELECT 1 FROM public.student_guardian_relationships r WHERE r.institution_id=c.institution_id AND r.student_id=c.student_id AND r.guardian_id=c.parent_id AND r.status='active' AND public.setup_today(c.institution_id) BETWEEN r.effective_from AND coalesce(r.effective_until,'infinity') AND r.preferred_channel IS NOT NULL AND r.preferred_channel<>c.type::text));
$$;
REVOKE ALL ON FUNCTION public.guardian_communication_eligible(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guardian_communication_eligible(uuid) TO service_role;
ALTER FUNCTION public.mark_sms_dispatch_started(uuid,uuid) RENAME TO mark_sms_started_before_guardian_lifecycle;
REVOKE ALL ON FUNCTION public.mark_sms_started_before_guardian_lifecycle(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.mark_sms_dispatch_started(p_job uuid,p_owner uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE tenant uuid;event uuid;
BEGIN
 SELECT institution_id,communication_id INTO tenant,event FROM public.communication_jobs WHERE id=p_job;
 IF tenant IS NULL THEN RETURN false;END IF;PERFORM public.lock_staff_lifecycle(tenant);
 IF NOT public.guardian_communication_eligible(event) THEN RETURN false;END IF;
 RETURN public.mark_sms_started_before_guardian_lifecycle(p_job,p_owner);
END $$;
REVOKE ALL ON FUNCTION public.mark_sms_dispatch_started(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mark_sms_dispatch_started(uuid,uuid) TO service_role;
ALTER FUNCTION public.begin_push_dispatch(uuid,uuid,uuid) RENAME TO begin_push_dispatch_before_guardian_lifecycle;
REVOKE ALL ON FUNCTION public.begin_push_dispatch_before_guardian_lifecycle(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.begin_push_dispatch(p_job uuid,p_owner uuid,p_installation uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE tenant uuid;event uuid;
BEGIN
 SELECT institution_id,communication_id INTO tenant,event FROM public.communication_jobs WHERE id=p_job;
 IF tenant IS NULL THEN RETURN 'lease_lost';END IF;
 PERFORM public.lock_staff_lifecycle(tenant);
 IF NOT public.guardian_communication_eligible(event) THEN RETURN 'ineligible';END IF;
 RETURN public.begin_push_dispatch_before_guardian_lifecycle(p_job,p_owner,p_installation);
END $$;
REVOKE ALL ON FUNCTION public.begin_push_dispatch(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_push_dispatch(uuid,uuid,uuid) TO service_role;
ALTER FUNCTION public.consume_guardian_notification_invitation_with_consent(text,text,text,text,text) RENAME TO consume_guardian_invitation_before_lifecycle;
REVOKE ALL ON FUNCTION public.consume_guardian_invitation_before_lifecycle(text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.consume_guardian_notification_invitation_with_consent(p_token_hash text,p_fid text,p_device_secret_hash text,p_project_id text,p_consent_version text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE invitation public.guardian_notification_invitations;
BEGIN
 SELECT * INTO invitation FROM public.guardian_notification_invitations WHERE token_hash=p_token_hash;
 PERFORM public.lock_staff_lifecycle(invitation.institution_id);
 IF invitation.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.student_parents sp WHERE sp.parent_id=invitation.guardian_id AND sp.institution_id=invitation.institution_id AND public.guardian_relationship_eligible(sp.institution_id,sp.student_id,sp.parent_id)) THEN RAISE EXCEPTION 'no currently eligible guardian relationship' USING ERRCODE='22023';END IF;
 RETURN public.consume_guardian_invitation_before_lifecycle(p_token_hash,p_fid,p_device_secret_hash,p_project_id,p_consent_version);
END $$;
REVOKE ALL ON FUNCTION public.consume_guardian_notification_invitation_with_consent(text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_guardian_notification_invitation_with_consent(text,text,text,text,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
