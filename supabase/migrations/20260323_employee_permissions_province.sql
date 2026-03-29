-- Add province to employee permissions and include it in employee_login payload

alter table if exists public.employee_permissions
    add column if not exists province text not null default '';

create index if not exists employee_permissions_province_idx
    on public.employee_permissions (province);

create or replace function public.employee_login(
    p_employee_name text,
    p_employee_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_name_raw text := btrim(coalesce(p_employee_name, ''));
    v_code_raw text := btrim(coalesce(p_employee_code, ''));
    v_name text := lower(v_name_raw);
    v_code text := lower(v_code_raw);
    v_valid boolean := false;
    v_hospitals jsonb := '[]'::jsonb;
begin
    if v_name = '' or v_code = '' then
        return jsonb_build_object(
            'is_valid', false,
            'employee_name', v_name_raw,
            'employee_code', v_code_raw,
            'hospitals', '[]'::jsonb
        );
    end if;

    select exists (
        select 1
        from public.employee_identities
        where lower(btrim(employee_name)) = v_name
          and lower(btrim(employee_code)) = v_code
          and is_active = true
    )
    into v_valid;

    if not v_valid then
        return jsonb_build_object(
            'is_valid', false,
            'employee_name', v_name_raw,
            'employee_code', v_code_raw,
            'hospitals', '[]'::jsonb
        );
    end if;

    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'sg', x.sg,
                'rm', x.rm,
                'dm', x.dm,
                'mics', x.mics,
                'province', x.province,
                'hospital_name', x.hospital_name,
                'hospital_code', x.hospital_code
            )
            order by x.hospital_code
        ),
        '[]'::jsonb
    )
    into v_hospitals
    from (
        select distinct
            p.sg,
            p.rm,
            p.dm,
            p.mics,
            p.province,
            p.hospital_name,
            p.hospital_code
        from public.employee_permissions p
        where p.is_active = true
          and (
            lower(btrim(p.sg)) = v_name
            or lower(btrim(p.rm)) = v_name
            or lower(btrim(p.dm)) = v_name
            or lower(btrim(p.mics)) = v_name
          )
    ) x;

    return jsonb_build_object(
        'is_valid', true,
        'employee_name', v_name_raw,
        'employee_code', v_code_raw,
        'hospitals', v_hospitals
    );
end;
$$;

revoke all on function public.employee_login(text, text) from public;
grant execute on function public.employee_login(text, text) to anon, authenticated, service_role;
