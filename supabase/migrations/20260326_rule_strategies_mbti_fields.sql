-- Add MBTI strategy detail fields for backend strategy import/editing
alter table if exists public.rule_strategies
    add column if not exists vps_hospital_level text not null default '',
    add column if not exists mbti_persona text not null default '',
    add column if not exists trait_description text not null default '',
    add column if not exists guidance_direction text not null default '';

-- Backfill legacy rows so old data remains visible in new UI
update public.rule_strategies
set
    mbti_persona = case when coalesce(trim(mbti_persona), '') = '' then coalesce(type, '') else mbti_persona end,
    guidance_direction = case when coalesce(trim(guidance_direction), '') = '' then coalesce(strategy, '') else guidance_direction end
where
    coalesce(trim(mbti_persona), '') = ''
    or coalesce(trim(guidance_direction), '') = '';
