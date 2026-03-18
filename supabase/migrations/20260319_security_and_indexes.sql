
-- Security & indexes hardening (generated 2026-03-18T08:09:18.971647Z)
-- 1) normalized matching for admin_login / employee_login
-- 2) add lower(trim(employee_code)) unique indexes
-- 3) add hospital+created_at index for survey_results
-- 4) update updated_at trigger helper

create extension if not exists pgcrypto;

-- helper trigger to keep updated_at current
do $$
begin
    if not exists (
        select 1 from pg_proc
        where proname = 'set_updated_at'
          and pronamespace = 'public'::regnamespace
    ) then
        create or replace function public.set_updated_at()
        returns trigger
        language plpgsql
        as $$
        begin
            new.updated_at = now();
            return new;
        end;
        $$;
    end if;
end;
$$;

-- ensure updated_at auto-refresh on admin_accounts
create trigger admin_accounts_set_updated_at
    before update on public.admin_accounts
    for each row
    execute function public.set_updated_at();

-- normalized unique indexes for admin/employee codes
create unique index if not exists admin_accounts_code_lower_idx
    on public.admin_accounts (lower(btrim(employee_code)));

create unique index if not exists employee_identities_code_lower_idx
    on public.employee_identities (lower(btrim(employee_code)));

-- useful index for data-center queries
create index if not exists survey_results_hospital_created_idx
    on public.survey_results (hospital_id, created_at desc);

-- normalized employee_login (lower+trim)
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

-- normalized admin_login (lower+trim)
create or replace function public.admin_login(
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
    v_row public.admin_accounts%rowtype;
begin
    if v_name = '' or v_code = '' then
        return jsonb_build_object(
            'is_valid', false,
            'employee_name', v_name_raw,
            'employee_code', v_code_raw,
            'role', null,
            'permissions', jsonb_build_object(
                'dashboard', false,
                'manage_data', false,
                'questions', false,
                'strategies', false
            )
        );
    end if;

    select *
    into v_row
    from public.admin_accounts
    where lower(btrim(employee_name)) = v_name
      and lower(btrim(employee_code)) = v_code
      and is_active = true
    limit 1;

    if not found then
        return jsonb_build_object(
            'is_valid', false,
            'employee_name', v_name_raw,
            'employee_code', v_code_raw,
            'role', null,
            'permissions', jsonb_build_object(
                'dashboard', false,
                'manage_data', false,
                'questions', false,
                'strategies', false
            )
        );
    end if;

    return jsonb_build_object(
        'is_valid', true,
        'employee_name', v_row.employee_name,
        'employee_code', v_row.employee_code,
        'role', v_row.role,
        'permissions', jsonb_build_object(
            'dashboard', v_row.can_view_dashboard,
            'manage_data', v_row.can_manage_data,
            'questions', v_row.can_manage_questions,
            'strategies', v_row.can_manage_strategies
        )
    );
end;
$$;

revoke all on function public.admin_login(text, text) from public;
grant execute on function public.admin_login(text, text) to anon, authenticated, service_role;

do $$
begin
    if exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'employee_identities'
    ) then
        -- refresh admin seed in case new columns were added
        insert into public.admin_accounts (
            employee_code,
            employee_name,
            role,
            can_view_dashboard,
            can_manage_data,
            can_manage_questions,
            can_manage_strategies,
            is_active
        )
        select
            employee_code,
            employee_name,
            'super_admin',
            true,
            true,
            true,
            true,
            true
        from public.employee_identities
        where employee_code like 'EMP_%'
        on conflict (employee_code)
        do update
        set employee_name = excluded.employee_name,
            role = excluded.role,
            can_view_dashboard = excluded.can_view_dashboard,
            can_manage_data = excluded.can_manage_data,
            can_manage_questions = excluded.can_manage_questions,
            can_manage_strategies = excluded.can_manage_strategies,
            is_active = excluded.is_active,
            updated_at = now();
    end if;
end;
$$;
