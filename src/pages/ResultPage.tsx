import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { ChevronLeft, CheckCircle2, Circle, ShieldAlert, Target, Zap, LayoutDashboard, Eye, EyeOff } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { MOCK_HOSPITALS, STRATEGIES, QUESTIONS } from '../lib/constants';
import type { Dimension } from '../lib/constants';
import { normalizeBooleanState, toStateLabel } from '../lib/algorithm';
import { supabase } from '../lib/supabase';
import StatusBadge from '../components/StatusBadge';

export default function ResultPage() {
    const { hospitalId } = useParams();
    const navigate = useNavigate();
    const { results, employeeSession } = useAppStore();
    const [checkedActions, setCheckedActions] = useState<Record<number, boolean>>({});
    const [ruleVersionLabel, setRuleVersionLabel] = useState('未绑定');
    const [isRuleVersionLoading, setIsRuleVersionLoading] = useState(false);
    const [showScoreDetails, setShowScoreDetails] = useState(false);

    const authorizedHospital = employeeSession?.hospitals.find((item) => item.hospitalCode === hospitalId);
    const mockHospital = MOCK_HOSPITALS.find((item) => item.id === hospitalId);
    const hospital = authorizedHospital
        ? { name: authorizedHospital.hospitalName || mockHospital?.name || '未知医院', id: hospitalId }
        : (mockHospital || { name: '未知医院', id: hospitalId });
    const result = results[hospitalId || ''];
    const ruleVersionId = result?.ruleVersionId ?? null;

    useEffect(() => {
        let isMounted = true;

        const loadRuleVersionLabel = async () => {
            if (!ruleVersionId) {
                if (isMounted) {
                    setRuleVersionLabel('未绑定');
                    setIsRuleVersionLoading(false);
                }
                return;
            }

            setIsRuleVersionLoading(true);
            const { data, error } = await supabase
                .from('rule_versions')
                .select('version_code, version_name')
                .eq('id', ruleVersionId)
                .maybeSingle();

            if (!isMounted) return;

            if (error) {
                console.error('加载规则版本信息失败:', error);
                setRuleVersionLabel(`ID: ${ruleVersionId.slice(0, 8)}...`);
                setIsRuleVersionLoading(false);
                return;
            }

            if (!data) {
                setRuleVersionLabel(`ID: ${ruleVersionId.slice(0, 8)}...`);
                setIsRuleVersionLoading(false);
                return;
            }

            const versionName = String(data.version_name ?? '').trim();
            const versionCode = String(data.version_code ?? '').trim();
            if (versionName && versionCode) {
                setRuleVersionLabel(`${versionName} (${versionCode})`);
            } else if (versionCode) {
                setRuleVersionLabel(versionCode);
            } else if (versionName) {
                setRuleVersionLabel(versionName);
            } else {
                setRuleVersionLabel(`ID: ${ruleVersionId.slice(0, 8)}...`);
            }
            setIsRuleVersionLoading(false);
        };

        void loadRuleVersionLabel();
        return () => {
            isMounted = false;
        };
    }, [ruleVersionId]);

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

    const data = [
        { subject: '理念 (P)', current: result.scores.philosophy, avg: totals.philosophy * 0.5, fullMark: totals.philosophy },
        { subject: '机制 (M)', current: result.scores.mechanism, avg: totals.mechanism * 0.6, fullMark: totals.mechanism },
        { subject: '团队 (T)', current: result.scores.team, avg: totals.team * 0.4, fullMark: totals.team },
        { subject: '工具 (To)', current: result.scores.tools, avg: totals.tools * 0.5, fullMark: totals.tools },
    ];

    const fallbackStrategy = STRATEGIES[result.strategyKey] || { type: '未知分型 (解析异常)', strategy: '请检查维度的 H/L 计算逻辑' };
    const strategyData = {
        type: result.strategyType ?? fallbackStrategy.type,
        strategy: result.strategyText ?? fallbackStrategy.strategy,
    };

    const toggleAction = (idx: number) => {
        setCheckedActions(prev => ({ ...prev, [idx]: !prev[idx] }));
    };

    const isAllDone = result.failureActions.length > 0 &&
        Object.values(checkedActions).filter(Boolean).length === result.failureActions.length;
    const submittedAtText = new Date(result.timestamp).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
    const cloudSyncVariant = result.cloudSynced === false ? 'error' : 'completed';
    const cloudSyncLabel = result.cloudSynced === false
        ? '仅本地（未写入云端）'
        : (result.cloudRecordId ? `云端已同步 #${result.cloudRecordId.slice(0, 8)}` : '云端已同步');

    return (
        <div className="min-h-screen pb-20 result-impact-page text-white">
            <div className="px-5 py-4 pt-12 relative z-20">
                <div className="flex items-center">
                    <button onClick={() => navigate('/select')} className="p-2 -ml-2 transition-colors rounded-full result-impact-back">
                        <ChevronLeft className="w-6 h-6" />
                    </button>
                    <div className="flex-1 ml-2 text-center mr-8">
                        <h1 className="med-title-md text-white truncate max-w-[220px] mx-auto result-impact-title">{hospital.name}</h1>
                        <p className="text-blue-100/90 med-eyebrow mt-1">多维分析报告</p>
                        <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
                            <span className="px-2 py-0.5 rounded-full result-impact-chip">
                                提交时间：{submittedAtText}
                            </span>
                            <span className="px-2 py-0.5 rounded-full result-impact-chip">
                                规则版本：{isRuleVersionLoading ? '加载中...' : ruleVersionLabel}
                            </span>
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

                <section className="rounded-[1.5rem] p-6 relative overflow-hidden result-impact-card">
                    <div className="absolute -right-6 -top-6 w-32 h-32 bg-blue-400/15 rounded-full blur-2xl" />
                    <div className="relative z-10">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="bg-blue-400/15 text-blue-200 p-1.5 rounded-lg shrink-0 border border-blue-200/25">
                                <Target className="w-5 h-5" />
                            </span>
                            <h2 className="text-blue-100 med-section-title">宏观评估分型</h2>
                        </div>
                        <div className="font-black text-3xl tracking-tight leading-none mb-3 result-impact-highlight">
                            {strategyData.type}
                        </div>
                        <div className="flex gap-2 mb-5">
                            {(['philosophy', 'mechanism', 'team', 'tools'] as Dimension[]).map((key) => (
                                <span key={key} className={`text-xs font-bold px-2 py-0.5 rounded-sm ${states[key] ? 'bg-emerald-400/16 text-emerald-300 border border-emerald-300/25' : 'bg-rose-400/16 text-rose-200 border border-rose-300/25'}`}>
                                    {key.charAt(0).toUpperCase()}={toStateLabel(states[key])}
                                </span>
                            ))}
                        </div>
                        <div className="text-blue-50/95 p-4 rounded-xl leading-relaxed font-medium result-impact-soft-box">
                            策略方针：{strategyData.strategy}
                        </div>
                    </div>
                </section>

                <section className="rounded-[1.5rem] p-5 result-impact-card">
                    <div className="flex items-center justify-between gap-3 mb-2">
                        <h2 className="text-sm font-bold text-blue-100 uppercase tracking-wider flex items-center gap-2">
                            <Zap className="w-4 h-4 text-blue-300" />
                            <span className="med-section-title text-blue-100">四要素多维水位诊断</span>
                        </h2>
                        <button
                            type="button"
                            onClick={() => setShowScoreDetails((prev) => !prev)}
                            className="med-btn-sm result-impact-sub-btn"
                        >
                            {showScoreDetails ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            {showScoreDetails ? '隐藏数值' : '显示数值'}
                        </button>
                    </div>
                    <div className="h-[280px] w-full mt-4 -ml-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
                                <PolarGrid stroke="rgba(189,216,255,0.25)" />
                                <PolarAngleAxis dataKey="subject" tick={{ fill: '#8db7ff', fontSize: 12, fontWeight: 700 }} />
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
                                <Radar name="全省平均水平" dataKey="avg" stroke="#7e99c5" fill="#7e99c5" fillOpacity={0.23} />
                                <Radar name="目标医院现状" dataKey="current" stroke="#4e93ff" fill="#4e93ff" fillOpacity={0.45} />
                                <Legend wrapperStyle={{ fontSize: 12, color: '#aac6ff', paddingTop: '10px' }} />
                            </RadarChart>
                        </ResponsiveContainer>
                    </div>
                    {showScoreDetails ? (
                        <div className="grid grid-cols-2 gap-2 mt-3">
                            {data.map((item) => (
                                <div key={item.subject} className="rounded-lg px-2.5 py-2 text-[11px] result-impact-soft-box">
                                    <div className="text-blue-100/85">{item.subject}</div>
                                    <div className="font-bold mt-0.5 result-impact-highlight">
                                        {item.current} / {item.fullMark}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </section>

                <section className="rounded-[1.5rem] p-6 relative overflow-hidden result-impact-card">
                    <div className="flex items-center justify-between mb-5">
                        <h2 className="text-sm font-bold text-blue-100 uppercase tracking-wider flex items-center gap-2">
                            <ShieldAlert className="w-4 h-4 text-blue-300" />
                            <span className="med-section-title text-blue-100">改进建议与行动清单</span>
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
                                            : 'bg-white/8 border-white/20 hover:border-blue-200/45'
                                            }`}
                                    >
                                        <div className="mt-0.5 shrink-0">
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
