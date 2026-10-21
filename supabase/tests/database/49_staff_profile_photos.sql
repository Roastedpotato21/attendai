BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
 ('49a00000-0000-4000-8000-000000000001','photo-one@fixture.invalid',now(),'{"name":"Photo One"}'),
 ('49a00000-0000-4000-8000-000000000002','photo-two@fixture.invalid',now(),'{"name":"Photo Two"}');
INSERT INTO public.profile_institutions(profile_id,institution_id,status)
 SELECT id,'11111111-1111-4111-8111-111111111111','active' FROM public.profiles WHERE id IN
 ('49a00000-0000-4000-8000-000000000001','49a00000-0000-4000-8000-000000000002');
INSERT INTO public.profile_roles(profile_id,institution_id,role_code)
 SELECT id,'11111111-1111-4111-8111-111111111111','faculty' FROM public.profiles WHERE id IN
 ('49a00000-0000-4000-8000-000000000001','49a00000-0000-4000-8000-000000000002');
SELECT public.import_existing_staff_membership(id,'11111111-1111-4111-8111-111111111111') FROM public.profiles WHERE id IN
 ('49a00000-0000-4000-8000-000000000001','49a00000-0000-4000-8000-000000000002');
SELECT set_config('request.jwt.claim.sub','49a00000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.my_staff_profile_photo('11111111-1111-4111-8111-111111111111');
 IF r->>'data_url' IS NOT NULL THEN RAISE EXCEPTION 'photo invented'; END IF;
 r:=public.save_my_staff_profile_photo('11111111-1111-4111-8111-111111111111','iVBORw0KGgo=','image/png');
 IF r->>'data_url'<>'data:image/png;base64,iVBORw0KGgo=' OR (r->>'revision')::int<>1 THEN RAISE EXCEPTION 'photo not persisted'; END IF;
 r:=public.save_my_staff_profile_photo('11111111-1111-4111-8111-111111111111','iVBORw0KGgo=','image/png');
 IF (r->>'revision')::int<>2 THEN RAISE EXCEPTION 'replacement revision missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_profile_photos) THEN RAISE EXCEPTION 'direct read bypass'; END IF;
 BEGIN
  PERFORM public.my_staff_profile_photo('22222222-2222-4222-8222-222222222222');
  RAISE EXCEPTION 'cross-tenant photo bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM public.save_my_staff_profile_photo('11111111-1111-4111-8111-111111111111','PHN2Zy8+','image/png');
  RAISE EXCEPTION 'forged PNG accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 BEGIN
  PERFORM public.save_my_staff_profile_photo('11111111-1111-4111-8111-111111111111',repeat('A',174768),'image/jpeg');
  RAISE EXCEPTION 'oversized photo accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 BEGIN
  DELETE FROM public.staff_profile_photos;
  -- RLS makes deletion a no-op; the authenticated RPC must still read the photo.
  IF public.my_staff_profile_photo('11111111-1111-4111-8111-111111111111')->>'data_url' IS NULL THEN RAISE EXCEPTION 'direct delete bypass'; END IF;
 END;
END $$;
SELECT set_config('request.jwt.claim.sub','49a00000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 IF public.my_staff_profile_photo('11111111-1111-4111-8111-111111111111')->>'data_url' IS NOT NULL THEN RAISE EXCEPTION 'other person photo exposed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','49a00000-0000-4000-8000-000000000001',true);
SELECT public.save_my_staff_profile_photo('11111111-1111-4111-8111-111111111111',NULL,NULL);
DO $$ BEGIN
 IF public.my_staff_profile_photo('11111111-1111-4111-8111-111111111111')->>'data_url' IS NOT NULL THEN RAISE EXCEPTION 'photo removal failed'; END IF;
END $$;
RESET ROLE;
UPDATE public.profile_institutions SET status='revoked' WHERE profile_id='49a00000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.save_my_staff_profile_photo('11111111-1111-4111-8111-111111111111','iVBORw0KGgo=','image/png');
  RAISE EXCEPTION 'revoked membership accepted stale session'; EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.staff_setup_audit WHERE entity_type='staff_profile_photos' AND (current::text LIKE '%base64%' OR current::text LIKE '%iVBOR%')) THEN
  RAISE EXCEPTION 'photo bytes copied into audit'; END IF;
END $$;
ROLLBACK;
