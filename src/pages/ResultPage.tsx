import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { ChevronLeft, CheckCircle2, Circle, ShieldAlert, Target, Zap, LayoutDashboard } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { MOCK_HOSPITALS, STRATEGIES, QUESTIONS } from '../lib/constants';
import type { Dimension } from '../lib/constants';
import { normalizeBooleanState, normalizeStrategyKey, toDimensionCode } from '../lib/algorithm';
import { supabase } from '../lib/supabase';
import StatusBadge from '../components/StatusBadge';

const DIMENSION_DISPLAY_ORDER: Dimension[] = ['philosophy', 'tools', 'mechanism', 'team'];
const DIMENSION_LABELS: Record<Dimension, string> = {
    philosophy: '科学理念',
    tools: '信息化工具',
    mechanism: '管理机制',
    team: '专业团队',
};

function toScoreMap(value: unknown): Record<Dimension, number> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    const scores: Record<Dimension, number> = {
        philosophy: 0,
        mechanism: 0,
        team: 0,
        tools: 0,
    };

    for (const dimension of (['philosophy', 'mechanism', 'team', 'tools'] as Dimension[])) {
        const parsed = Number(raw[dimension]);
        if (!Number.isFinite(parsed)) return null;
        scores[dimension] = parsed;
    }

    return scores;
}

export default function ResultPage() {
    const { hospitalId } = useParams();
    const navigate = useNavigate();
    const { results, employeeSession } = useAppStore();
    const [checkedActions, setCheckedActions] = useState<Record<number, boolean>>({});
    const [provinceAverageScores, setProvinceAverageScores] = useState<Record<Dimension, number> | null>(null);
    const [provinceAverageLabel, setProvinceAverageLabel] = useState('全省平均水平');

    const authorizedHospital = employeeSession?.hospitals.find((item) => item.hospitalCode === hospitalId);
    const mockHospital = MOCK_HOSPITALS.find((item) => item.id === hospitalId);
    const hospital = authorizedHospital
        ? { name: authorizedHospital.hospitalName || mockHospital?.name || '未知医院', id: hospitalId }
        : (mockHospital || { name: '未知医院', id: hospitalId });
    const result = results[hospitalId || ''];

    useEffect(() => {
        let isMounted = true;

        const loadProvinceAverage = async () => {
            if (!hospitalId || !authorizedHospital || !result) {
                if (isMounted) {
                    setProvinceAverageScores(null);
                    setProvinceAverageLabel('全省平均水平');
                }
                return;
            }

            let province = (authorizedHospital.province ?? '').trim();

            if (!province) {
                const { data: provinceRow } = await supabase
                    .from('employee_permissions')
                    .select('province')
                    .eq('hospital_code', hospitalId)
                    .eq('is_active', true)
                    .limit(1)
                    .maybeSingle();

                province = typeof provinceRow?.province === 'string' ? provinceRow.province.trim() : '';
            }

            if (!province) {
                if (isMounted) {
                    setProvinceAverageScores(null);
                    setProvinceAverageLabel('全省平均水平（未配置省份）');
                }
                return;
            }

            const { data: permissionRows, error: permissionError } = await supabase
                .from('employee_permissions')
                .select('hospital_code')
                .eq('province', province)
                .eq('is_active', true);

            if (permissionError || !permissionRows) {
                if (isMounted) {
                    setProvinceAverageScores(null);
                    setProvinceAverageLabel(`${province}平均（加载失败）`);
                }
                return;
            }

            const hospitalCodes = Array.from(
                new Set(
                    permissionRows
                        .map((row) => (typeof row.hospital_code === 'string' ? row.hospital_code.trim() : ''))
                        .filter((code) => code.length > 0),
                ),
            );

            if (hospitalCodes.length === 0) {
                if (isMounted) {
                    setProvinceAverageScores(null);
                    setProvinceAverageLabel(`${province}平均（暂无样本）`);
                }
                return;
            }

            let surveyRows: Record<string, unknown>[] = [];
            let surveyError: { message?: string } | null = null;

            const queryWithDeleted = await supabase
                .from('survey_results')
                .select('hospital_id, created_at, scores, deleted_at')
                .in('hospital_id', hospitalCodes)
                .is('deleted_at', null)
                .order('created_at', { ascending: false });

            surveyError = queryWithDeleted.error;
            surveyRows = (queryWithDeleted.data ?? []) as Record<string, unknown>[];

            if (surveyError && /column .*deleted_at.* does not exist|schema cache/i.test(surveyError.message ?? '')) {
                const queryFallback = await supabase
                    .from('survey_results')
                    .select('hospital_id, created_at, scores')
                    .in('hospital_id', hospitalCodes)
                    .order('created_at', { ascending: false });
                surveyError = queryFallback.error;
                surveyRows = (queryFallback.data ?? []) as Record<string, unknown>[];
            }

            if (surveyError) {
                if (isMounted) {
                    setProvinceAverageScores(null);
                    setProvinceAverageLabel(`${province}平均（加载失败）`);
                }
                return;
            }

            const latestByHospital = new Map<string, Record<string, unknown>>();
            surveyRows.forEach((row) => {
                const code = typeof row.hospital_id === 'string' ? row.hospital_id.trim() : '';
                if (!code || latestByHospital.has(code)) return;
                latestByHospital.set(code, row);
            });

            const sums: Record<Dimension, number> = { philosophy: 0, mechanism: 0, team: 0, tools: 0 };
            let count = 0;

            latestByHospital.forEach((row) => {
                const scores = toScoreMap(row.scores);
                if (!scores) return;
                sums.philosophy += scores.philosophy;
                sums.mechanism += scores.mechanism;
                sums.team += scores.team;
                sums.tools += scores.tools;
                count += 1;
            });

            if (!isMounted) return;

            if (count === 0) {
                setProvinceAverageScores(null);
                setProvinceAverageLabel(`${province}平均（暂无样本）`);
                return;
            }

            setProvinceAverageScores({
                philosophy: Number((sums.philosophy / count).toFixed(2)),
                mechanism: Number((sums.mechanism / count).toFixed(2)),
                team: Number((sums.team / count).toFixed(2)),
                tools: Number((sums.tools / count).toFixed(2)),
            });
            setProvinceAverageLabel(`${province}平均-${count}家`);
        };

        void loadProvinceAverage();
        return () => {
            isMounted = false;
        };
    }, [authorizedHospital, hospitalId, result]);

    if (!authorizedHospital) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center">
                <LayoutDashboard className="w-16 h-16 text-slate-300 mb-6" />
                <h2 className="text-xl font-bold text-slate-700 mb-2">无权限访问该医院结果</h2>
                <p className="text-slate-500 text-sm mb-8">请返回医院列表，选择当前账号可访问的医院。</p>
                <button
                    onClick={() => navigate('/select')}
                    className="med-btn med-button-primary active:scale-95 transition-transform"
                >
                    返回首页
                </button>
            </div>
        );
    }

    if (!result) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center">
                <LayoutDashboard className="w-16 h-16 text-slate-300 mb-6" />
                <h2 className="text-xl font-bold text-slate-700 mb-2">未找到【{hospital.id}】的评估数据</h2>
                <p className="text-slate-500 text-sm mb-8">请先完成问卷调研后查看结果全景图</p>
                <button
                    onClick={() => navigate('/select')}
                    className="med-btn med-button-primary active:scale-95 transition-transform"
                >
                    返回首页
                </button>
            </div>
        );
    }

    const rawStates = (result.states ?? {}) as Record<string, unknown>;
    const states: Record<Dimension, boolean> = {
        philosophy: normalizeBooleanState(rawStates.philosophy),
        mechanism: normalizeBooleanState(rawStates.mechanism),
        team: normalizeBooleanState(rawStates.team),
        tools: normalizeBooleanState(rawStates.tools),
    };

    const fallbackTotals: Record<Dimension, number> = { philosophy: 0, mechanism: 0, team: 0, tools: 0 };
    QUESTIONS.forEach(q => {
        fallbackTotals[q.dimension] += Number(q.weight ?? 1);
    });
    const totals = result.maxScores ?? fallbackTotals;

    const data = DIMENSION_DISPLAY_ORDER.map((dimension) => ({
        subject: DIMENSION_LABELS[dimension],
        current: result.scores[dimension],
        avg: provinceAverageScores?.[dimension] ?? 0,
        fullMark: totals[dimension],
    }));
    const scoreRows: { key: Dimension; label: string; current: number; avg: number; fullMark: number }[] = DIMENSION_DISPLAY_ORDER.map((dimension) => ({
        key: dimension,
        label: DIMENSION_LABELS[dimension],
        current: result.scores[dimension],
        avg: provinceAverageScores?.[dimension] ?? 0,
        fullMark: totals[dimension],
    }));

    const normalizedStrategyKey = normalizeStrategyKey(result.strategyKey);
    const fallbackStrategy = STRATEGIES[normalizedStrategyKey] || { type: '未知分型 (解析异常)', strategy: '请检查分型字母映射或规则配置。' };
    const strategyData = {
        type: result.strategyType ?? fallbackStrategy.type,
        strategy: result.strategyText ?? fallbackStrategy.strategy,
    };
    const mbtiTypeLabel = normalizedStrategyKey || result.strategyKey || '-';
    const mbtiCodeCompact = mbtiTypeLabel.replace(/[\s,，]/g, '');

    const toggleAction = (idx: number) => {
        setCheckedActions(prev => ({ ...prev, [idx]: !prev[idx] }));
    };

    const isAllDone = result.failureActions.length > 0 &&
        Object.values(checkedActions).filter(Boolean).length === result.failureActions.length;
    const cloudSyncVariant = 'completed';
    const cloudSyncLabel = 'VPSBTI医院分型测试完成';

    return (
        <div className="min-h-screen pb-20 result-impact-page text-white">
            <div className="px-5 py-4 pt-12 relative z-20">
                <div className="flex items-center">
                    <button onClick={() => navigate('/select')} className="p-2 -ml-2 transition-colors rounded-full result-impact-back">
                        <ChevronLeft className="w-6 h-6" />
                    </button>
                    <div className="flex-1 ml-2 text-center mr-8">
                        <h1 className="med-title-md text-white truncate max-w-[220px] mx-auto result-impact-title">{hospital.name}</h1>
                        <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
                            <StatusBadge variant={cloudSyncVariant} label={cloudSyncLabel} />
                        </div>
                    </div>
                </div>
            </div>

            <div className="px-5 py-6 space-y-6 max-w-lg mx-auto -mt-1 relative z-10">
                <button
                    onClick={() => navigate('/select')}
                    className="w-full med-btn result-impact-main-btn"
                >
                    <LayoutDashboard className="w-4 h-4" />
                    返回我的医院列表
                </button>

                <section className="rounded-[1.5rem] p-6 relative overflow-hidden result-impact-card result-impact-card-primary">
                    <div className="absolute -right-6 -top-6 w-32 h-32 bg-blue-400/15 rounded-full blur-2xl" />
                    <div className="relative z-10">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="bg-blue-400/15 text-blue-200 p-1.5 rounded-lg shrink-0 border border-blue-200/25">
                                <Target className="w-5 h-5" />
                            </span>
                            <h2 className="text-blue-100 med-section-title">本次分型结论</h2>
                        </div>
                        <div className="result-impact-mbti-grid mb-4">
                            <div className="result-impact-mbti-panel">
                                <div className="text-xs font-semibold text-blue-200/90 mb-1">VPSBTI 医院人格</div>
                                <div className="font-extrabold text-[2.05rem] tracking-tight leading-none result-impact-highlight">
                                    {strategyData.type}
                                </div>
                            </div>
                            <div className="result-impact-mbti-panel result-impact-mbti-code-panel">
                                <div className="text-xs font-semibold text-blue-200/90 mb-1">VPSBTI 医院分型</div>
                                <div className="result-impact-mbti-code">
                                    {mbtiCodeCompact}
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-2 mb-5">
                            {DIMENSION_DISPLAY_ORDER.map((key) => (
                                <span key={key} className={`text-xs font-bold px-2 py-0.5 rounded-sm ${states[key] ? 'bg-emerald-400/16 text-emerald-300 border border-emerald-300/25' : 'bg-rose-400/16 text-rose-200 border border-rose-300/25'}`}>
                                    {DIMENSION_LABELS[key]}={toDimensionCode(key, states[key])}
                                </span>
                            ))}
                        </div>
                        <div className="result-impact-guidance">
                            <div className="result-impact-guidance-label">需重点完善的AMS-VPS 4要素</div>
                            <div className="result-impact-guidance-text">{strategyData.strategy}</div>
                        </div>
                    </div>
                </section>

                <section className="rounded-[1.5rem] p-5 result-impact-card result-impact-card-secondary">
                    <div className="flex items-center justify-between gap-3 mb-2">
                        <h2 className="text-sm font-bold text-blue-100 uppercase tracking-wider flex items-center gap-2">
                            <Zap className="w-4 h-4 text-blue-300" />
                            <span className="med-section-title text-blue-100">AMS-VPS 4要素水平对比</span>
                        </h2>
                    </div>
                    <div className="h-[268px] w-full -mt-1 -ml-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <RadarChart cx="50%" cy="47%" outerRadius="70%" data={data}>
                                <PolarGrid stroke="rgba(189,216,255,0.25)" />
                                <PolarAngleAxis dataKey="subject" tick={{ fill: '#9ec4ff', fontSize: 13, fontWeight: 700 }} />
                                <PolarRadiusAxis angle={30} domain={[0, Math.max(...Object.values(totals))]} tick={false} axisLine={false} />
                                <Tooltip
                                    contentStyle={{
                                        background: 'rgba(15, 38, 88, 0.94)',
                                        border: '1px solid rgba(148, 189, 255, 0.45)',
                                        borderRadius: '10px',
                                        color: '#eaf4ff',
                                        fontSize: 12,
                                    }}
                                />
                                {provinceAverageScores ? (
                                    <Radar name={`（${provinceAverageLabel}）`} dataKey="avg" stroke="#9eb4d8" fill="#9eb4d8" fillOpacity={0.23} />
                                ) : null}
                                <Radar name="目标医院" dataKey="current" stroke="#4e93ff" fill="#4e93ff" fillOpacity={0.45} />
                                <Legend wrapperStyle={{ fontSize: 12, color: '#aac6ff', paddingTop: '10px' }} />
                            </RadarChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-3">
                        {scoreRows.map((item) => (
                            <div key={item.key} className="rounded-lg px-2.5 py-2 text-[11px] result-impact-soft-box">
                                <div className="text-blue-100/85">{item.label}</div>
                                <div className="font-bold mt-0.5 result-impact-highlight">
                                    目标 {item.current} / {item.fullMark}
                                </div>
                                {provinceAverageScores ? (
                                    <div className="text-[10px] text-blue-200/85 mt-0.5">省均 {item.avg}</div>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </section>

                <section className="rounded-[1.5rem] p-6 relative overflow-hidden result-impact-card result-impact-card-tertiary">
                    <div className="flex items-center justify-between mb-5">
                        <h2 className="text-sm font-bold text-blue-100 uppercase tracking-wider flex items-center gap-2">
                            <ShieldAlert className="w-4 h-4 text-blue-300" />
                            <span className="med-section-title text-blue-100 leading-snug">打造AMS-VPS标杆医院行动建议</span>
                        </h2>
                        <div className="text-xs bg-white/15 text-blue-100 px-2 py-1 rounded-full font-bold">
                            {Object.values(checkedActions).filter(Boolean).length} / {result.failureActions.length}
                        </div>
                    </div>

                    {result.failureActions.length === 0 ? (
                        <div className="bg-emerald-500/14 text-emerald-200 p-4 rounded-xl font-medium border border-emerald-200/30 flex items-center gap-3">
                            <div className="bg-emerald-400/20 rounded-full w-8 h-8 flex items-center justify-center shrink-0">
                                <CheckCircle2 className="w-5 h-5 text-emerald-200" />
                            </div>
                            <p>恭喜！当前四要素暂无明显短板，全维度高分运转中。</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {result.failureActions.map((action, idx) => {
                                const isChecked = checkedActions[idx];
                                return (
                                    <button
                                        key={idx}
                                        onClick={() => toggleAction(idx)}
                                        className={`w-full text-left p-4 rounded-xl border transition-all duration-300 flex items-start gap-4 ${isChecked
                                            ? 'bg-white/12 border-white/16 opacity-65'
                                            : 'bg-white/8 border-white/24 hover:border-blue-200/45'
                                            }`}
                                    >
                                        <div className="mt-0.5 shrink-0 flex items-center gap-2">
                                            <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${isChecked ? 'bg-emerald-300/25 text-emerald-100' : 'bg-blue-300/20 text-blue-100'}`}>
                                                {idx + 1}
                                            </span>
                                            {isChecked
                                                ? <CheckCircle2 className="w-6 h-6 text-emerald-300 transition-all duration-300 scale-110" />
                                                : <Circle className="w-6 h-6 text-blue-100/65 transition-colors" />
                                            }
                                        </div>
                                        <span className={`text-sm leading-relaxed transition-all duration-300 ${isChecked ? 'text-blue-100/60 line-through' : 'text-blue-50 font-medium'}`}>
                                            {action}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {isAllDone && (
                        <div className="mt-6 p-4 rounded-xl font-bold flex items-center justify-center gap-2 result-impact-main-btn">
                            <CheckCircle2 className="w-5 h-5" />
                            已闭环所有待改进项计划！
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
