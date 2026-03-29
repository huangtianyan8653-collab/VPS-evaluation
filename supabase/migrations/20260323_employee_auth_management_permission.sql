-- Employee auth management permission for admin accounts
-- Purpose:
-- 1) Add independent permission: can_manage_employee_auth
-- 2) Include `employee_auth` in admin_login permissions payload

alter table if exists public.admin_accounts
    add column if not exists can_manage_employee_auth boolean not null default false;

do $$
begin
    if exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'admin_accounts'
    ) then
        execute $sql$
            update public.admin_accounts
            set can_manage_employee_auth = true
            where role = 'super_admin'
        $sql$;
    end if;
end;
$$;

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
                'strategies', false,
                'employee_auth', false
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
                'strategies', false,
                'employee_auth', false
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
            'strategies', v_row.can_manage_strategies,
            'employee_auth', coalesce(v_row.can_manage_employee_auth, false)
        )
    );
end;
$$;

revoke all on function public.admin_login(text, text) from public;
grant execute on function public.admin_login(text, text) to anon, authenticated, service_role;
