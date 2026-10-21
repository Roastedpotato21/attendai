-- Self-managed, workspace-private display photos. These grant no identity/role.
BEGIN;
CREATE TABLE public.staff_profile_photos (
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  institution_id uuid NOT NULL REFERENCES public.institutions(id),
  photo_bytes bytea NOT NULL CHECK(octet_length(photo_bytes) BETWEEN 8 AND 131072),
  mime_type text NOT NULL CHECK(mime_type IN ('image/png','image/jpeg')),
  revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(profile_id,institution_id)
);
ALTER TABLE public.staff_profile_photos ENABLE ROW LEVEL SECURITY;
-- No browser table policies: all access goes through current-self RPCs.
CREATE FUNCTION public.my_staff_profile_photo(p_institution uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL) THEN
   RAISE EXCEPTION 'verified account required' USING ERRCODE='42501'; END IF;
 PERFORM public.my_staff_workspace(p_institution);
 SELECT jsonb_build_object('data_url','data:'||mime_type||';base64,'||replace(encode(photo_bytes,'base64'),E'\n',''),
   'revision',revision,'updated_at',updated_at) INTO result FROM public.staff_profile_photos
 WHERE institution_id=p_institution AND profile_id=public.current_profile_id();
 RETURN coalesce(result,jsonb_build_object('data_url',NULL,'revision',0));
END $$;
CREATE FUNCTION public.save_my_staff_profile_photo(p_institution uuid,p_base64 text,p_mime text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE bytes bytea; actor uuid;
BEGIN
 PERFORM public.lock_staff_lifecycle(p_institution);
 PERFORM public.my_staff_profile_photo(p_institution);
 actor:=public.current_profile_id();
 IF p_base64 IS NULL THEN
   IF p_mime IS NOT NULL THEN RAISE EXCEPTION 'invalid photo metadata' USING ERRCODE='22023'; END IF;
   DELETE FROM public.staff_profile_photos WHERE institution_id=p_institution AND profile_id=actor;
 ELSE
   IF length(p_base64)>174764 OR p_base64 !~ '^[A-Za-z0-9+/=]+$' OR p_mime IS NULL OR p_mime NOT IN ('image/png','image/jpeg') THEN
     RAISE EXCEPTION 'photo must be a PNG/JPEG up to 128 KiB' USING ERRCODE='22023'; END IF;
   bytes:=decode(p_base64,'base64');
   IF octet_length(bytes)<8 OR octet_length(bytes)>131072 OR NOT (
     (p_mime='image/png' AND substring(bytes FROM 1 FOR 8)=decode('89504e470d0a1a0a','hex')) OR
     (p_mime='image/jpeg' AND substring(bytes FROM 1 FOR 3)=decode('ffd8ff','hex'))) THEN
     RAISE EXCEPTION 'invalid photo signature/size' USING ERRCODE='22023'; END IF;
   INSERT INTO public.staff_profile_photos(profile_id,institution_id,photo_bytes,mime_type)
   VALUES(actor,p_institution,bytes,p_mime)
   ON CONFLICT(profile_id,institution_id) DO UPDATE SET photo_bytes=EXCLUDED.photo_bytes,mime_type=EXCLUDED.mime_type,
     revision=staff_profile_photos.revision+1,updated_at=now();
 END IF;
 INSERT INTO public.staff_setup_audit(institution_id,actor_profile_id,action,entity_type,entity_id,current)
 VALUES(p_institution,actor,CASE WHEN p_base64 IS NULL THEN 'profile.photo_removed' ELSE 'profile.photo_updated' END,
   'staff_profile_photos',actor,jsonb_build_object('mime_type',p_mime,'bytes',coalesce(octet_length(bytes),0)));
 RETURN public.my_staff_profile_photo(p_institution);
END $$;
REVOKE ALL ON FUNCTION public.my_staff_profile_photo(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.save_my_staff_profile_photo(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.my_staff_profile_photo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_my_staff_profile_photo(uuid,text,text) TO authenticated;
COMMIT;
