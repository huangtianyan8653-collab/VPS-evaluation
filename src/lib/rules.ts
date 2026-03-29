import { DIMENSIONS, QUESTIONS, STRATEGIES, THRESHOLDS } from './constants';
import type { Dimension, ImportanceLevel, Question, StrategyProfile } from './constants';
import { normalizeStrategyKey } from './algorithm';
import { supabase } from './supabase';

export interface RuleQuestion extends Question {
    weight: number;
    sortOrder: number;
    isDecisive: boolean;
    importance: ImportanceLevel;
}

export interface RuleVersionMeta {
    id: string;
    name: string;
    code: string;
    isActive?: boolean;
    publishedAt: string | null;
    createdAt?: string | null;
}

export interface ActiveRule {
    version: RuleVersionMeta | null;
    questions: RuleQuestion[];
    thresholds: Record<Dimension, number>;
    strategies: Record<string, StrategyProfile>;
    source: 'cloud' | 'fallback';
}

export interface PublishRuleInput {
    versionName?: string;
    questions: RuleQuestion[];
    thresholds: Record<Dimension, number>;
    strategies: Record<string, StrategyProfile>;
}

export interface PublishRuleResult {
    versionId: string;
    versionCode: string;
    versionName: string;
}

export interface UpdateActiveStrategyConfigInput {
    thresholds: Record<Dimension, number>;
    strategies: Record<string, StrategyProfile>;
}

export interface UpdateActiveStrategyConfigResult {
    versionId: string;
    versionCode: string;
    versionName: string;
    updatedAt: string;
}

export type RuleVersionListItem = Required<Pick<RuleVersionMeta, 'id' | 'name' | 'code' | 'publishedAt'>> &
    Pick<RuleVersionMeta, 'isActive' | 'createdAt'>;

function toNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toNonNegativeInteger(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return Math.max(0, Math.round(Number(fallback)));
    }
    return Math.max(0, Math.round(parsed));
}

function normalizeImportance(value: unknown, fallback: ImportanceLevel = 'M'): ImportanceLevel {
    if (typeof value === 'string') {
        const normalized = value.trim().toUpperCase();
        if (normalized === 'H' || normalized === 'M' || normalized === 'L') {
            return normalized;
        }
    }
    return fallback;
}

function isDimension(value: unknown): value is Dimension {
    return typeof value === 'string' && DIMENSIONS.includes(value as Dimension);
}

function toRuleQuestion(question: Question, sortOrder: number): RuleQuestion {
    return {
        ...question,
        weight: toNonNegativeInteger(question.weight, 1),
        sortOrder,
        isDecisive: Boolean(question.isDecisive),
        importance: normalizeImportance(question.importance, 'M'),
    };
}

function normalizeRuleQuestions(questions: RuleQuestion[]): RuleQuestion[] {
    return questions
        .map((question, index) => ({
            ...question,
            id: question.id.trim(),
            text: question.text.trim(),
            description: question.description.trim(),
            failureAction: question.failureAction.trim(),
            weight: toNonNegativeInteger(question.weight, 1),
            sortOrder: toNumber(question.sortOrder, index),
            isDecisive: Boolean(question.isDecisive),
            importance: normalizeImportance(question.importance, 'M'),
        }))
        .filter((question) => question.id.length > 0 && question.text.length > 0)
        .sort((a, b) => a.sortOrder - b.sortOrder);
}

function buildVersionCode() {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const suffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `rv-${stamp}-${suffix}`;
}

function buildVersionName(input?: string) {
    const trimmed = input?.trim();
    if (trimmed) return trimmed;
    return `规则发布 ${new Date().toLocaleString()}`;
}

function toRuleVersionMeta(row: Record<string, unknown>): RuleVersionMeta {
    return {
        id: typeof row.id === 'string' ? row.id : '',
        name: typeof row.version_name === 'string' ? row.version_name : '未命名版本',
        code: typeof row.version_code === 'string' ? row.version_code : (typeof row.id === 'string' ? row.id : 'unknown'),
        isActive: Boolean(row.is_active),
        publishedAt: typeof row.published_at === 'string' ? row.published_at : null,
        createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    };
}

async function fetchRuleByPredicate(predicate: { field: 'is_active'; value: boolean } | { field: 'id'; value: string }): Promise<ActiveRule> {
    const fallback = getFallbackRule();

    let query = supabase
        .from('rule_versions')
        .select('id, version_name, version_code, is_active, published_at, created_at')
        .order('published_at', { ascending: false })
        .limit(1);

    if (predicate.field === 'is_active') {
        query = query.eq('is_active', predicate.value);
    } else {
        query = query.eq('id', predicate.value);
    }

    const { data: versionData, error: versionError } = await query.maybeSingle();

    if (versionError || !versionData?.id) {
        return fallback;
    }

    const version = toRuleVersionMeta(versionData as Record<string, unknown>);
    const versionId = version.id;

    const [questionsResult, thresholdsResult, strategiesResult] = await Promise.all([
        supabase
            .from('rule_questions')
            .select('question_code, dimension, text, description, failure_action, weight, sort_order, is_decisive, importance')
            .eq('rule_version_id', versionId)
            .order('sort_order', { ascending: true }),
        supabase
            .from('rule_thresholds')
            .select('dimension, threshold')
            .eq('rule_version_id', versionId),
        supabase
            .from('rule_strategies')
            .select('strategy_key, type, strategy, vps_hospital_level, mbti_persona, trait_description, guidance_direction')
            .eq('rule_version_id', versionId),
    ]);

    if (questionsResult.error || thresholdsResult.error || strategiesResult.error) {
        return fallback;
    }

    const cloudQuestions = (questionsResult.data ?? [])
        .filter((row) => isDimension(row.dimension))
        .map((row, index) => ({
            id: typeof row.question_code === 'string' ? row.question_code : `q_${index + 1}`,
            dimension: row.dimension as Dimension,
            text: typeof row.text === 'string' ? row.text : '',
            description: typeof row.description === 'string' ? row.description : '',
            failureAction: typeof row.failure_action === 'string' ? row.failure_action : '',
            weight: toNonNegativeInteger(row.weight, 1),
            sortOrder: toNumber(row.sort_order, index),
            isDecisive: Boolean(row.is_decisive),
            importance: normalizeImportance(row.importance, 'M'),
        }))
        .filter((row) => row.text.trim().length > 0);

    if (cloudQuestions.length === 0) {
        return fallback;
    }

    const thresholds: Record<Dimension, number> = { ...THRESHOLDS };
    (thresholdsResult.data ?? []).forEach((row) => {
        if (isDimension(row.dimension)) {
            thresholds[row.dimension] = toNonNegativeInteger(row.threshold, THRESHOLDS[row.dimension]);
        }
    });

    const strategies: Record<string, StrategyProfile> = {};
    (strategiesResult.data ?? []).forEach((row) => {
        const normalizedKey = normalizeStrategyKey(row.strategy_key);
        if (normalizedKey) {
            const mbtiPersona = typeof row.mbti_persona === 'string' ? row.mbti_persona : '';
            const guidanceDirection = typeof row.guidance_direction === 'string' ? row.guidance_direction : '';
            strategies[normalizedKey] = {
                type: mbtiPersona || (typeof row.type === 'string' ? row.type : '未命名分型'),
                strategy: guidanceDirection || (typeof row.strategy === 'string' ? row.strategy : ''),
                vpsLevel: typeof row.vps_hospital_level === 'string' ? row.vps_hospital_level : '',
                mbtiPersona: mbtiPersona || (typeof row.type === 'string' ? row.type : ''),
                traitDescription: typeof row.trait_description === 'string' ? row.trait_description : '',
                guidanceDirection: guidanceDirection || (typeof row.strategy === 'string' ? row.strategy : ''),
            };
        }
    });

    return {
        version: {
            id: version.id,
            name: version.name,
            code: version.code,
            isActive: version.isActive,
            publishedAt: version.publishedAt,
            createdAt: version.createdAt,
        },
        questions: cloudQuestions,
        thresholds,
        strategies: Object.keys(strategies).length > 0 ? strategies : { ...STRATEGIES },
        source: 'cloud',
    };
}

export function getFallbackRule(): ActiveRule {
    return {
        version: null,
        questions: QUESTIONS.map((question, index) => toRuleQuestion(question, index)),
        thresholds: { ...THRESHOLDS },
        strategies: { ...STRATEGIES },
        source: 'fallback',
    };
}

export async function fetchActiveRule(): Promise<ActiveRule> {
    return fetchRuleByPredicate({ field: 'is_active', value: true });
}

export async function fetchRuleByVersionId(versionId: string): Promise<ActiveRule> {
    const trimmed = versionId.trim();
    if (!trimmed) return getFallbackRule();
    return fetchRuleByPredicate({ field: 'id', value: trimmed });
}

export async function fetchRuleVersions(): Promise<RuleVersionListItem[]> {
    const { data, error } = await supabase
        .from('rule_versions')
        .select('id, version_name, version_code, is_active, published_at, created_at')
        .order('created_at', { ascending: false });

    if (error || !data) {
        return [];
    }

    return data
        .map((row) => toRuleVersionMeta(row as Record<string, unknown>))
        .filter((row) => row.id.length > 0)
        .map((row) => ({
            id: row.id,
            name: row.name,
            code: row.code,
            isActive: row.isActive ?? false,
            publishedAt: row.publishedAt,
            createdAt: row.createdAt,
        }));
}

export async function publishRuleVersion(input: PublishRuleInput): Promise<PublishRuleResult> {
    const questions = normalizeRuleQuestions(input.questions);
    if (questions.length === 0) {
        throw new Error('题库不能为空，至少保留一个题目。');
    }

    const versionName = buildVersionName(input.versionName);
    const versionCode = buildVersionCode();
    let versionId = '';

    try {
        const { data: versionRow, error: versionError } = await supabase
            .from('rule_versions')
            .insert({
                version_name: versionName,
                version_code: versionCode,
                is_active: false,
                published_at: new Date().toISOString(),
            })
            .select('id')
            .single();

        if (versionError || !versionRow?.id) {
            throw new Error(versionError?.message || '创建规则版本失败。');
        }

        versionId = String(versionRow.id);

        const questionRows = questions.map((question, index) => ({
            rule_version_id: versionId,
            question_code: question.id,
            dimension: question.dimension,
            text: question.text,
            description: question.description,
            failure_action: question.failureAction,
            weight: toNonNegativeInteger(question.weight, 1),
            sort_order: index + 1,
            is_decisive: Boolean(question.isDecisive),
            importance: normalizeImportance(question.importance, 'M'),
        }));

        const thresholdRows = DIMENSIONS.map((dimension) => ({
            rule_version_id: versionId,
            dimension,
            threshold: toNonNegativeInteger(input.thresholds[dimension], THRESHOLDS[dimension]),
        }));

        const normalizedStrategies = new Map<string, StrategyProfile>();
        Object.entries(input.strategies).forEach(([strategyKey, value]) => {
            const normalizedKey = normalizeStrategyKey(strategyKey);
            if (!normalizedKey) return;
            const mbtiPersona = value.mbtiPersona?.trim() || value.type.trim() || '未命名人格';
            const guidanceDirection = value.guidanceDirection?.trim() || value.strategy.trim();
            normalizedStrategies.set(normalizedKey, {
                type: mbtiPersona,
                strategy: guidanceDirection,
                vpsLevel: value.vpsLevel?.trim() ?? '',
                mbtiPersona,
                traitDescription: value.traitDescription?.trim() ?? '',
                guidanceDirection,
            });
        });

        const strategyRows = Array.from(normalizedStrategies.entries()).map(([strategyKey, value]) => ({
            rule_version_id: versionId,
            strategy_key: strategyKey,
            type: value.type,
            strategy: value.strategy,
            vps_hospital_level: value.vpsLevel ?? '',
            mbti_persona: value.mbtiPersona ?? value.type,
            trait_description: value.traitDescription ?? '',
            guidance_direction: value.guidanceDirection ?? value.strategy,
        }));

        if (strategyRows.length === 0) {
            throw new Error('策略配置不能为空。');
        }

        const [questionsInsertResult, thresholdsInsertResult, strategiesInsertResult] = await Promise.all([
            supabase.from('rule_questions').insert(questionRows),
            supabase.from('rule_thresholds').insert(thresholdRows),
            supabase.from('rule_strategies').insert(strategyRows),
        ]);

        if (questionsInsertResult.error) throw new Error(questionsInsertResult.error.message);
        if (thresholdsInsertResult.error) throw new Error(thresholdsInsertResult.error.message);
        if (strategiesInsertResult.error) throw new Error(strategiesInsertResult.error.message);

        const { error: deactivateError } = await supabase
            .from('rule_versions')
            .update({ is_active: false })
            .neq('id', versionId)
            .eq('is_active', true);
        if (deactivateError) throw new Error(deactivateError.message);

        const { error: activateError } = await supabase
            .from('rule_versions')
            .update({ is_active: true, published_at: new Date().toISOString() })
            .eq('id', versionId);
        if (activateError) throw new Error(activateError.message);

        return {
            versionId,
            versionCode,
            versionName,
        };
    } catch (error) {
        if (versionId) {
            await supabase.from('rule_versions').delete().eq('id', versionId);
        }
        throw error instanceof Error ? error : new Error('发布规则版本失败。');
    }
}

export async function updateActiveStrategyConfig(input: UpdateActiveStrategyConfigInput): Promise<UpdateActiveStrategyConfigResult> {
    const { data: activeVersionRow, error: activeVersionError } = await supabase
        .from('rule_versions')
        .select('id, version_name, version_code')
        .eq('is_active', true)
        .maybeSingle();

    if (activeVersionError) {
        throw new Error(activeVersionError.message);
    }

    if (!activeVersionRow?.id) {
        throw new Error('未检测到云端激活题库版本。请先在「题库与权重管理」发布题库版本。');
    }

    const versionId = String(activeVersionRow.id);
    const versionCode = typeof activeVersionRow.version_code === 'string' ? activeVersionRow.version_code : versionId;
    const versionName = typeof activeVersionRow.version_name === 'string' ? activeVersionRow.version_name : '未命名版本';

    const thresholdRows = DIMENSIONS.map((dimension) => ({
        rule_version_id: versionId,
        dimension,
        threshold: toNonNegativeInteger(input.thresholds[dimension], THRESHOLDS[dimension]),
    }));

    const normalizedStrategies = new Map<string, StrategyProfile>();
    Object.entries(input.strategies).forEach(([strategyKey, value]) => {
        const normalizedKey = normalizeStrategyKey(strategyKey);
        if (!normalizedKey) return;
        const mbtiPersona = value.mbtiPersona?.trim() || value.type.trim() || '未命名人格';
        const guidanceDirection = value.guidanceDirection?.trim() || value.strategy.trim();
        normalizedStrategies.set(normalizedKey, {
            type: mbtiPersona,
            strategy: guidanceDirection,
            vpsLevel: value.vpsLevel?.trim() ?? '',
            mbtiPersona,
            traitDescription: value.traitDescription?.trim() ?? '',
            guidanceDirection,
        });
    });

    const strategyRows = Array.from(normalizedStrategies.entries()).map(([strategyKey, value]) => ({
        rule_version_id: versionId,
        strategy_key: strategyKey,
        type: value.type,
        strategy: value.strategy,
        vps_hospital_level: value.vpsLevel ?? '',
        mbti_persona: value.mbtiPersona ?? value.type,
        trait_description: value.traitDescription ?? '',
        guidance_direction: value.guidanceDirection ?? value.strategy,
    }));

    if (strategyRows.length === 0) {
        throw new Error('策略配置不能为空。');
    }

    const [upsertThresholdsResult, upsertStrategiesResult] = await Promise.all([
        supabase
            .from('rule_thresholds')
            .upsert(thresholdRows, { onConflict: 'rule_version_id,dimension' }),
        supabase
            .from('rule_strategies')
            .upsert(strategyRows, { onConflict: 'rule_version_id,strategy_key' }),
    ]);

    if (upsertThresholdsResult.error) {
        throw new Error(upsertThresholdsResult.error.message);
    }

    if (upsertStrategiesResult.error) {
        throw new Error(upsertStrategiesResult.error.message);
    }

    const updatedAt = new Date().toISOString();
    const { error: touchVersionError } = await supabase
        .from('rule_versions')
        .update({ published_at: updatedAt })
        .eq('id', versionId);
    if (touchVersionError) {
        throw new Error(touchVersionError.message);
    }

    return {
        versionId,
        versionCode,
        versionName,
        updatedAt,
    };
}
