BEGIN;
CREATE FUNCTION public.import_institution_registry(p_rows jsonb, p_import_sha256 text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_temp AS $$
DECLARE item jsonb; registry uuid; existing public.institution_registry; count_rows integer := 0; source_value text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'trusted registry importer required' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 10000
    OR p_import_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid registry batch' USING ERRCODE = '22023';
  END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    source_value := item->>'source';
    IF source_value NOT IN ('aishe','ugc','aicte') OR
      NOT (CASE source_value
        WHEN 'aishe' THEN item->>'sourceUrl' ~ '^https://([a-z0-9-]+\.)*(aishe\.gov\.in|aishe\.nic\.in)(/|$)'
        WHEN 'ugc' THEN item->>'sourceUrl' ~ '^https://([a-z0-9-]+\.)*(ugc\.gov\.in|ugc\.ac\.in)(/|$)'
        WHEN 'aicte' THEN item->>'sourceUrl' ~ '^https://([a-z0-9-]+\.)*(aicte-india\.org|aicte\.gov\.in)(/|$)'
        ELSE false END)
      OR length(btrim(coalesce(item->>'externalId',''))) NOT BETWEEN 1 AND 150
      OR length(btrim(coalesce(item->>'status',''))) NOT BETWEEN 1 AND 100
      OR (item->>'sourceUpdatedAt')::timestamptz > now()
      OR (source_value = 'aishe' AND nullif(item->>'aisheCode','') IS NULL) THEN
      RAISE EXCEPTION 'invalid official registry provenance' USING ERRCODE = '22023';
    END IF;
    registry := nullif(item->>'registryId','')::uuid;
    IF registry IS NULL THEN
      SELECT registry_id INTO registry FROM public.institution_registry_sources
        WHERE source = source_value AND external_id = item->>'externalId';
      IF registry IS NULL AND nullif(item->>'aisheCode','') IS NOT NULL THEN
        SELECT id INTO registry FROM public.institution_registry WHERE aishe_code = item->>'aisheCode';
      END IF;
    END IF;
    IF registry IS NOT NULL THEN
      SELECT * INTO existing FROM public.institution_registry WHERE id = registry FOR UPDATE;
      IF NOT FOUND OR (existing.aishe_code IS NOT NULL AND nullif(item->>'aisheCode','') IS NOT NULL
        AND existing.aishe_code <> item->>'aisheCode') THEN
        RAISE EXCEPTION 'explicit registry crosscheck identity conflicts' USING ERRCODE = '22023';
      END IF;
      IF EXISTS(SELECT 1 FROM public.institution_registry_sources
        WHERE source = source_value AND external_id = item->>'externalId' AND registry_id <> registry) THEN
        RAISE EXCEPTION 'source identity already belongs to another registry institution' USING ERRCODE = '23505';
      END IF;
      IF EXISTS(SELECT 1 FROM public.institution_registry_sources
        WHERE registry_id = registry AND source = source_value AND source_updated_at > (item->>'sourceUpdatedAt')::timestamptz) THEN
        RAISE EXCEPTION 'stale registry import refused' USING ERRCODE = '22023';
      END IF;
    ELSE
      INSERT INTO public.institution_registry(canonical_name,institution_type,aishe_code,state,city,
        official_website,official_domain,source_updated_at)
      VALUES(item->>'canonicalName',item->>'institutionType',item->>'aisheCode',item->>'state',item->>'city',
        item->>'officialWebsite',item->>'officialDomain',(item->>'sourceUpdatedAt')::timestamptz)
      RETURNING id INTO registry;
    END IF;
    INSERT INTO public.institution_registry_sources(registry_id,source,external_id,source_url,source_updated_at,import_sha256,status)
    VALUES(registry,source_value,item->>'externalId',item->>'sourceUrl',(item->>'sourceUpdatedAt')::timestamptz,
      p_import_sha256,item->>'status')
    ON CONFLICT(registry_id,source) DO UPDATE SET external_id = EXCLUDED.external_id, source_url = EXCLUDED.source_url,
      source_updated_at = EXCLUDED.source_updated_at, import_sha256 = EXCLUDED.import_sha256, status = EXCLUDED.status, imported_at = now();
    UPDATE public.institution_registry SET
      canonical_name = CASE WHEN source_value = 'aishe' THEN item->>'canonicalName' ELSE canonical_name END,
      institution_type = CASE WHEN source_value = 'aishe' THEN item->>'institutionType' ELSE institution_type END,
      state = CASE WHEN source_value = 'aishe' THEN item->>'state' ELSE state END,
      city = CASE WHEN source_value = 'aishe' THEN item->>'city' ELSE city END,
      official_website = CASE WHEN source_value = 'aishe' THEN item->>'officialWebsite' ELSE official_website END,
      official_domain = CASE WHEN source_value = 'aishe' THEN item->>'officialDomain' ELSE official_domain END,
      aishe_code = coalesce(aishe_code,item->>'aisheCode'),
      ugc_identifier = CASE WHEN source_value = 'ugc' THEN item->>'externalId' ELSE ugc_identifier END,
      ugc_status = CASE WHEN source_value = 'ugc' THEN item->>'status' ELSE ugc_status END,
      aicte_identifier = CASE WHEN source_value = 'aicte' THEN item->>'externalId' ELSE aicte_identifier END,
      aicte_status = CASE WHEN source_value = 'aicte' THEN item->>'status' ELSE aicte_status END,
      source_updated_at = greatest(source_updated_at,(item->>'sourceUpdatedAt')::timestamptz),
      active = CASE WHEN source_value = 'aishe' THEN lower(item->>'status') NOT IN ('inactive','closed','withdrawn') ELSE active END
      WHERE id = registry;
    count_rows := count_rows + 1;
  END LOOP;
  RETURN count_rows;
END $$;
REVOKE ALL ON FUNCTION public.import_institution_registry(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.import_institution_registry(jsonb,text) TO service_role;
COMMIT;
