-- VPS rules v1 migration
-- Goals:
-- 1) Rule config cloud publishing with versioning
-- 2) Survey results bind to published rule version
-- 3) states unified to boolean per dimension

create extension if not exists pgcrypto;

create table if not exists public.rule_versions (
    id uuid primary key default gen_random_uuid(),
    version_name text not null,
    version_code text not null unique,
    is_active boolean not null default false,
    published_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);

-- Ensure only one active rule version at any time
create unique index if not exists rule_versions_single_active_idx
    on public.rule_versions (is_active)
    where is_active = true;

create table if not exists public.rule_questions (
    id uuid primary key default gen_random_uuid(),
    rule_version_id uuid not null references public.rule_versions(id) on delete cascade,
    question_code text not null,
    dimension text not null check (dimension in ('philosophy', 'mechanism', 'team', 'tools')),
    text text not null,
    description text not null default '',
    failure_action text not null default '',
    weight numeric not null default 1,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    unique (rule_version_id, question_code)
);

create index if not exists rule_questions_rule_version_idx
    on public.rule_questions (rule_version_id, sort_order);

create table if not exists public.rule_thresholds (
    id uuid primary key default gen_random_uuid(),
    rule_version_id uuid not null references public.rule_versions(id) on delete cascade,
    dimension text not null check (dimension in ('philosophy', 'mechanism', 'team', 'tools')),
    threshold numeric not null default 1,
    created_at timestamptz not null default now(),
    unique (rule_version_id, dimension)
);

create table if not exists public.rule_strategies (
    id uuid primary key default gen_random_uuid(),
    rule_version_id uuid not null references public.rule_versions(id) on delete cascade,
    strategy_key text not null,
    type text not null,
    strategy text not null,
    created_at timestamptz not null default now(),
    unique (rule_version_id, strategy_key)
);

alter table if exists public.survey_results
    add column if not exists rule_version_id uuid references public.rule_versions(id),
    add column if not exists max_scores jsonb,
    add column if not exists strategy_type text,
    add column if not exists strategy_text text;

-- Backfill max_scores for old records (legacy bank: each dimension max=2)
update public.survey_results
set max_scores = jsonb_build_object(
    'philosophy', 2,
    'mechanism', 2,
    'team', 2,
    'tools', 2
)
where max_scores is null;

-- Normalize historical states to boolean json:
-- true for H/true/1, false for all others.
update public.survey_results
set states = jsonb_build_object(
    'philosophy',
        case when lower(coalesce(states->>'philosophy', '')) in ('h', 'true', '1') then true else false end,
    'mechanism',
        case when lower(coalesce(states->>'mechanism', '')) in ('h', 'true', '1') then true else false end,
    'team',
        case when lower(coalesce(states->>'team', '')) in ('h', 'true', '1') then true else false end,
    'tools',
        case when lower(coalesce(states->>'tools', '')) in ('h', 'true', '1') then true else false end
)
where states is not null;

create index if not exists survey_results_rule_version_idx
    on public.survey_results (rule_version_id);
