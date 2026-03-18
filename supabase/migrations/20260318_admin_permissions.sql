-- Admin permission configuration
-- Purpose:
-- 1) Configure which employee accounts can log into /admin
-- 2) Configure menu-level permissions for dashboard/questions/strategies

create extension if not exists pgcrypto;

create table if not exists public.admin_accounts (
    id uuid primary key default gen_random_uuid(),
    employee_code text not null unique,
    employee_name text not null,
    role text not null default 'admin' check (role in ('super_admin', 'admin', 'viewer')),
    can_view_dashboard boolean not null default true,
    can_manage_data boolean not null default false,
    can_manage_questions boolean not null default false,
    can_manage_strategies boolean not null default false,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table if exists public.admin_accounts
    add column if not exists can_manage_data boolean not null default false;

create index if not exists admin_accounts_is_active_idx
    on public.admin_accounts (is_active);

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
    v_name text := btrim(coalesce(p_employee_name, ''));
    v_code text := btrim(coalesce(p_employee_code, ''));
    v_row public.admin_accounts%rowtype;
begin
    if v_name = '' or v_code = '' then
        return jsonb_build_object(
            'is_valid', false,
            'employee_name', v_name,
            'employee_code', v_code,
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
    where employee_name = v_name
      and employee_code = v_code
      and is_active = true
    limit 1;

    if not found then
        return jsonb_build_object(
            'is_valid', false,
            'employee_name', v_name,
            'employee_code', v_code,
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

-- Seed managers (EMP_*) as super admins for quick start.
-- You can edit these records later in public.admin_accounts.
do $$
begin
    if exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'employee_identities'
    ) then
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
