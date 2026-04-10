-- Deploy schema guard (2026-04-10)
-- 目标：
-- 1) 补齐前端/后台依赖的新字段，避免 "Could not find column ... in schema cache"
-- 2) 兼容历史库结构差异
-- 3) 最后触发 PostgREST schema cache reload

-- =========================
-- rule_questions
-- =========================
alter table if exists public.rule_questions
    add column if not exists is_decisive boolean not null default false;

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

create index if not exists rule_questions_is_decisive_idx
    on public.rule_questions (rule_version_id, is_decisive);

create index if not exists rule_questions_importance_idx
    on public.rule_questions (rule_version_id, importance);

-- =========================
-- rule_strategies
-- =========================
alter table if exists public.rule_strategies
    add column if not exists vps_hospital_level text not null default '',
    add column if not exists mbti_persona text not null default '',
    add column if not exists trait_description text not null default '',
    add column if not exists guidance_direction text not null default '';

update public.rule_strategies
set
    mbti_persona = case
        when coalesce(trim(mbti_persona), '') = '' then coalesce(type, '')
        else mbti_persona
    end,
    guidance_direction = case
        when coalesce(trim(guidance_direction), '') = '' then coalesce(strategy, '')
        else guidance_direction
    end
where coalesce(trim(mbti_persona), '') = ''
   or coalesce(trim(guidance_direction), '') = '';

-- =========================
-- survey_results
-- =========================
alter table if exists public.survey_results
    add column if not exists submitter_name text,
    add column if not exists submitter_code text,
    add column if not exists rule_version_id uuid,
    add column if not exists max_scores jsonb,
    add column if not exists strategy_type text,
    add column if not exists strategy_text text,
    add column if not exists deleted_at timestamptz,
    add column if not exists raw_answers jsonb;

update public.survey_results
set raw_answers = '{}'::jsonb
where raw_answers is null;

update public.survey_results
set max_scores = jsonb_build_object(
    'philosophy', 2,
    'mechanism', 2,
    'team', 2,
    'tools', 2
)
where max_scores is null;

create index if not exists survey_results_rule_version_idx
    on public.survey_results (rule_version_id);

create index if not exists survey_results_submitter_code_created_idx
    on public.survey_results (submitter_code, created_at desc);

create index if not exists survey_results_deleted_at_idx
    on public.survey_results (deleted_at);

-- =========================
-- refresh schema cache
-- =========================
notify pgrst, 'reload schema';

