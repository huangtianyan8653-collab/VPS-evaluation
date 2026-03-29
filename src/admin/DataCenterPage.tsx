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
} from 'lucide-react';
import { DIMENSIONS, MOCK_HOSPITALS, QUESTIONS, STRATEGIES } from '../lib/constants';
import type { Dimension } from '../lib/constants';
import { getStrategyKeyFromStates, normalizeBooleanState, normalizeStrategyKey } from '../lib/algorithm';
import { supabase } from '../lib/supabase';
import { useAppStore } from '../lib/store';

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
    rm: string;
    province: string;
    submitterName: string;
    submitterCode: string;
    ruleVersionId: string | null;
    ruleVersionCode: string | null;
    ruleVersionName: string | null;
    rulePublishedAt: string | null;
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

interface ExportQuestionColumn {
    id: string;
    label: string;
    dimensionRank: number;
    sortOrder: number;
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

function toBoolString(value: boolean): 'true' | 'false' {
    return value ? 'true' : 'false';
}

function formatScoreValue(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
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

function buildExportQuestionColumns(data: SurveyLog[]): ExportQuestionColumn[] {
    const map = new Map<string, ExportQuestionColumn>();

    data.forEach((log) => {
        log.detailedAnswers.forEach((answer) => {
            if (map.has(answer.questionId)) return;
            map.set(answer.questionId, {
                id: answer.questionId,
                label: answer.questionId,
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


export default function DataCenterPage() {
    const adminSession = useAppStore((state) => state.adminSession);
    const [viewDetail, setViewDetail] = useState<string | null>(null);
    const [logs, setLogs] = useState<SurveyLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showRecycleBin, setShowRecycleBin] = useState(false);
    const [isGroupedByLatest, setIsGroupedByLatest] = useState(false);
    const [selectedRm, setSelectedRm] = useState('all');
    const canManageData = Boolean(adminSession?.permissions.dataManage ?? (adminSession?.role === 'super_admin'));
    const canClearAllTestData = adminSession?.role === 'super_admin';
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
        const permissionHospitalMetaMap = new Map<string, { hospitalName: string; province: string; rm: string }>();
        const { data: permissionHospitals, error: permissionHospitalsError } = await supabase
            .from('employee_permissions')
            .select('hospital_code, hospital_name, province, rm')
            .eq('is_active', true);

        if (!permissionHospitalsError && permissionHospitals) {
            permissionHospitals.forEach((row) => {
                const code = typeof row.hospital_code === 'string' ? row.hospital_code.trim().toLowerCase() : '';
                const name = typeof row.hospital_name === 'string' ? row.hospital_name.trim() : '';
                const province = typeof row.province === 'string' ? row.province.trim() : '';
                const rm = typeof row.rm === 'string' ? row.rm.trim() : '';
                if (!code || permissionHospitalMetaMap.has(code)) return;
                permissionHospitalMetaMap.set(code, { hospitalName: name, province, rm });
            });
        }

        const versionIds = Array.from(new Set(
            rows
                .map((item) => (typeof item.rule_version_id === 'string' ? item.rule_version_id : null))
                .filter((value): value is string => Boolean(value))
        ));

        const versionQuestionMeta = new Map<string, QuestionMeta>();
        const versionInfoMeta = new Map<string, { code: string | null; name: string | null; publishedAt: string | null }>();
        if (versionIds.length > 0) {
            const [{ data: ruleQuestions, error: ruleQuestionsError }, { data: ruleVersions, error: ruleVersionsError }] = await Promise.all([
                supabase
                    .from('rule_questions')
                    .select('rule_version_id, question_code, dimension, text, sort_order')
                    .in('rule_version_id', versionIds),
                supabase
                    .from('rule_versions')
                    .select('id, version_code, version_name, published_at')
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
                        publishedAt: typeof row.published_at === 'string' ? row.published_at : null,
                    });
                });
            }
        }

        return rows.map((item) => {
            const hospitalId = typeof item.hospital_id === 'string' ? item.hospital_id.trim() : String(item.hospital_id ?? '');
            const hospitalCodeKey = hospitalId.toLowerCase();
            const hospitalMetaFromPermissions = permissionHospitalMetaMap.get(hospitalCodeKey);
            const hospitalFromPermissions = hospitalMetaFromPermissions?.hospitalName;
            const hospitalFromRow = typeof item.hospital_name === 'string' ? item.hospital_name.trim() : '';
            const hospitalFromMock = MOCK_HOSPITALS.find((h) => h.id === hospitalId)?.name;
            const ruleVersionId = typeof item.rule_version_id === 'string' ? item.rule_version_id : null;
            const rawAnswersObject = (typeof item.raw_answers === 'object' && item.raw_answers !== null)
                ? (item.raw_answers as Record<string, unknown>)
                : {};
            const normalizedStates = normalizeStates(item.states);

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

            const strategyKey = normalizeStrategyKey(item.strategy_key) || getStrategyKeyFromStates(normalizedStates);
            const fallbackStrategy = STRATEGIES[strategyKey];

            return {
                id: String(item.id),
                hospitalId,
                hospitalName: hospitalFromPermissions || hospitalFromRow || hospitalFromMock || `未知医院(${hospitalId || 'N/A'})`,
                rm: hospitalMetaFromPermissions?.rm || (typeof item.rm === 'string' ? item.rm.trim() : ''),
                province: hospitalMetaFromPermissions?.province || (typeof item.province === 'string' ? item.province.trim() : ''),
                submitterName: typeof item.submitter_name === 'string' ? item.submitter_name.trim() : '',
                submitterCode: typeof item.submitter_code === 'string' ? item.submitter_code.trim() : '',
                ruleVersionId,
                ruleVersionCode: ruleVersionId ? (versionInfoMeta.get(ruleVersionId)?.code ?? null) : null,
                ruleVersionName: ruleVersionId ? (versionInfoMeta.get(ruleVersionId)?.name ?? null) : null,
                rulePublishedAt: ruleVersionId ? (versionInfoMeta.get(ruleVersionId)?.publishedAt ?? null) : null,
                scores: normalizeScores(item.scores),
                maxScores: normalizeScores(item.max_scores),
                states: normalizedStates,
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

    useEffect(() => {
        let isMounted = true;

        const load = async () => {
            const nextLogs = await fetchLogs();
            if (isMounted) {
                setLogs(nextLogs);
                setIsLoading(false);
            }
        };

        load();
        return () => {
            isMounted = false;
        };
    }, [fetchLogs]);

    const reloadLogs = useCallback(async () => {
        setIsLoading(true);
        const nextLogs = await fetchLogs();
        setLogs(nextLogs);
        setIsLoading(false);
    }, [fetchLogs]);

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

    const handleClearAllTestData = async () => {
        if (!canClearAllTestData) {
            alert('仅超级管理员可执行该操作。');
            return;
        }

        const firstConfirm = confirm('确认要清空全部测试数据吗？此操作会删除 survey_results 全部记录且无法恢复。');
        if (!firstConfirm) return;

        const verifyText = window.prompt('请输入“清空测试数据”以继续：');
        if (verifyText !== '清空测试数据') {
            alert('已取消：校验文本不匹配。');
            return;
        }

        const { error } = await supabase
            .from('survey_results')
            .delete()
            .not('id', 'is', null);

        if (error) {
            alert(`清空失败：${error.message}`);
            return;
        }

        alert('已清空全部测试数据。');
        setViewDetail(null);
        await reloadLogs();
    };

    const exportCompleteData = (dataToExport: SurveyLog[], fileNamePrefix: string) => {
        if (dataToExport.length === 0) return;
        const questionColumns = buildExportQuestionColumns(dataToExport);

        const headers = [
            'result_id',
            'submitted_at_utc',
            'hospital_name',
            'hospital_code',
            'province',
            'employee_name',
            'employee_id',
            'rule_version_code',
            'rule_published_at',
            'score_philosophy',
            'score_mechanism',
            'score_team',
            'score_tools',
            'state_philosophy',
            'state_mechanism',
            'state_team',
            'state_tools',
            'strategy_key',
            'strategy_name',
            ...questionColumns.map((column) => column.label),
        ];

        const rows = dataToExport.map((log) => {
            const row: Array<string | number> = [
                log.id,
                formatDisplayTime(log.timestamp),
                log.hospitalName,
                log.hospitalId,
                log.province,
                log.submitterName,
                log.submitterCode,
                log.ruleVersionCode ?? '',
                log.rulePublishedAt ? formatDisplayTime(log.rulePublishedAt) : '',
                log.scores.philosophy,
                log.scores.mechanism,
                log.scores.team,
                log.scores.tools,
                toBoolString(log.states.philosophy),
                toBoolString(log.states.mechanism),
                toBoolString(log.states.team),
                toBoolString(log.states.tools),
                log.strategyKey,
                log.strategyType ?? '',
            ];

            questionColumns.forEach((column) => {
                const hasAnswer = Object.prototype.hasOwnProperty.call(log.rawAnswers, column.id);
                if (!hasAnswer) {
                    row.push('未参与');
                    return;
                }
                row.push(log.rawAnswers[column.id] ? '是' : '否');
            });

            return row;
        });

        downloadCsv(buildCsv(headers, rows), fileNamePrefix);
    };

    const exportQuestionDictionary = async () => {
        const [{ data: questions, error: questionsError }, { data: versions, error: versionsError }] = await Promise.all([
            supabase
                .from('rule_questions')
                .select('rule_version_id, question_code, dimension, text, sort_order'),
            supabase
                .from('rule_versions')
                .select('id, version_code, version_name, published_at'),
        ]);

        if (questionsError || versionsError) {
            const message = questionsError?.message || versionsError?.message || '未知错误';
            alert(`导出题目字典失败：${message}`);
            return;
        }

        const versionCodeMap = new Map<string, { code: string; name: string; publishedAt: string }>();
        (versions ?? []).forEach((row) => {
            const id = typeof row.id === 'string' ? row.id : '';
            if (!id) return;
            versionCodeMap.set(id, {
                code: typeof row.version_code === 'string' ? row.version_code : '',
                name: typeof row.version_name === 'string' ? row.version_name : '',
                publishedAt: typeof row.published_at === 'string' ? formatDisplayTime(row.published_at) : '',
            });
        });

        const headers = [
            'question_id',
            'question_text',
            'dimension',
            'sort_order',
            'rule_version_code',
            'rule_version_name',
            'rule_published_at',
        ];

        const rows = (questions ?? [])
            .map((row) => {
                const versionId = typeof row.rule_version_id === 'string' ? row.rule_version_id : '';
                const version = versionCodeMap.get(versionId);
                const dimension = DIMENSIONS.includes(row.dimension as Dimension) ? row.dimension as Dimension : 'unknown';
                const sortOrder = Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0;
                return [
                    typeof row.question_code === 'string' ? row.question_code : '',
                    typeof row.text === 'string' ? row.text : '',
                    dimension === 'unknown' ? 'unknown' : DIMENSION_LABELS[dimension],
                    sortOrder,
                    version?.code ?? '',
                    version?.name ?? '',
                    version?.publishedAt ?? '',
                ] as Array<string | number>;
            })
            .sort((a, b) => {
                const versionDiff = String(a[4]).localeCompare(String(b[4]));
                if (versionDiff !== 0) return versionDiff;
                const dimensionOrder = ['理念', '机制', '团队', '工具', 'unknown'];
                const dimensionDiff = dimensionOrder.indexOf(String(a[2])) - dimensionOrder.indexOf(String(b[2]));
                if (dimensionDiff !== 0) return dimensionDiff;
                const sortDiff = Number(a[3]) - Number(b[3]);
                if (sortDiff !== 0) return sortDiff;
                return String(a[0]).localeCompare(String(b[0]));
            });

        downloadCsv(buildCsv(headers, rows), 'question-id-dictionary');
    };

    const detailData = logs.find((log) => log.id === viewDetail) ?? null;

    const rmOptions = useMemo(() => {
        const values = Array.from(
            new Set(
                logs
                    .map((log) => log.rm.trim())
                    .filter((rm) => rm.length > 0)
            )
        );
        return values.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    }, [logs]);

    const filteredLogs = useMemo(() => {
        if (selectedRm === 'all') return logs;
        return logs.filter((log) => log.rm.trim().toLowerCase() === selectedRm.toLowerCase());
    }, [logs, selectedRm]);

    const groupedData = useMemo(() => {
        if (!isGroupedByLatest || isRecycleBinView) return { latest: filteredLogs, history: [] as SurveyLog[] };

        const latestMap = new Map<string, SurveyLog>();
        const history: SurveyLog[] = [];

        filteredLogs.forEach((log) => {
            if (!latestMap.has(log.hospitalId)) {
                latestMap.set(log.hospitalId, log);
            } else {
                history.push(log);
            }
        });

        return { latest: Array.from(latestMap.values()), history };
    }, [filteredLogs, isGroupedByLatest, isRecycleBinView]);

    const renderTable = (data: SurveyLog[], title?: string) => (
        <div className="rounded-2xl overflow-hidden mb-8 med-panel">
            {title && (
                <div className="px-6 py-4 border-b border-blue-100 bg-blue-50/40 flex justify-between items-center">
                    <h2 className="text-sm font-bold text-slate-600 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                        {title}
                        <span className="text-xs font-normal text-slate-400 ml-1">({data.length} 条)</span>
                    </h2>
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
                        {isRecycleBinView ? '管理已移入回收站的调研记录。' : '查看调研流水，支持统一完整数据导出。'}
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

                    {canClearAllTestData && !isRecycleBinView && (
                        <button
                            onClick={handleClearAllTestData}
                            disabled={isLoading || logs.length === 0}
                            className="med-btn-sm med-button-danger disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <XCircle className="w-4 h-4" />
                            清空全部测试数据
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
                                value={selectedRm}
                                onChange={(event) => setSelectedRm(event.target.value)}
                                className="med-input bg-white text-slate-700 px-3 py-2 rounded-lg text-sm font-medium min-w-[140px]"
                            >
                                <option value="all">全部 RM</option>
                                {rmOptions.map((rm) => (
                                    <option key={rm} value={rm}>
                                        RM: {rm}
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={exportQuestionDictionary}
                                disabled={isLoading}
                                className="med-btn-sm med-button-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Download className="w-4 h-4" />
                                导出题目字典
                            </button>
                            <button
                                onClick={() => exportCompleteData(filteredLogs, selectedRm === 'all' ? 'survey-results-complete' : `survey-results-rm-${selectedRm}`)}
                                disabled={filteredLogs.length === 0 || isLoading}
                                className="med-btn-sm med-button-primary disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Download className="w-4 h-4" />
                                导出完整数据
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
                ) : filteredLogs.length === 0 ? (
                    <div className="rounded-2xl p-16 text-center text-slate-400 med-panel">
                        <p className="text-lg font-medium text-slate-500">
                            {isRecycleBinView ? '回收站为空' : selectedRm === 'all' ? '暂无调研流水' : '当前 RM 下暂无调研流水'}
                        </p>
                        <p className="text-sm mt-1">
                            {isRecycleBinView ? '这里没有被删除的记录。' : selectedRm === 'all' ? '前台（H5端）暂未提交任何评估数据' : `请切换 RM 或等待该 RM 提交数据`}
                        </p>
                    </div>
                ) : (
                    <>
                        {renderTable(
                            groupedData.latest,
                            isGroupedByLatest ? '各医院最新评估数据' : undefined,
                        )}
                        {isGroupedByLatest && groupedData.history.length > 0 &&
                            renderTable(groupedData.history, '历史评估流水')
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
                                const maxScore = detailData.maxScores[dimension] ?? 0;
                                const state = detailData.states[dimension];
                                const denominator = maxScore > 0 ? maxScore : dimensionAnswers.length;

                                return (
                                    <div key={dimension}>
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-2">
                                                <div className="w-1 h-5 rounded-full bg-primary-500" />
                                                <span className="font-bold text-slate-800">{DIMENSION_LABELS[dimension]} 维度</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-sm">
                                                <span className="text-slate-500">
                                                    得分 {formatScoreValue(score)} / {formatScoreValue(denominator)}
                                                </span>
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
