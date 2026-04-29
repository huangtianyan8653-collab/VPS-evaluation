-- Store hospital metadata on each survey result.
-- This keeps the admin dashboard readable even if hospital permissions are later renamed
-- or if imported hospital codes mix the letter O and the number 0.

alter table if exists public.survey_results
    add column if not exists hospital_name text,
    add column if not exists province text,
    add column if not exists sg text,
    add column if not exists rm text,
    add column if not exists dm text,
    add column if not exists mics text;

update public.survey_results sr
set
    hospital_name = coalesce(nullif(btrim(sr.hospital_name), ''), p.hospital_name),
    province = coalesce(nullif(btrim(sr.province), ''), p.province),
    sg = coalesce(nullif(btrim(sr.sg), ''), p.sg),
    rm = coalesce(nullif(btrim(sr.rm), ''), p.rm),
    dm = coalesce(nullif(btrim(sr.dm), ''), p.dm),
    mics = coalesce(nullif(btrim(sr.mics), ''), p.mics)
from (
    select distinct on (upper(replace(btrim(hospital_code), 'O', '0')))
        upper(replace(btrim(hospital_code), 'O', '0')) as normalized_hospital_code,
        hospital_name,
        province,
        sg,
        rm,
        dm,
        mics
    from public.employee_permissions
    where btrim(coalesce(hospital_code, '')) <> ''
    order by upper(replace(btrim(hospital_code), 'O', '0')), is_active desc
) p
where upper(replace(btrim(sr.hospital_id), 'O', '0')) = p.normalized_hospital_code
  and (
    coalesce(btrim(sr.hospital_name), '') = ''
    or coalesce(btrim(sr.province), '') = ''
    or coalesce(btrim(sr.sg), '') = ''
    or coalesce(btrim(sr.rm), '') = ''
    or coalesce(btrim(sr.dm), '') = ''
    or coalesce(btrim(sr.mics), '') = ''
  );

notify pgrst, 'reload schema';
