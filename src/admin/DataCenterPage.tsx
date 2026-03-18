import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Download,
    Eye,
    Clock,
    Target,
    Building2,
    Loader2,
    RefreshCw,
    CheckCircle2,
    XCircle,
    X,
    GitCompare,
} from 'lucide-react';
import { DIMENSIONS, MOCK_HOSPITALS, QUESTIONS, STRATEGIES } from '../lib/constants';
import type { Dimension } from '../lib/constants';
import { getStrategyKeyFromStates, normalizeBooleanState, toStateLabel } from '../lib/algorithm';
import { supabase } from '../lib/supabase';
import { fetchRuleByVersionId, fetchRuleVersions } from '../lib/rules';
import type { ActiveRule, RuleQuestion, RuleVersionListItem } from '../lib/rules';
import { useAppStore } from '../lib/store';

type AnswerValue = '是' | '否' | '未参与';

interface DetailedAnswer {
    questionId: string;
    dimension: Dimension | 'unknown';
    text: string;
    answer: boolean;
    sortOrder: number;
}

interface SurveyLog {
    id: string;
    hospitalId: string;
    hospitalName: string;
    ruleVersionId: string | null;
    ruleVersionCode: string | null;
    ruleVersionName: string | null;
    scores: Record<Dimension, number>;
    maxScores: Record<Dimension, number>;
    states: Record<Dimension, boolean>;
    strategyKey: string;
    strategyType?: string;
    strategyText?: string;
    failureActions: string[];
    timestamp: string;
    rawAnswers: Record<string, boolean>;
    detailedAnswers: DetailedAnswer[];
}

interface QuestionMeta {
    dimension: Dimension | 'unknown';
    text: string;
    sortOrder: number;
}

interface QuestionColumn {
    id: string;
    label: string;
    dimensionRank: number;
    sortOrder: number;
}

interface SimulationResult {
    states: Record<Dimension, boolean>;
    scores: Record<Dimension, number>;
    participatingMaxScores: Record<Dimension, number>;
    fullMaxScores: Record<Dimension, number>;
    thresholds: Record<Dimension, number>;
    effectiveThresholds: Record<Dimension, number | null>;
    coverages: Record<Dimension, number>;
    fallbacks: Record<Dimension, boolean>;
    strategyKey: string;
    strategyType: string;
    strategyText: string;
    answersByQuestion: Record<string, AnswerValue>;
}

const DIMENSION_LABELS: Record<Dimension, string> = {
    philosophy: '理念',
    mechanism: '机制',
    team: '团队',
    tools: '工具',
};

const DIMENSIONS_ORDER = [...DIMENSIONS];

const STATIC_QUESTION_META: Record<string, QuestionMeta> = QUESTIONS.reduce((acc, question, index) => {
    acc[question.id] = {
        dimension: question.dimension,
        text: question.text,
        sortOrder: index + 1,
    };
    return acc;
}, {} as Record<string, QuestionMeta>);

function createEmptyScores(): Record<Dimension, number> {
    return { philosophy: 0, mechanism: 0, team: 0, tools: 0 };
}

function normalizeScores(value: unknown): Record<Dimension, number> {
    const base = createEmptyScores();
    const source = (typeof value === 'object' && value !== null) ? (value as Record<string, unknown>) : {};

    DIMENSIONS.forEach((dimension) => {
        const parsed = Number(source[dimension]);
        base[dimension] = Number.isFinite(parsed) ? parsed : 0;
    });

    return base;
}

function normalizeStates(value: unknown): Record<Dimension, boolean> {
    const source = (typeof value === 'object' && value !== null) ? (value as Record<string, unknown>) : {};
    return {
        philosophy: normalizeBooleanState(source.philosophy),
        mechanism: normalizeBooleanState(source.mechanism),
        team: normalizeBooleanState(source.team),
        tools: normalizeBooleanState(source.tools),
    };
}

function normalizeAnswer(value: unknown): boolean {
    return value === true || value === 'true' || value === 1 || value === '1';
}

function formatDisplayTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toISOString().replace('T', ' ').slice(0, 19);
}

function getDimensionRank(value: Dimension | 'unknown'): number {
    if (value === 'unknown') return 99;
    return DIMENSIONS_ORDER.indexOf(value);
}

function toAnswerLabel(value: boolean): AnswerValue {
    return value ? '是' : '否';
}

function toPercent(value: number): string {
    return `${(value * 100).toFixed(2)}%`;
}

function toBoolString(value: boolean): 'true' | 'false' {
    return value ? 'true' : 'false';
}

function toBooleanZh(value: boolean): '是' | '否' {
    return value ? '是' : '否';
}

function toAnswerMachineValue(value: AnswerValue): '1' | '0' | '' {
    if (value === '是') return '1';
    if (value === '否') return '0';
    return '';
}

function buildCsv(headers: string[], rows: Array<Array<string | number>>): string {
    const escape = (value: string | number) => {
        const text = String(value ?? '');
        return text.includes(',') || text.includes('"') || text.includes('\n')
            ? `"${text.replace(/"/g, '""')}"`
            : text;
    };

    return '\uFEFF' + [headers, ...rows].map((row) => row.map(escape).join(',')).join('\n');
}

function downloadCsv(csvContent: string, fileNamePrefix: string) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${fileNamePrefix}-${new Date().getTime()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
}

function buildHistoricalQuestionColumns(data: SurveyLog[]): QuestionColumn[] {
    const map = new Map<string, QuestionColumn>();

    data.forEach((log) => {
        log.detailedAnswers.forEach((answer) => {
            if (map.has(answer.questionId)) return;
            const dimensionLabel = answer.dimension === 'unknown' ? '未知' : DIMENSION_LABELS[answer.dimension];
            map.set(answer.questionId, {
                id: answer.questionId,
                label: `${dimensionLabel}·${answer.questionId}`,
                dimensionRank: getDimensionRank(answer.dimension),
                sortOrder: answer.sortOrder,
            });
        });
    });

    return Array.from(map.values()).sort((a, b) => {
        if (a.dimensionRank !== b.dimensionRank) return a.dimensionRank - b.dimensionRank;
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.id.localeCompare(b.id);
    });
}

function buildSimulationQuestionColumns(questions: RuleQuestion[]): QuestionColumn[] {
    return questions
        .map((question, index) => ({
            id: question.id,
            label: `${DIMENSION_LABELS[question.dimension]}·${question.id}`,
            dimensionRank: getDimensionRank(question.dimension),
            sortOrder: Number.isFinite(Number(question.sortOrder)) ? Number(question.sortOrder) : index + 1,
        }))
        .sort((a, b) => {
            if (a.dimensionRank !== b.dimensionRank) return a.dimensionRank - b.dimensionRank;
            if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
            return a.id.localeCompare(b.id);
        });
}

function simulateLogWithRule(log: SurveyLog, rule: ActiveRule): SimulationResult {
    const scores = createEmptyScores();
    const participatingMaxScores = createEmptyScores();
    const fullMaxScores = createEmptyScores();
    const thresholds: Record<Dimension, number> = { ...rule.thresholds };
    const effectiveThresholds: Record<Dimension, number | null> = {
        philosophy: null,
        mechanism: null,
        team: null,
        tools: null,
    };
    const coverages: Record<Dimension, number> = createEmptyScores();
    const fallbacks: Record<Dimension, boolean> = {
        philosophy: false,
        mechanism: false,
        team: false,
        tools: false,
    };
    const states: Record<Dimension, boolean> = { ...log.states };
    const answersByQuestion: Record<string, AnswerValue> = {};

    const questionsByDimension: Record<Dimension, RuleQuestion[]> = {
        philosophy: [],
        mechanism: [],
        team: [],
        tools: [],
    };

    rule.questions.forEach((question) => {
        questionsByDimension[question.dimension].push(question);
        const hasAnswer = Object.prototype.hasOwnProperty.call(log.rawAnswers, question.id);
        if (!hasAnswer) {
            answersByQuestion[question.id] = '未参与';
        } else {
            answersByQuestion[question.id] = toAnswerLabel(log.rawAnswers[question.id]);
        }
    });

    DIMENSIONS.forEach((dimension) => {
        const dimensionQuestions = questionsByDimension[dimension];
        const totalWeight = dimensionQuestions.reduce((sum, question) => sum + Number(question.weight ?? 1), 0);

        let participatingWeight = 0;
        let score = 0;

        dimensionQuestions.forEach((question) => {
            const hasAnswer = Object.prototype.hasOwnProperty.call(log.rawAnswers, question.id);
            if (!hasAnswer) return;

            const weight = Number(question.weight ?? 1);
            participatingWeight += weight;
            if (log.rawAnswers[question.id]) {
                score += weight;
            }
        });

        fullMaxScores[dimension] = totalWeight;
        participatingMaxScores[dimension] = participatingWeight;
        scores[dimension] = score;
        coverages[dimension] = totalWeight > 0 ? (participatingWeight / totalWeight) : 0;

        if (totalWeight <= 0 || participatingWeight <= 0) {
            fallbacks[dimension] = true;
            states[dimension] = log.states[dimension];
            effectiveThresholds[dimension] = null;
            return;
        }

        const effectiveThreshold = thresholds[dimension] * (participatingWeight / totalWeight);
        effectiveThresholds[dimension] = effectiveThreshold;
        states[dimension] = score >= effectiveThreshold;
    });

    const strategyKey = getStrategyKeyFromStates(states);
    const strategyData = rule.strategies[strategyKey]
        || STRATEGIES[strategyKey]
        || { type: '未知分型', strategy: '策略未配置' };

    return {
        states,
        scores,
        participatingMaxScores,
        fullMaxScores,
        thresholds,
        effectiveThresholds,
        coverages,
        fallbacks,
        strategyKey,
        strategyType: strategyData.type,
        strategyText: strategyData.strategy,
        answersByQuestion,
    };
}

export default function DataCenterPage() {
    const adminSession = useAppStore((state) => state.adminSession);
    const [viewDetail, setViewDetail] = useState<string | null>(null);
    const [logs, setLogs] = useState<SurveyLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showRecycleBin, setShowRecycleBin] = useState(false);
    const [isGroupedByLatest, setIsGroupedByLatest] = useState(false);

    const [ruleVersions, setRuleVersions] = useState<RuleVersionListItem[]>([]);
    const [selectedSimulationVersionId, setSelectedSimulationVersionId] = useState('');
    const [simulationRule, setSimulationRule] = useState<ActiveRule | null>(null);
    const [isSimulationRuleLoading, setIsSimulationRuleLoading] = useState(false);
    const canManageData = Boolean(adminSession?.permissions.dataManage ?? (adminSession?.role === 'super_admin'));
    const isRecycleBinView = canManageData && showRecycleBin;

    const fetchLogs = useCallback(async () => {
        let query = supabase
            .from('survey_results')
            .select('*')
            .order('created_at', { ascending: false });

        if (isRecycleBinView) {
            query = query.not('deleted_at', 'is', null);
        } else {
            query = query.is('deleted_at', null);
        }

        const { data, error } = await query;
        if (error) {
            console.error('获取失败:', error);
            return [] as SurveyLog[];
        }

        const rows = data ?? [];
        const permissionHospitalNameMap = new Map<string, string>();
        const { data: permissionHospitals, error: permissionHospitalsError } = await supabase
            .from('employee_permissions')
            .select('hospital_code, hospital_name')
            .eq('is_active', true);

        if (!permissionHospitalsError && permissionHospitals) {
            permissionHospitals.forEach((row) => {
                const code = typeof row.hospital_code === 'string' ? row.hospital_code.trim().toLowerCase() : '';
                const name = typeof row.hospital_name === 'string' ? row.hospital_name.trim() : '';
                if (!code || !name || permissionHospitalNameMap.has(code)) return;
                permissionHospitalNameMap.set(code, name);
            });
        }

        const versionIds = Array.from(new Set(
            rows
                .map((item) => (typeof item.rule_version_id === 'string' ? item.rule_version_id : null))
                .filter((value): value is string => Boolean(value))
        ));

        const versionQuestionMeta = new Map<string, QuestionMeta>();
        const versionInfoMeta = new Map<string, { code: string | null; name: string | null }>();
        if (versionIds.length > 0) {
            const [{ data: ruleQuestions, error: ruleQuestionsError }, { data: ruleVersions, error: ruleVersionsError }] = await Promise.all([
                supabase
                    .from('rule_questions')
                    .select('rule_version_id, question_code, dimension, text, sort_order')
                    .in('rule_version_id', versionIds),
                supabase
                    .from('rule_versions')
                    .select('id, version_code, version_name')
                    .in('id', versionIds),
            ]);

            if (!ruleQuestionsError && ruleQuestions) {
                ruleQuestions.forEach((row, index) => {
                    const key = `${row.rule_version_id}:${row.question_code}`;
                    const dimension = DIMENSIONS.includes(row.dimension as Dimension) ? row.dimension as Dimension : 'unknown';
                    versionQuestionMeta.set(key, {
                        dimension,
                        text: typeof row.text === 'string' ? row.text : '未知问题',
                        sortOrder: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index + 1,
                    });
                });
            }

            if (!ruleVersionsError && ruleVersions) {
                ruleVersions.forEach((row) => {
                    if (typeof row.id !== 'string') return;
                    versionInfoMeta.set(row.id, {
                        code: typeof row.version_code === 'string' ? row.version_code : null,
                        name: typeof row.version_name === 'string' ? row.version_name : null,
                    });
                });
            }
        }

        return rows.map((item) => {
            const hospitalId = typeof item.hospital_id === 'string' ? item.hospital_id.trim() : String(item.hospital_id ?? '');
            const hospitalCodeKey = hospitalId.toLowerCase();
            const hospitalFromPermissions = permissionHospitalNameMap.get(hospitalCodeKey);
            const hospitalFromRow = typeof item.hospital_name === 'string' ? item.hospital_name.trim() : '';
            const hospitalFromMock = MOCK_HOSPITALS.find((h) => h.id === hospitalId)?.name;
            const ruleVersionId = typeof item.rule_version_id === 'string' ? item.rule_version_id : null;
            const rawAnswersObject = (typeof item.raw_answers === 'object' && item.raw_answers !== null)
                ? (item.raw_answers as Record<string, unknown>)
                : {};

            const rawAnswers: Record<string, boolean> = {};
            Object.entries(rawAnswersObject).forEach(([questionId, answer]) => {
                rawAnswers[questionId] = normalizeAnswer(answer);
            });

            const detailedAnswers = Object.entries(rawAnswers).map(([questionId, answer], index) => {
                const versionMeta = ruleVersionId ? versionQuestionMeta.get(`${ruleVersionId}:${questionId}`) : undefined;
                const staticMeta = STATIC_QUESTION_META[questionId];
                const meta = versionMeta || staticMeta || {
                    dimension: 'unknown' as const,
                    text: '未知问题',
                    sortOrder: index + 1,
                };

                return {
                    questionId,
                    dimension: meta.dimension,
                    text: meta.text,
                    answer,
                    sortOrder: meta.sortOrder,
                };
            }).sort((a, b) => {
                const dimensionDiff = getDimensionRank(a.dimension) - getDimensionRank(b.dimension);
                if (dimensionDiff !== 0) return dimensionDiff;
                if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
                return a.questionId.localeCompare(b.questionId);
            });

            const strategyKey = typeof item.strategy_key === 'string' ? item.strategy_key : '';
            const fallbackStrategy = STRATEGIES[strategyKey];

            return {
                id: String(item.id),
                hospitalId,
                hospitalName: hospitalFromPermissions || hospitalFromRow || hospitalFromMock || `未知医院(${hospitalId || 'N/A'})`,
                ruleVersionId,
                ruleVersionCode: ruleVersionId ? (versionInfoMeta.get(ruleVersionId)?.code ?? null) : null,
                ruleVersionName: ruleVersionId ? (versionInfoMeta.get(ruleVersionId)?.name ?? null) : null,
                scores: normalizeScores(item.scores),
                maxScores: normalizeScores(item.max_scores),
                states: normalizeStates(item.states),
                strategyKey,
                strategyType: typeof item.strategy_type === 'string' ? item.strategy_type : fallbackStrategy?.type,
                strategyText: typeof item.strategy_text === 'string' ? item.strategy_text : fallbackStrategy?.strategy,
                failureActions: Array.isArray(item.failure_actions) ? item.failure_actions as string[] : [],
                timestamp: typeof item.created_at === 'string' ? item.created_at : new Date().toISOString(),
                rawAnswers,
                detailedAnswers,
            };
        });
    }, [isRecycleBinView]);

    const loadRuleVersions = useCallback(async () => {
        const versions = await fetchRuleVersions();
        setRuleVersions(versions);

        setSelectedSimulationVersionId((prev) => {
            const exists = versions.some((version) => version.id === prev);
            if (exists) return prev;
            const activeVersion = versions.find((version) => version.isActive);
            return activeVersion?.id || versions[0]?.id || '';
        });
    }, []);

    useEffect(() => {
        let isMounted = true;

        const load = async () => {
            const [nextLogs] = await Promise.all([fetchLogs(), loadRuleVersions()]);
            if (isMounted) {
                setLogs(nextLogs);
                setIsLoading(false);
            }
        };

        load();
        return () => {
            isMounted = false;
        };
    }, [fetchLogs, loadRuleVersions]);

    useEffect(() => {
        let isMounted = true;

        const loadSimulationRule = async () => {
            if (!selectedSimulationVersionId) {
                setSimulationRule(null);
                return;
            }

            setIsSimulationRuleLoading(true);
            const rule = await fetchRuleByVersionId(selectedSimulationVersionId);
            if (isMounted) {
                setSimulationRule(rule.version ? rule : null);
                setIsSimulationRuleLoading(false);
            }
        };

        void loadSimulationRule();
        return () => {
            isMounted = false;
        };
    }, [selectedSimulationVersionId]);

    const reloadLogs = useCallback(async () => {
        setIsLoading(true);
        const nextLogs = await fetchLogs();
        setLogs(nextLogs);
        await loadRuleVersions();
        setIsLoading(false);
    }, [fetchLogs, loadRuleVersions]);

    const handleSoftDelete = async (id: string) => {
        if (!canManageData) {
            alert('当前账号仅可查看数据，未分配“改数据”权限。');
            return;
        }
        if (!confirm('确定要移入回收站吗？')) return;
        const { error } = await supabase
            .from('survey_results')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', id);

        if (error) {
            alert('删除失败: ' + error.message);
        } else {
            await reloadLogs();
        }
    };

    const handleRestore = async (id: string) => {
        if (!canManageData) {
            alert('当前账号仅可查看数据，未分配“改数据”权限。');
            return;
        }
        const { error } = await supabase
            .from('survey_results')
            .update({ deleted_at: null })
            .eq('id', id);

        if (error) {
            alert('恢复失败: ' + error.message);
        } else {
            await reloadLogs();
        }
    };

    const handlePermanentDelete = async (id: string) => {
        if (!canManageData) {
            alert('当前账号仅可查看数据，未分配“改数据”权限。');
            return;
        }
        if (!confirm('此操作将永久删除该记录，无法还原！确定继续吗？')) return;
        const { error } = await supabase
            .from('survey_results')
            .delete()
            .eq('id', id);

        if (error) {
            alert('永久删除失败: ' + error.message);
        } else {
            await reloadLogs();
        }
    };

    const exportHistoricalData = (dataToExport: SurveyLog[], fileNamePrefix: string) => {
        if (dataToExport.length === 0) return;

        const questionColumns = buildHistoricalQuestionColumns(dataToExport);
        const headers = [
            '记录ID',
            '医院名称',
            '医院ID',
            '评估时间(UTC)',
            'created_at_iso',
            '规则版本ID',
            '规则版本编码',
            '规则版本名称',
            '分型Key',
            '分型名称',
            '策略说明',
            '理念得分',
            '机制得分',
            '团队得分',
            '工具得分',
            '理念满分',
            '机制满分',
            '团队满分',
            '工具满分',
            '理念状态',
            '机制状态',
            '团队状态',
            '工具状态',
            '理念状态_bool',
            '机制状态_bool',
            '团队状态_bool',
            '工具状态_bool',
            ...questionColumns.map((column) => column.label),
            ...questionColumns.map((column) => `${column.label}_bool`),
        ];

        const rows = dataToExport.map((log) => {
            const baseRow: Array<string | number> = [
                log.id,
                log.hospitalName,
                log.hospitalId,
                `${formatDisplayTime(log.timestamp)} (UTC)`,
                log.timestamp,
                log.ruleVersionId ?? '',
                log.ruleVersionCode ?? '',
                log.ruleVersionName ?? '',
                log.strategyKey,
                log.strategyType ?? '',
                log.strategyText ?? '',
                log.scores.philosophy,
                log.scores.mechanism,
                log.scores.team,
                log.scores.tools,
                log.maxScores.philosophy,
                log.maxScores.mechanism,
                log.maxScores.team,
                log.maxScores.tools,
                toStateLabel(log.states.philosophy),
                toStateLabel(log.states.mechanism),
                toStateLabel(log.states.team),
                toStateLabel(log.states.tools),
                toBoolString(log.states.philosophy),
                toBoolString(log.states.mechanism),
                toBoolString(log.states.team),
                toBoolString(log.states.tools),
            ];

            questionColumns.forEach((column) => {
                const hasAnswer = Object.prototype.hasOwnProperty.call(log.rawAnswers, column.id);
                if (!hasAnswer) {
                    baseRow.push('未参与');
                } else {
                    baseRow.push(toAnswerLabel(log.rawAnswers[column.id]));
                }
            });

            questionColumns.forEach((column) => {
                const hasAnswer = Object.prototype.hasOwnProperty.call(log.rawAnswers, column.id);
                if (!hasAnswer) {
                    baseRow.push('');
                } else {
                    baseRow.push(toBoolString(log.rawAnswers[column.id]));
                }
            });

            return baseRow;
        });

        downloadCsv(buildCsv(headers, rows), fileNamePrefix);
    };

    const exportSimulatedData = (dataToExport: SurveyLog[], rule: ActiveRule) => {
        if (dataToExport.length === 0) return;

        const simVersionId = rule.version?.id ?? '';
        const simVersionCode = rule.version?.code ?? '';
        const simVersionName = rule.version?.name ?? '';
        const questionColumns = buildSimulationQuestionColumns(rule.questions);

        const headers = [
            '记录ID',
            '医院名称',
            '医院ID',
            '评估时间(UTC)',
            'created_at_iso',
            '历史规则版本ID',
            '历史规则版本编码',
            '历史规则版本名称',
            '模拟规则版本ID',
            '模拟规则版本编码',
            '模拟规则版本名称',
            '历史分型Key',
            '模拟分型Key',
            '分型是否变化',
            '分型是否变化_bool',
            '历史分型名称',
            '模拟分型名称',
            ...DIMENSIONS.flatMap((dimension) => [
                `${DIMENSION_LABELS[dimension]}历史状态`,
                `${DIMENSION_LABELS[dimension]}模拟状态`,
                `${DIMENSION_LABELS[dimension]}历史状态_bool`,
                `${DIMENSION_LABELS[dimension]}模拟状态_bool`,
                `${DIMENSION_LABELS[dimension]}状态是否变化`,
                `${DIMENSION_LABELS[dimension]}状态是否变化_bool`,
                `${DIMENSION_LABELS[dimension]}历史得分`,
                `${DIMENSION_LABELS[dimension]}模拟得分`,
                `${DIMENSION_LABELS[dimension]}模拟可参与满分`,
                `${DIMENSION_LABELS[dimension]}模拟全量满分`,
                `${DIMENSION_LABELS[dimension]}阈值原值`,
                `${DIMENSION_LABELS[dimension]}阈值折算值`,
                `${DIMENSION_LABELS[dimension]}覆盖率`,
                `${DIMENSION_LABELS[dimension]}覆盖率_ratio`,
                `${DIMENSION_LABELS[dimension]}回退历史值`,
                `${DIMENSION_LABELS[dimension]}回退历史值_bool`,
            ]),
            ...questionColumns.map((column) => `${column.label}(模拟版本答卷映射)`),
            ...questionColumns.map((column) => `${column.label}(模拟版本答卷映射)_bool`),
        ];

        const rows = dataToExport.map((log) => {
            const simulated = simulateLogWithRule(log, rule);
            const baseRow: Array<string | number> = [
                log.id,
                log.hospitalName,
                log.hospitalId,
                `${formatDisplayTime(log.timestamp)} (UTC)`,
                log.timestamp,
                log.ruleVersionId ?? '',
                log.ruleVersionCode ?? '',
                log.ruleVersionName ?? '',
                simVersionId,
                simVersionCode,
                simVersionName,
                log.strategyKey,
                simulated.strategyKey,
                log.strategyKey === simulated.strategyKey ? '否' : '是',
                log.strategyKey === simulated.strategyKey ? 'false' : 'true',
                log.strategyType ?? '',
                simulated.strategyType,
            ];

            DIMENSIONS.forEach((dimension) => {
                const stateChanged = log.states[dimension] !== simulated.states[dimension];
                baseRow.push(
                    toStateLabel(log.states[dimension]),
                    toStateLabel(simulated.states[dimension]),
                    toBoolString(log.states[dimension]),
                    toBoolString(simulated.states[dimension]),
                    toBooleanZh(stateChanged),
                    toBoolString(stateChanged),
                    log.scores[dimension],
                    simulated.scores[dimension],
                    simulated.participatingMaxScores[dimension],
                    simulated.fullMaxScores[dimension],
                    simulated.thresholds[dimension],
                    simulated.effectiveThresholds[dimension] === null ? 'N/A' : Number(simulated.effectiveThresholds[dimension]!.toFixed(4)),
                    toPercent(simulated.coverages[dimension]),
                    Number(simulated.coverages[dimension].toFixed(6)),
                    toBooleanZh(simulated.fallbacks[dimension]),
                    toBoolString(simulated.fallbacks[dimension]),
                );
            });

            questionColumns.forEach((column) => {
                baseRow.push(simulated.answersByQuestion[column.id] ?? '未参与');
            });

            questionColumns.forEach((column) => {
                const answer = simulated.answersByQuestion[column.id] ?? '未参与';
                baseRow.push(toAnswerMachineValue(answer));
            });

            return baseRow;
        });

        const prefix = `simulated-${simVersionCode || simVersionId}`;
        downloadCsv(buildCsv(headers, rows), prefix);
    };

    const exportDiffData = (dataToExport: SurveyLog[], rule: ActiveRule) => {
        if (dataToExport.length === 0) return;

        const simVersionId = rule.version?.id ?? '';
        const simVersionCode = rule.version?.code ?? '';
        const simVersionName = rule.version?.name ?? '';

        const headers = [
            '记录ID',
            '医院名称',
            '医院ID',
            '评估时间(UTC)',
            'created_at_iso',
            '历史规则版本ID',
            '历史规则版本编码',
            '历史规则版本名称',
            '模拟规则版本ID',
            '模拟规则版本编码',
            '模拟规则版本名称',
            '历史分型Key',
            '模拟分型Key',
            '分型是否变化',
            '分型是否变化_bool',
            ...DIMENSIONS.flatMap((dimension) => [
                `${DIMENSION_LABELS[dimension]}历史状态`,
                `${DIMENSION_LABELS[dimension]}模拟状态`,
                `${DIMENSION_LABELS[dimension]}历史状态_bool`,
                `${DIMENSION_LABELS[dimension]}模拟状态_bool`,
                `${DIMENSION_LABELS[dimension]}状态是否变化`,
                `${DIMENSION_LABELS[dimension]}状态是否变化_bool`,
                `${DIMENSION_LABELS[dimension]}覆盖率`,
                `${DIMENSION_LABELS[dimension]}覆盖率_ratio`,
                `${DIMENSION_LABELS[dimension]}回退历史值`,
                `${DIMENSION_LABELS[dimension]}回退历史值_bool`,
            ]),
        ];

        const rows = dataToExport.map((log) => {
            const simulated = simulateLogWithRule(log, rule);
            const row: Array<string | number> = [
                log.id,
                log.hospitalName,
                log.hospitalId,
                `${formatDisplayTime(log.timestamp)} (UTC)`,
                log.timestamp,
                log.ruleVersionId ?? '',
                log.ruleVersionCode ?? '',
                log.ruleVersionName ?? '',
                simVersionId,
                simVersionCode,
                simVersionName,
                log.strategyKey,
                simulated.strategyKey,
                log.strategyKey === simulated.strategyKey ? '否' : '是',
                log.strategyKey === simulated.strategyKey ? 'false' : 'true',
            ];

            DIMENSIONS.forEach((dimension) => {
                const stateChanged = log.states[dimension] !== simulated.states[dimension];
                row.push(
                    toStateLabel(log.states[dimension]),
                    toStateLabel(simulated.states[dimension]),
                    toBoolString(log.states[dimension]),
                    toBoolString(simulated.states[dimension]),
                    toBooleanZh(stateChanged),
                    toBoolString(stateChanged),
                    toPercent(simulated.coverages[dimension]),
                    Number(simulated.coverages[dimension].toFixed(6)),
                    toBooleanZh(simulated.fallbacks[dimension]),
                    toBoolString(simulated.fallbacks[dimension]),
                );
            });

            return row;
        });

        const prefix = `diff-${simVersionCode || simVersionId}`;
        downloadCsv(buildCsv(headers, rows), prefix);
    };

    const handleExportSimulated = () => {
        if (!simulationRule) {
            alert('请先选择一个可用的模拟规则版本。');
            return;
        }
        exportSimulatedData(logs, simulationRule);
    };

    const handleExportDiff = () => {
        if (!simulationRule) {
            alert('请先选择一个可用的模拟规则版本。');
            return;
        }
        exportDiffData(logs, simulationRule);
    };

    const detailData = logs.find((log) => log.id === viewDetail) ?? null;

    const groupedData = useMemo(() => {
        if (!isGroupedByLatest || isRecycleBinView) return { latest: logs, history: [] as SurveyLog[] };

        const latestMap = new Map<string, SurveyLog>();
        const history: SurveyLog[] = [];

        logs.forEach((log) => {
            if (!latestMap.has(log.hospitalId)) {
                latestMap.set(log.hospitalId, log);
            } else {
                history.push(log);
            }
        });

        return { latest: Array.from(latestMap.values()), history };
    }, [isGroupedByLatest, logs, isRecycleBinView]);

    const renderTable = (data: SurveyLog[], title?: string, fileName?: string) => (
        <div className="rounded-2xl overflow-hidden mb-8 med-panel">
            {title && (
                <div className="px-6 py-4 border-b border-blue-100 bg-blue-50/40 flex justify-between items-center">
                    <h2 className="text-sm font-bold text-slate-600 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                        {title}
                        <span className="text-xs font-normal text-slate-400 ml-1">({data.length} 条)</span>
                    </h2>
                    {fileName && (
                        <button
                            onClick={() => exportHistoricalData(data, fileName)}
                            className="med-btn-sm med-button-secondary text-xs"
                        >
                            <Download className="w-3.5 h-3.5" />
                            导出本段历史
                        </button>
                    )}
                </div>
            )}
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-xs uppercase tracking-wider text-slate-500">
                        <th className="p-4 font-semibold">调研医院</th>
                        <th className="p-4 font-semibold">评估时间</th>
                        <th className="p-4 font-semibold">分型诊断</th>
                        <th className="p-4 font-semibold">四要素得分 (P-M-T-To)</th>
                        <th className="p-4 text-right font-semibold">操作</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {data.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50/50 transition-colors group">
                            <td className="p-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                                        <Building2 className="w-4 h-4 text-slate-500" />
                                    </div>
                                    <div>
                                        <div className="font-semibold text-slate-800">{log.hospitalName}</div>
                                        <div className="text-xs text-slate-400 font-mono">{log.hospitalId}</div>
                                    </div>
                                </div>
                            </td>
                            <td className="p-4">
                                <div className="flex items-center gap-2 text-sm text-slate-600">
                                    <Clock className="w-4 h-4 text-slate-400" />
                                    {formatDisplayTime(log.timestamp)} (UTC)
                                </div>
                            </td>
                            <td className="p-4">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-primary-50 text-primary-700">
                                    <Target className="w-3.5 h-3.5" />
                                    {log.strategyKey}
                                </span>
                            </td>
                            <td className="p-4">
                                <div className="flex gap-1.5 font-mono text-sm">
                                    <span className="w-6 h-6 rounded flex items-center justify-center bg-slate-100 text-slate-600">{log.scores.philosophy}</span>
                                    <span className="w-6 h-6 rounded flex items-center justify-center bg-slate-100 text-slate-600">{log.scores.mechanism}</span>
                                    <span className="w-6 h-6 rounded flex items-center justify-center bg-slate-100 text-slate-600">{log.scores.team}</span>
                                    <span className="w-6 h-6 rounded flex items-center justify-center bg-slate-100 text-slate-600">{log.scores.tools}</span>
                                </div>
                            </td>
                            <td className="p-4 text-right">
                                <div className="flex items-center justify-end gap-2">
                                    <button
                                        onClick={() => setViewDetail(log.id)}
                                        className="med-btn-sm med-button-secondary"
                                    >
                                        <Eye className="w-4 h-4" />
                                        详情
                                    </button>
                                    {!canManageData ? (
                                        <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-500">
                                            只读
                                        </span>
                                    ) : isRecycleBinView ? (
                                        <>
                                            <button
                                                onClick={() => handleRestore(log.id)}
                                                className="med-btn-sm med-button-primary"
                                            >
                                                <CheckCircle2 className="w-4 h-4" />
                                                还原
                                            </button>
                                            <button
                                                onClick={() => handlePermanentDelete(log.id)}
                                                className="med-btn-sm med-button-danger"
                                            >
                                                <XCircle className="w-4 h-4" />
                                                彻底删除
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            onClick={() => handleSoftDelete(log.id)}
                                            className="med-btn-sm med-button-danger"
                                        >
                                            <XCircle className="w-4 h-4" />
                                            删除
                                        </button>
                                    )}
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="p-6 rounded-2xl flex justify-between items-end med-panel">
                <div>
                    <h1 className="med-title-xl text-slate-800 mb-2">
                        {isRecycleBinView ? '回收站' : '数据中心看板'}
                    </h1>
                    <p className="med-subtitle text-slate-600">
                        {isRecycleBinView ? '管理已移入回收站的调研记录。' : '查看调研流水，支持历史回放、规则模拟和差异导出。'}
                    </p>
                    {!canManageData && (
                        <p className="text-xs mt-2 text-amber-600 font-medium">
                            当前为只读权限：可查看和导出，不可删除/还原/彻底删除。
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-3 flex-wrap justify-end">
                    {!isRecycleBinView && (
                        <button
                            onClick={() => setIsGroupedByLatest(!isGroupedByLatest)}
                            className={`med-btn-sm transition-colors ${isGroupedByLatest
                                ? 'med-button-primary'
                                : 'med-button-secondary'
                                }`}
                        >
                            <Building2 className="w-4 h-4" />
                            {isGroupedByLatest ? '显示全量数据' : '按医院最新数据'}
                        </button>
                    )}

                    {canManageData && (
                        <button
                            onClick={() => {
                                setIsLoading(true);
                                setShowRecycleBin(!showRecycleBin);
                            }}
                            className={`med-btn-sm transition-colors ${isRecycleBinView
                                ? 'med-button-primary'
                                : 'med-button-secondary'
                                }`}
                        >
                            <Download className="w-4 h-4 rotate-180" />
                            {isRecycleBinView ? '返回看板' : '回收站'}
                        </button>
                    )}

                    <button
                        onClick={reloadLogs}
                        disabled={isLoading}
                        className="med-btn-sm med-button-secondary disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                        刷新
                    </button>

                    {!isRecycleBinView && (
                        <>
                            <select
                                value={selectedSimulationVersionId}
                                onChange={(event) => setSelectedSimulationVersionId(event.target.value)}
                                className="med-input bg-white text-slate-700 px-3 py-2 rounded-lg text-sm font-medium max-w-[320px]"
                            >
                                {ruleVersions.length === 0 && <option value="">暂无规则版本</option>}
                                {ruleVersions.map((version) => (
                                    <option key={version.id} value={version.id}>
                                        {version.code} {version.isActive ? '（当前激活）' : ''} - {version.name}
                                    </option>
                                ))}
                            </select>

                            <button
                                onClick={() => exportHistoricalData(logs, 'historical')}
                                disabled={logs.length === 0 || isLoading}
                                className="med-btn-sm med-button-primary disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Download className="w-4 h-4" />
                                导出历史回放
                            </button>

                            <button
                                onClick={handleExportSimulated}
                                disabled={logs.length === 0 || isLoading || isSimulationRuleLoading || !simulationRule}
                                className="med-btn-sm med-button-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSimulationRuleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                导出模拟结果
                            </button>

                            <button
                                onClick={handleExportDiff}
                                disabled={logs.length === 0 || isLoading || isSimulationRuleLoading || !simulationRule}
                                className="med-btn-sm med-button-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <GitCompare className="w-4 h-4" />
                                导出差异对比
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="min-h-[400px]">
                {isLoading ? (
                    <div className="rounded-2xl p-16 text-center text-slate-400 med-panel">
                        <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin text-primary-500" />
                        <p className="text-sm font-medium">正在读取数据...</p>
                    </div>
                ) : logs.length === 0 ? (
                    <div className="rounded-2xl p-16 text-center text-slate-400 med-panel">
                        <p className="text-lg font-medium text-slate-500">
                            {isRecycleBinView ? '回收站为空' : '暂无调研流水'}
                        </p>
                        <p className="text-sm mt-1">
                            {isRecycleBinView ? '这里没有被删除的记录。' : '前台（H5端）暂未提交任何评估数据'}
                        </p>
                    </div>
                ) : (
                    <>
                        {renderTable(
                            groupedData.latest,
                            isGroupedByLatest ? '各医院最新评估数据' : undefined,
                            isGroupedByLatest ? 'historical-latest' : undefined,
                        )}
                        {isGroupedByLatest && groupedData.history.length > 0 &&
                            renderTable(groupedData.history, '历史评估流水', 'historical-history')
                        }
                    </>
                )}
            </div>

            {detailData && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="rounded-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden med-panel">
                        <div className="px-6 py-4 border-b border-blue-100 flex justify-between items-center">
                            <div>
                                <h3 className="font-bold text-slate-800 text-lg">{detailData.hospitalName}</h3>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    {formatDisplayTime(detailData.timestamp)} (UTC)
                                    &nbsp;&middot;&nbsp;
                                    分型：<span className="text-primary-600 font-semibold">{detailData.strategyKey}</span>
                                    &nbsp;&middot;&nbsp;
                                    四要素：
                                    <span className="font-mono text-slate-600">
                                        {detailData.scores.philosophy}-{detailData.scores.mechanism}-{detailData.scores.team}-{detailData.scores.tools}
                                    </span>
                                </p>
                            </div>
                            <button
                                onClick={() => setViewDetail(null)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="overflow-y-auto flex-1 p-6 space-y-6">
                            {DIMENSIONS_ORDER.map((dimension) => {
                                const dimensionAnswers = detailData.detailedAnswers.filter((answer) => answer.dimension === dimension);
                                if (dimensionAnswers.length === 0) return null;

                                const score = detailData.scores[dimension] ?? 0;
                                const state = detailData.states[dimension];

                                return (
                                    <div key={dimension}>
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-2">
                                                <div className="w-1 h-5 rounded-full bg-primary-500" />
                                                <span className="font-bold text-slate-800">{DIMENSION_LABELS[dimension]} 维度</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-sm">
                                                <span className="text-slate-500">得分 {score} / {dimensionAnswers.length}</span>
                                                <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${state ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'}`}>
                                                    {state ? 'H（高）' : 'L（低）'}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="rounded-xl border border-slate-200 overflow-hidden">
                                            <table className="w-full text-sm">
                                                <thead>
                                                    <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                                                        <th className="px-4 py-2.5 text-left font-semibold w-8">#</th>
                                                        <th className="px-4 py-2.5 text-left font-semibold">题目</th>
                                                        <th className="px-4 py-2.5 text-center font-semibold w-20">答案</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {dimensionAnswers.map((answer, index) => (
                                                        <tr key={`${answer.questionId}-${index}`} className="hover:bg-slate-50/60 transition-colors">
                                                            <td className="px-4 py-3 text-xs text-slate-400 font-mono">{index + 1}</td>
                                                            <td className="px-4 py-3 text-slate-700 leading-relaxed">{answer.text}</td>
                                                            <td className="px-4 py-3 text-center">
                                                                {answer.answer ? (
                                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-600">
                                                                        <CheckCircle2 className="w-3.5 h-3.5" />是
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-50 text-rose-500">
                                                                        <XCircle className="w-3.5 h-3.5" />否
                                                                    </span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
