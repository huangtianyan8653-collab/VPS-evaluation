alter table if exists public.rule_questions
    add column if not exists is_decisive boolean not null default false;

create index if not exists rule_questions_is_decisive_idx
    on public.rule_questions (rule_version_id, is_decisive);
