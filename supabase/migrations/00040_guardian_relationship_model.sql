-- Retain canonical parent IDs and all existing consent/device/delivery history.
BEGIN;
CREATE FUNCTION public.guardian_phone(p text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v text;
BEGIN
 IF p IS NULL OR length(p)>80 OR p !~ '^\+?[0-9 () .-]+$' THEN RETURN NULL; END IF;
 v:=regexp_replace(p,'[ () .-]','','g');
 -- Never infer a country code from a local number.
 IF v !~ '^\+[1-9][0-9]{7,14}$' THEN RETURN NULL; END IF; RETURN v;
END $$;
ALTER TABLE public.parents ADD COLUMN phone_normalized text,
 ADD COLUMN guardian_managed boolean NOT NULL DEFAULT false,
 ADD COLUMN contact_version bigint NOT NULL DEFAULT 0,
 ADD COLUMN contact_metadata jsonb NOT NULL DEFAULT '{}';
UPDATE public.parents SET phone_normalized=public.guardian_phone(phone);
-- Legacy duplicates are retained for explicit institutional review.
CREATE UNIQUE INDEX guardian_managed_identity ON public.parents(institution_id,public.student_identifier(name),phone_normalized) WHERE guardian_managed;
CREATE INDEX guardian_phone_lookup ON public.parents(institution_id,phone_normalized);
-- A household may legitimately share an email; email is not a person identifier.
DROP INDEX public.idx_parents_tenant_email;
CREATE INDEX parents_tenant_email_lookup ON public.parents(institution_id,lower(email)) WHERE email IS NOT NULL;
ALTER TABLE public.parents ADD CHECK(NOT guardian_managed OR (phone_normalized IS NOT NULL AND phone_normalized=public.guardian_phone(phone) AND length(btrim(name)) BETWEEN 2 AND 120)),
 ADD CHECK(jsonb_typeof(contact_metadata)='object' AND octet_length(contact_metadata::text)<=2000);
CREATE TABLE public.student_guardian_relationships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES public.institutions(id), student_id uuid NOT NULL, guardian_id uuid NOT NULL,
 relationship text NOT NULL CHECK(relationship IN ('mother','father','guardian','other')), is_primary boolean NOT NULL DEFAULT false,
 receives_notifications boolean NOT NULL DEFAULT false, preferred_channel text CHECK(preferred_channel IN ('sms','push','voice','whatsapp')),
 effective_from date NOT NULL, effective_until date CHECK(effective_until>=effective_from-1),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')), revision bigint NOT NULL DEFAULT 1,
 created_by uuid REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL,
 ended_by uuid REFERENCES public.profiles(id), ended_at timestamptz, end_reason text,
 UNIQUE(institution_id,id), FOREIGN KEY(institution_id,student_id) REFERENCES public.students(institution_id,id),
 FOREIGN KEY(institution_id,guardian_id) REFERENCES public.parents(institution_id,id)
);
CREATE INDEX guardian_relationship_student ON public.student_guardian_relationships(institution_id,student_id,effective_from);
CREATE INDEX guardian_relationship_guardian ON public.student_guardian_relationships(institution_id,guardian_id);
INSERT INTO public.student_guardian_relationships(institution_id,student_id,guardian_id,relationship,is_primary,receives_notifications,effective_from,created_at,reason)
 SELECT institution_id,student_id,parent_id,relationship,is_primary,receives_notifications,(created_at AT TIME ZONE 'UTC')::date,created_at,'Legacy relationship imported from its recorded creation time; earlier history is unknown.' FROM public.student_parents;
CREATE TABLE public.guardian_mapping_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES public.institutions(id),
 actor_profile_id uuid NOT NULL REFERENCES public.profiles(id), student_id uuid NOT NULL, guardian_id uuid NOT NULL,
 action text NOT NULL, previous jsonb, current jsonb, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(institution_id,student_id) REFERENCES public.students(institution_id,id), FOREIGN KEY(institution_id,guardian_id) REFERENCES public.parents(institution_id,id)
);
CREATE FUNCTION public.guardian_student_allowed(p_student uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.students s WHERE s.id=p_student AND public.student_scope_allowed(s.institution_id,NULL,true))
 OR EXISTS(SELECT 1 FROM public.student_placements p WHERE p.student_id=p_student AND public.setup_today(p.institution_id) BETWEEN p.starts_on AND p.ends_on AND public.student_scope_allowed(p.institution_id,p.section_id,true));
$$;
CREATE FUNCTION public.guardian_identity_visible(p_guardian uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.parents p WHERE p.id=p_guardian AND public.student_scope_allowed(p.institution_id,NULL,true))
 OR EXISTS(SELECT 1 FROM public.student_guardian_relationships r WHERE r.guardian_id=p_guardian AND public.guardian_student_allowed(r.student_id));
$$;
CREATE FUNCTION public.guardian_identity_editable(p_guardian uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.guardian_identity_visible(p_guardian) AND NOT EXISTS(SELECT 1 FROM public.student_guardian_relationships r WHERE r.guardian_id=p_guardian AND r.status='active' AND coalesce(r.effective_until,'infinity')>=public.setup_today(r.institution_id) AND NOT public.guardian_student_allowed(r.student_id));
$$;
CREATE FUNCTION public.guardian_mapping_event(p_student uuid,p_guardian uuid,p_action text,p_old jsonb,p_new jsonb,p_reason text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 INSERT INTO public.guardian_mapping_audit(institution_id,actor_profile_id,student_id,guardian_id,action,previous,current,reason)
 SELECT institution_id,public.current_profile_id(),id,p_guardian,p_action,p_old,p_new,p_reason FROM public.students WHERE id=p_student;
$$;
CREATE FUNCTION public.guardian_relationship_eligible(p_institution uuid,p_student uuid,p_guardian uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.parents p JOIN public.students s ON s.institution_id=p.institution_id
 JOIN public.institutions i ON i.id=p.institution_id WHERE p.id=p_guardian AND p.institution_id=p_institution AND s.id=p_student AND p.active AND i.status='active' AND s.enrollment_status='active' AND (
 EXISTS(SELECT 1 FROM public.student_guardian_relationships r WHERE r.institution_id=p_institution AND r.student_id=p_student AND r.guardian_id=p_guardian AND r.status='active' AND r.receives_notifications AND public.setup_today(p_institution) BETWEEN r.effective_from AND coalesce(r.effective_until,'infinity'))
 OR (NOT p.guardian_managed AND NOT EXISTS(SELECT 1 FROM public.student_guardian_relationships r WHERE r.student_id=p_student AND r.guardian_id=p_guardian) AND EXISTS(SELECT 1 FROM public.student_parents sp WHERE sp.institution_id=p_institution AND sp.student_id=p_student AND sp.parent_id=p_guardian AND sp.receives_notifications))));
$$;
-- Scope and contact privacy apply independently of older permissive policies.
CREATE POLICY guardian_contact_privacy ON public.parents AS RESTRICTIVE FOR SELECT TO authenticated USING(public.guardian_identity_visible(id));
CREATE POLICY guardian_contact_read ON public.parents FOR SELECT TO authenticated USING(public.guardian_identity_visible(id));
CREATE POLICY guardian_relationship_privacy ON public.student_parents AS RESTRICTIVE FOR SELECT TO authenticated USING(public.guardian_student_allowed(student_id));
-- Historical message bodies/recipient snapshots must not expose hidden contacts.
CREATE POLICY guardian_delivery_contact_privacy ON public.communications AS RESTRICTIVE FOR SELECT TO authenticated USING(public.guardian_student_allowed(student_id));
CREATE POLICY guardian_legacy_no_insert ON public.parents AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(false);
CREATE POLICY guardian_legacy_no_update ON public.parents AS RESTRICTIVE FOR UPDATE TO authenticated USING(false);
CREATE POLICY guardian_legacy_no_delete ON public.parents AS RESTRICTIVE FOR DELETE TO authenticated USING(false);
CREATE POLICY guardian_link_no_insert ON public.student_parents AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(false);
CREATE POLICY guardian_link_no_update ON public.student_parents AS RESTRICTIVE FOR UPDATE TO authenticated USING(false);
CREATE POLICY guardian_link_no_delete ON public.student_parents AS RESTRICTIVE FOR DELETE TO authenticated USING(false);
ALTER TABLE public.student_guardian_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_mapping_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY guardian_relationship_read ON public.student_guardian_relationships FOR SELECT TO authenticated USING(public.guardian_student_allowed(student_id));
CREATE POLICY guardian_audit_read ON public.guardian_mapping_audit FOR SELECT TO authenticated USING(public.student_scope_allowed(institution_id,NULL,true));
GRANT SELECT ON public.student_guardian_relationships,public.guardian_mapping_audit TO authenticated;
GRANT ALL ON public.student_guardian_relationships,public.guardian_mapping_audit TO service_role;
-- Contact-version snapshots prevent queued legacy work retargeting a changed phone.
ALTER TABLE public.communications ADD COLUMN guardian_contact_version bigint;
UPDATE public.communications c SET guardian_contact_version=p.contact_version FROM public.parents p WHERE p.id=c.parent_id AND p.institution_id=c.institution_id;
CREATE FUNCTION public.guardian_delivery_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN SELECT contact_version INTO NEW.guardian_contact_version FROM public.parents WHERE id=NEW.parent_id AND institution_id=NEW.institution_id;RETURN NEW;END $$;
CREATE TRIGGER guardian_delivery_snapshot BEFORE INSERT ON public.communications FOR EACH ROW EXECUTE FUNCTION public.guardian_delivery_snapshot();
CREATE FUNCTION public.guardian_relationship_integrity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.lock_staff_lifecycle(NEW.institution_id);
 IF TG_OP='UPDATE' AND (NEW.id,NEW.institution_id,NEW.student_id,NEW.guardian_id,NEW.relationship,NEW.effective_from,NEW.created_by,NEW.created_at,NEW.reason) IS DISTINCT FROM (OLD.id,OLD.institution_id,OLD.student_id,OLD.guardian_id,OLD.relationship,OLD.effective_from,OLD.created_by,OLD.created_at,OLD.reason) THEN RAISE EXCEPTION 'retain relationship history; close and append replacement' USING ERRCODE='42501';END IF;
 IF NEW.status='active' AND EXISTS(SELECT 1 FROM public.student_guardian_relationships r WHERE r.id<>NEW.id AND r.student_id=NEW.student_id AND r.status='active'
 AND daterange(r.effective_from,r.effective_until+1,'[)') && daterange(NEW.effective_from,NEW.effective_until+1,'[)') AND (r.guardian_id=NEW.guardian_id OR (r.is_primary AND NEW.is_primary))) THEN RAISE EXCEPTION 'overlapping guardian relationship or primary recipient; review existing links' USING ERRCODE='23505';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guardian_relationship_integrity BEFORE INSERT OR UPDATE ON public.student_guardian_relationships FOR EACH ROW EXECUTE FUNCTION public.guardian_relationship_integrity();
DO $$ DECLARE f text;BEGIN
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('guardian_student_allowed','guardian_identity_visible','guardian_identity_editable','guardian_mapping_event','guardian_relationship_eligible','guardian_delivery_snapshot','guardian_relationship_integrity') LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f||' FROM PUBLIC,anon,authenticated';END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.guardian_student_allowed(uuid),public.guardian_identity_visible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardian_relationship_eligible(uuid,uuid,uuid) TO service_role;
COMMIT;
