-- Enforce integer weights and thresholds globally.

alter table if exists public.rule_questions
    alter column weight type integer using greatest(0, round(weight))::integer,
    alter column weight set default 1;

alter table if exists public.rule_thresholds
    alter column threshold type integer using greatest(0, round(threshold))::integer,
    alter column threshold set default 1;
