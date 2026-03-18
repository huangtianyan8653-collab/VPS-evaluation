import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Settings2, Target } from 'lucide-react';
import { DIMENSIONS } from '../lib/constants';
import type { Dimension } from '../lib/constants';
import type { RuleQuestion } from '../lib/rules';
import { fetchActiveRule, publishRuleVersion } from '../lib/rules';

interface StrategyItem {
    key: string;
    type: string;
    strategy: string;
}

const DIMENSION_LABELS: Record<Dimension, string> = {
    philosophy: '理念',
    mechanism: '机制',
    team: '团队',
    tools: '工具',
};

function parseThreshold(value: string | number, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, parsed);
}

export default function StrategyConfigPage() {
    const [thresholds, setThresholds] = useState<Record<Dimension, number> | null>(null);
    const [strategyList, setStrategyList] = useState<StrategyItem[]>([]);
    const [questions, setQuestions] = useState<RuleQuestion[]>([]);
    const [activeVersionLabel, setActiveVersionLabel] = useState('未加载');

    const [isLoading, setIsLoading] = useState(true);
    const [isPublishing, setIsPublishing] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadActiveRule = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const rule = await fetchActiveRule();
            setThresholds(rule.thresholds);
            setQuestions(rule.questions);
            setStrategyList(
                Object.entries(rule.strategies)
                    .map(([key, value]) => ({ key, type: value.type, strategy: value.strategy }))
                    .sort((a, b) => a.key.localeCompare(b.key)),
            );

            if (rule.version) {
                setActiveVersionLabel(`${rule.version.name} (${rule.version.code})`);
            } else {
                setActiveVersionLabel('默认内置规则（未检测到云端激活版本）');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : '加载规则失败');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadActiveRule();
    }, [loadActiveRule]);

    useEffect(() => {
        if (!toast) return;
        const timer = window.setTimeout(() => setToast(null), 2500);
        return () => window.clearTimeout(timer);
    }, [toast]);

    const dimensionMaxScores = useMemo(() => {
        const totals: Record<Dimension, number> = {
            philosophy: 0,
            mechanism: 0,
            team: 0,
            tools: 0,
        };

        questions.forEach((question) => {
            totals[question.dimension] += Number(question.weight ?? 1);
        });

        return totals;
    }, [questions]);

    const handleStrategyChange = (index: number, field: 'type' | 'strategy', value: string) => {
        setStrategyList((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: value };
            return next;
        });
    };

    const updateThreshold = (dimension: Dimension, nextValue: number) => {
        setThresholds((prev) => {
            if (!prev) return prev;
            return { ...prev, [dimension]: Math.max(0, Number(nextValue.toFixed(2))) };
        });
    };

    const handleSave = async () => {
        if (!thresholds) return;
        if (questions.length === 0) {
            setError('题库为空，无法发布策略版本。请先在题库管理中至少保留一个题目。');
            return;
        }

        setIsPublishing(true);
        setError(null);

        try {
            const strategies = strategyList.reduce<Record<string, { type: string; strategy: string }>>((acc, item) => {
                acc[item.key] = {
                    type: item.type.trim() || '未命名分型',
                    strategy: item.strategy.trim(),
                };
                return acc;
            }, {});

            const result = await publishRuleVersion({
                versionName: `策略发布 ${new Date().toLocaleString()}`,
                questions,
                thresholds,
                strategies,
            });

            setToast(`发布成功：${result.versionCode}`);
            await loadActiveRule();
        } catch (err) {
            setError(err instanceof Error ? err.message : '发布失败，请稍后重试。');
        } finally {
            setIsPublishing(false);
        }
    };

    if (isLoading || !thresholds) {
        return (
            <div className="rounded-2xl p-12 text-center text-slate-500 med-panel">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500 mx-auto mb-3" />
                正在加载云端策略规则...
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-10">
            <div className="p-6 rounded-2xl flex justify-between items-end med-panel">
                <div>
                    <h1 className="med-title-xl text-slate-800 mb-2">分型与策略矩阵参数</h1>
                    <p className="med-subtitle text-slate-600">编辑阈值和 16 种分型策略，发布后全员按新版本执行。</p>
                    <p className="text-xs text-slate-400 mt-2">当前激活版本：{activeVersionLabel}</p>
                </div>
                <div className="flex items-center gap-3">
                    {toast && <span className="text-emerald-600 font-bold text-sm">{toast}</span>}
                    <button
                        onClick={handleSave}
                        disabled={isPublishing}
                        className="med-btn-sm med-button-primary disabled:opacity-60"
                    >
                        {isPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        发布策略版本
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-sm">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="xl:col-span-1 space-y-6">
                    <div className="rounded-2xl p-6 med-panel">
                        <h2 className="med-title-md text-slate-800 flex items-center gap-2 mb-6">
                            <Settings2 className="w-5 h-5 text-primary-500" />
                            维度阈值设置
                        </h2>
                        <div className="space-y-4">
                            {DIMENSIONS.map((dimension) => (
                                <div key={dimension} className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="font-bold text-slate-700">{DIMENSION_LABELS[dimension]}</div>
                                        <div className="text-xs text-slate-400">当前满分权重: {dimensionMaxScores[dimension].toFixed(2)}</div>
                                    </div>

                                    <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden">
                                        <button
                                            onClick={() => updateThreshold(dimension, thresholds[dimension] - 0.5)}
                                            className="px-3 py-2 font-bold text-slate-500 hover:bg-slate-100 transition-colors"
                                        >
                                            -
                                        </button>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.1"
                                            value={thresholds[dimension]}
                                            onChange={(event) => updateThreshold(dimension, parseThreshold(event.target.value, thresholds[dimension]))}
                                            className="w-full text-center font-bold text-primary-600 border-x border-slate-200 py-2 focus:outline-none bg-white"
                                        />
                                        <button
                                            onClick={() => updateThreshold(dimension, thresholds[dimension] + 0.5)}
                                            className="px-3 py-2 font-bold text-slate-500 hover:bg-slate-100 transition-colors"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>
                            ))}

                            <div className="mt-4 text-xs leading-relaxed bg-blue-50/60 p-3 rounded-lg text-blue-800 border border-blue-100">
                                判定规则：当维度得分 <code>score &gt;= threshold</code> 时，该维度状态为 <strong>true</strong>，否则为 <strong>false</strong>。
                            </div>
                        </div>
                    </div>
                </div>

                <div className="xl:col-span-2">
                    <div className="rounded-2xl p-6 med-panel">
                        <h2 className="med-title-md text-slate-800 flex items-center gap-2 mb-6">
                            <Target className="w-5 h-5 text-amber-500" />
                            16项组合策略池 (P, M, T, To)
                        </h2>

                        <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
                            {strategyList.map((item, index) => (
                                <div key={item.key} className="flex gap-4 p-4 rounded-xl border border-slate-200 bg-slate-50 hover:border-primary-300 transition-colors">
                                    <div className="w-24 shrink-0 flex flex-col justify-center items-center bg-white rounded-lg border border-slate-200">
                                        <span className="text-[10px] uppercase font-bold text-slate-400 mb-1">标识位</span>
                                        <span className="font-mono font-bold tracking-widest text-primary-700">{item.key}</span>
                                    </div>
                                    <div className="flex-1 space-y-3">
                                        <div className="flex gap-2">
                                            <span className="bg-slate-200 text-slate-600 text-xs px-2 py-1 rounded-md font-bold whitespace-nowrap">
                                                分型名称
                                            </span>
                                            <input
                                                type="text"
                                                value={item.type}
                                                onChange={(event) => handleStrategyChange(index, 'type', event.target.value)}
                                                className="flex-1 bg-white border border-slate-200 rounded-md px-3 text-sm font-bold text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <span className="bg-amber-100 text-amber-700 text-xs px-2 py-1 rounded-md font-bold whitespace-nowrap self-start">
                                                宏观策略
                                            </span>
                                            <textarea
                                                value={item.strategy}
                                                onChange={(event) => handleStrategyChange(index, 'strategy', event.target.value)}
                                                className="flex-1 bg-white border border-slate-200 rounded-md p-2 text-sm text-slate-600 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 resize-none h-16 leading-relaxed"
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
