import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Building2, ChevronRight, LogOut, Loader2 } from 'lucide-react';
import { MOCK_HOSPITALS } from '../lib/constants';
import type { Dimension } from '../lib/constants';
import { useAppStore } from '../lib/store';
import type { ResultData } from '../lib/store';
import { supabase } from '../lib/supabase';
import { getStrategyKeyFromStates, normalizeBooleanState, normalizeStrategyKey } from '../lib/algorithm';
import StatusBadge from '../components/StatusBadge';

interface HospitalOption {
    id: string;
    name: string;
}

interface HospitalViewItem extends HospitalOption {
    latestSubmittedAt: string | null;
    isCompleted: boolean;
    hasSyncError: boolean;
}

type HospitalFilter = 'all' | 'completed' | 'pending';

export default function SelectPage() {
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<HospitalFilter>('all');
    const [submittedAtByHospital, setSubmittedAtByHospital] = useState<Record<string, string>>({});
    const [isStatusLoading, setIsStatusLoading] = useState(false);
    const [reviewingHospitalId, setReviewingHospitalId] = useState<string | null>(null);
    const navigate = useNavigate();
    const { employeeSession, clearEmployeeSession, clearDrafts, clearResults, results, saveResult } = useAppStore();

    const hospitals = useMemo<HospitalOption[]>(() => {
        if (!employeeSession) return [];

        return employeeSession.hospitals.map((item) => {
            const mock = MOCK_HOSPITALS.find((hospital) => hospital.id === item.hospitalCode);
            return {
                id: item.hospitalCode,
                name: item.hospitalName || mock?.name || item.hospitalCode,
            };
        });
    }, [employeeSession]);

    const queryFiltered = hospitals.filter((hospital) =>
        hospital.name.includes(query) || hospital.id.toLowerCase().includes(query.toLowerCase())
    );

    useEffect(() => {
        let isMounted = true;

        const loadCompletionStatus = async () => {
            if (!employeeSession || hospitals.length === 0) {
                if (isMounted) {
                    setSubmittedAtByHospital({});
                }
                return;
            }

            setIsStatusLoading(true);
            const hospitalIds = hospitals.map((item) => item.id);

            const statusQuery = supabase
                .from('survey_results')
                .select('hospital_id, created_at')
                .eq('submitter_code', employeeSession.employeeId)
                .in('hospital_id', hospitalIds)
                .order('created_at', { ascending: false });

            let { data, error } = await statusQuery.is('deleted_at', null);

            if (error && /column .*deleted_at.* does not exist|schema cache/i.test(error.message)) {
                ({ data, error } = await supabase
                    .from('survey_results')
                    .select('hospital_id, created_at')
                    .eq('submitter_code', employeeSession.employeeId)
                    .in('hospital_id', hospitalIds)
                    .order('created_at', { ascending: false }));
            }

            if (error && /column .*submitter_code.* does not exist|schema cache/i.test(error.message)) {
                ({ data, error } = await supabase
                    .from('survey_results')
                    .select('hospital_id, created_at')
                    .in('hospital_id', hospitalIds)
                    .order('created_at', { ascending: false }));
            }

            if (!isMounted) return;

            if (error) {
                console.error('加载医院填写状态失败:', error);
                setSubmittedAtByHospital({});
                setIsStatusLoading(false);
                return;
            }

            const map: Record<string, string> = {};
            (data ?? []).forEach((row) => {
                const hospitalId = String(row.hospital_id ?? '');
                const createdAt = String(row.created_at ?? '');
                if (!hospitalId || !createdAt) return;
                if (!map[hospitalId]) {
                    map[hospitalId] = createdAt;
                }
            });

            setSubmittedAtByHospital(map);
            setIsStatusLoading(false);
        };

        void loadCompletionStatus();
        return () => {
            isMounted = false;
        };
    }, [employeeSession, hospitals]);

    const localSubmittedAtByHospital = useMemo(() => {
        const map: Record<string, string> = {};
        Object.entries(results).forEach(([hospitalId, result]) => {
            if (!result?.timestamp) return;
            map[hospitalId] = new Date(result.timestamp).toISOString();
        });
        return map;
    }, [results]);

    const viewItems = useMemo<HospitalViewItem[]>(() => {
        const items = queryFiltered.map((hospital) => {
            const cloudSubmittedAt = submittedAtByHospital[hospital.id] || null;
            const localSubmittedAt = localSubmittedAtByHospital[hospital.id] || null;
            const localResult = results[hospital.id];
            const latestSubmittedAt = cloudSubmittedAt || localSubmittedAt || null;
            return {
                ...hospital,
                latestSubmittedAt,
                isCompleted: Boolean(latestSubmittedAt),
                hasSyncError: !cloudSubmittedAt && Boolean(localResult?.cloudSynced === false),
            };
        });

        return items.sort((a, b) => {
            if (a.isCompleted !== b.isCompleted) return a.isCompleted ? -1 : 1;
            if (a.isCompleted && b.isCompleted) {
                const timeA = a.latestSubmittedAt ? new Date(a.latestSubmittedAt).getTime() : 0;
                const timeB = b.latestSubmittedAt ? new Date(b.latestSubmittedAt).getTime() : 0;
                if (timeA !== timeB) return timeB - timeA;
            }
            return a.name.localeCompare(b.name, 'zh-CN');
        });
    }, [queryFiltered, submittedAtByHospital, localSubmittedAtByHospital, results]);

    const completedCount = hospitals.filter((hospital) => Boolean(submittedAtByHospital[hospital.id] || localSubmittedAtByHospital[hospital.id])).length;
    const pendingCount = hospitals.length - completedCount;

    const filtered = useMemo(() => {
        if (filter === 'completed') return viewItems.filter((item) => item.isCompleted);
        if (filter === 'pending') return viewItems.filter((item) => !item.isCompleted);
        return viewItems;
    }, [filter, viewItems]);

    const groupedDisplay = useMemo(() => {
        if (filter === 'completed') {
            return [{ title: `已完成医院 (${filtered.length})`, data: filtered }];
        }
        if (filter === 'pending') {
            return [{ title: `待分型医院 (${filtered.length})`, data: filtered }];
        }
        return [
            { title: `已完成医院 (${filtered.filter((item) => item.isCompleted).length})`, data: filtered.filter((item) => item.isCompleted) },
            { title: `待分型医院 (${filtered.filter((item) => !item.isCompleted).length})`, data: filtered.filter((item) => !item.isCompleted) },
        ].filter((group) => group.data.length > 0);
    }, [filter, filtered]);

    const formatSubmittedAt = (isoTime: string): string => {
        const date = new Date(isoTime);
        if (Number.isNaN(date.getTime())) return '时间未知';
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
    };

    const handleLogout = () => {
        clearEmployeeSession();
        clearDrafts();
        clearResults();
        navigate('/auth', { replace: true });
    };

    const parseResultRow = (row: Record<string, unknown>): ResultData => {
        const parseScoreMap = (value: unknown): Record<Dimension, number> => {
            const source = (value && typeof value === 'object') ? (value as Record<string, unknown>) : {};
            return {
                philosophy: Number(source.philosophy ?? 0),
                mechanism: Number(source.mechanism ?? 0),
                team: Number(source.team ?? 0),
                tools: Number(source.tools ?? 0),
            };
        };

        const scores = parseScoreMap(row.scores);
        const maxScores = parseScoreMap((row.max_scores ?? row.maxScores) as unknown);
        const rawStates = (row.states && typeof row.states === 'object') ? (row.states as Record<string, unknown>) : {};
        const states: Record<Dimension, boolean> = {
            philosophy: normalizeBooleanState(rawStates.philosophy),
            mechanism: normalizeBooleanState(rawStates.mechanism),
            team: normalizeBooleanState(rawStates.team),
            tools: normalizeBooleanState(rawStates.tools),
        };

        const failureActions = Array.isArray(row.failure_actions)
            ? row.failure_actions.map((item) => String(item)).filter(Boolean)
            : [];

        const createdAt = String(row.created_at ?? '');
        const timestamp = Number.isNaN(new Date(createdAt).getTime()) ? Date.now() : new Date(createdAt).getTime();
        const cloudRecordId = row.id ? String(row.id) : null;

        return {
            scores,
            maxScores,
            states,
            strategyKey: normalizeStrategyKey(row.strategy_key) || getStrategyKeyFromStates(states),
            strategyType: row.strategy_type ? String(row.strategy_type) : undefined,
            strategyText: row.strategy_text ? String(row.strategy_text) : undefined,
            ruleVersionId: row.rule_version_id ? String(row.rule_version_id) : null,
            cloudRecordId,
            cloudCreatedAt: createdAt || null,
            cloudSynced: true,
            failureActions,
            timestamp,
        };
    };

    const handleReview = async (hospitalId: string) => {
        if (reviewingHospitalId) return;

        if (results[hospitalId]) {
            navigate(`/result/${hospitalId}`);
            return;
        }

        setReviewingHospitalId(hospitalId);

        try {
            const buildReviewQuery = (withSubmitter: boolean) => {
                let builder = supabase
                    .from('survey_results')
                    .select('id, created_at, scores, max_scores, states, strategy_key, strategy_type, strategy_text, rule_version_id, failure_actions')
                    .eq('hospital_id', hospitalId)
                    .order('created_at', { ascending: false })
                    .limit(1);

                if (withSubmitter && employeeSession?.employeeId) {
                    builder = builder.eq('submitter_code', employeeSession.employeeId);
                }

                return builder;
            };

            let { data, error } = await buildReviewQuery(true).is('deleted_at', null);

            if (error && /column .*deleted_at.* does not exist|schema cache/i.test(error.message)) {
                ({ data, error } = await buildReviewQuery(true));
            }

            if (error && /column .*submitter_code.* does not exist|schema cache/i.test(error.message)) {
                ({ data, error } = await buildReviewQuery(false));
            }

            if (error) {
                console.error('加载回顾数据失败:', error);
                alert('加载回顾数据失败，请稍后重试或联系管理员。');
                return;
            }

            const latest = (data ?? [])[0] as Record<string, unknown> | undefined;
            if (!latest) {
                alert('当前医院暂无已提交结果，请先完成填写。');
                navigate(`/survey/${hospitalId}`);
                return;
            }

            const restored = parseResultRow(latest);
            saveResult(hospitalId, restored);
            navigate(`/result/${hospitalId}`);
        } finally {
            setReviewingHospitalId(null);
        }
    };

    const handleUpdate = (hospitalId: string) => {
        navigate(`/survey/${hospitalId}`);
    };

    return (
        <div className="flex flex-col min-h-screen pb-10">
            <div className="med-hero p-6 pt-12 pb-12 rounded-b-[2.5rem] relative overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(rgba(188,219,255,0.2)_1px,transparent_1px)] [background-size:18px_18px] opacity-40" />
                <div className="absolute -right-12 -top-10 w-56 h-56 rounded-full bg-white/20 blur-3xl" />
                <div className="absolute -left-16 bottom-0 w-56 h-56 rounded-full bg-cyan-200/20 blur-3xl" />
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h1 className="med-title-hero mb-2">VPS分型诊断</h1>
                        <p className="med-subtitle-light opacity-95">聚焦4维诊断，识别医院画像，定制VPS策略</p>
                        {employeeSession && (
                            <p className="text-blue-100/90 text-xs mt-2 font-medium">
                                当前身份：{employeeSession.employeeName} / {employeeSession.employeeId}
                            </p>
                        )}
                    </div>
                    <button
                        onClick={handleLogout}
                        className="shrink-0 mt-1 med-btn-sm bg-white/20 hover:bg-white/30 text-white border border-white/25 backdrop-blur-sm"
                    >
                        <LogOut className="w-3.5 h-3.5" />
                        退出
                    </button>
                </div>
            </div>

            <div className="px-5 py-6 -mt-10 relative z-10">
                <div className="rounded-full px-4 h-16 flex items-center space-x-2 transition-shadow duration-300 med-panel">
                    <Search className="w-6 h-6 text-blue-500 ml-2" />
                    <input
                        type="text"
                        placeholder="输入医院名称，快速定位任务"
                        className="flex-1 bg-transparent border-none outline-none text-lg p-1 text-slate-800 placeholder-slate-400 font-medium"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                    />
                </div>
            </div>

            <div className="px-5 flex-1 mt-1">
                <div className="mb-4 px-1 flex items-end justify-between">
                    <h2 className="text-slate-400 med-section-title">选择医院 ({filtered.length})</h2>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">已完成 {completedCount} / {hospitals.length}</span>
                        {isStatusLoading ? <StatusBadge variant="syncing" label="同步中" /> : null}
                    </div>
                </div>
                <div className="mb-3 px-1 flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setFilter('all')}
                        className={`med-btn-sm rounded-full border transition-colors ${filter === 'all'
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
                            }`}
                    >
                        全部 ({hospitals.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setFilter('completed')}
                        className={`med-btn-sm rounded-full border transition-colors ${filter === 'completed'
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
                            }`}
                    >
                        已完成 ({completedCount})
                    </button>
                    <button
                        type="button"
                        onClick={() => setFilter('pending')}
                        className={`med-btn-sm rounded-full border transition-colors ${filter === 'pending'
                            ? 'bg-amber-600 text-white border-amber-600'
                            : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
                            }`}
                    >
                        未填写 ({pendingCount})
                    </button>
                </div>
                <div className="space-y-4">
                    {groupedDisplay.map((group) => (
                        <section key={group.title} className="space-y-3">
                            <div className="px-1 text-slate-400 med-section-title">{group.title}</div>
                            <div className="flex flex-col gap-3">
                                {group.data.map((hospital) => {
                                    const isCompleted = hospital.isCompleted;
                                    const latestSubmittedAt = hospital.latestSubmittedAt;
                                    const isReviewing = reviewingHospitalId === hospital.id;
                                    const statusVariant = hospital.hasSyncError ? 'error' : (isCompleted ? 'completed' : 'pending');
                                    const statusLabel = hospital.hasSyncError
                                        ? '仅本地，待同步'
                                        : (isCompleted ? '已完成，可更新' : '未填写');

                                    return (
                                        <div
                                            key={hospital.id}
                                            className="p-4 rounded-2xl flex flex-col gap-3 text-left transition-all duration-300 group med-panel hover:border-blue-300 hover:-translate-y-0.5 sm:flex-row sm:items-center sm:justify-between"
                                        >
                                            <div className="flex items-start flex-1 min-w-0">
                                                <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 group-hover:bg-blue-100 transition-colors">
                                                    <Building2 className="w-6 h-6" />
                                                </div>
                                                <div className="ml-4 min-w-0">
                                                    <div className="font-semibold text-slate-800 text-base leading-snug break-words">{hospital.name}</div>
                                                    <div className="mt-1">
                                                        <StatusBadge
                                                            variant={statusVariant}
                                                            label={statusLabel}
                                                            className="whitespace-nowrap"
                                                        />
                                                    </div>
                                                    <div className="text-xs font-medium text-slate-400 mt-1">医院编码：{hospital.id}</div>
                                                    {isCompleted && latestSubmittedAt ? (
                                                        <div className="text-[11px] text-slate-400 mt-1">
                                                            最近提交：{formatSubmittedAt(latestSubmittedAt)}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </div>
                                            <div className="w-full sm:w-auto sm:min-w-[212px] sm:ml-3 flex items-center gap-2 sm:justify-end">
                                                {isCompleted ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleReview(hospital.id)}
                                                            disabled={isReviewing}
                                                            className="med-btn-sm flex-1 sm:flex-none transition-colors disabled:opacity-60 disabled:cursor-not-allowed med-button-secondary"
                                                        >
                                                            {isReviewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                                                            回顾
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleUpdate(hospital.id)}
                                                            className="med-btn-sm flex-1 sm:flex-none transition-colors med-button-primary"
                                                        >
                                                            更新
                                                            <ChevronRight className="w-3.5 h-3.5" />
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleUpdate(hospital.id)}
                                                        className="med-btn-sm w-full sm:w-auto transition-colors med-button-primary"
                                                    >
                                                        开始
                                                        <ChevronRight className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                    {hospitals.length === 0 ? (
                        <div className="text-center py-16 text-slate-400 text-sm flex flex-col items-center rounded-2xl med-panel-soft">
                            <div className="bg-slate-200/50 w-16 h-16 rounded-full flex items-center justify-center mb-4">
                                <Building2 className="w-6 h-6 text-slate-400" />
                            </div>
                            当前账号暂无可访问医院，请联系管理员配置权限
                        </div>
                    ) : filtered.length === 0 && (
                        <div className="text-center py-16 text-slate-400 text-sm flex flex-col items-center rounded-2xl med-panel-soft">
                            <div className="bg-slate-200/50 w-16 h-16 rounded-full flex items-center justify-center mb-4">
                                <Search className="w-6 h-6 text-slate-400" />
                            </div>
                            {query ? '未能找到匹配的医院' : '当前筛选下暂无医院'}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
