alter table if exists public.rule_questions
    add column if not exists importance text;

update public.rule_questions
set importance = 'M'
where importance is null
   or btrim(importance) = ''
   or upper(importance) not in ('H', 'M', 'L');

alter table if exists public.rule_questions
    alter column importance set default 'M';

alter table if exists public.rule_questions
    alter column importance set not null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'rule_questions_importance_check'
    ) then
        alter table public.rule_questions
            add constraint rule_questions_importance_check
            check (importance in ('H', 'M', 'L'));
    end if;
end $$;

create index if not exists rule_questions_importance_idx
    on public.rule_questions (rule_version_id, importance);
