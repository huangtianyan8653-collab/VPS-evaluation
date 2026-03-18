import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Info, HelpCircle, Check, X, Loader2 } from 'lucide-react';
import { MOCK_HOSPITALS } from '../lib/constants';
import type { Dimension } from '../lib/constants';
import { isHigh, getStrategyKey } from '../lib/algorithm';
import { useAppStore } from '../lib/store';
import type { ResultData } from '../lib/store';
import { supabase } from '../lib/supabase';
import { fetchActiveRule, getFallbackRule } from '../lib/rules';
import type { ActiveRule } from '../lib/rules';

const DIMENSIONS: { id: Dimension; label: string }[] = [
    { id: 'philosophy', label: '理念' },
    { id: 'mechanism', label: '机制' },
    { id: 'team', label: '团队' },
    { id: 'tools', label: '工具' },
];

export default function SurveyPage() {
    const { hospitalId } = useParams();
    const navigate = useNavigate();
    const { drafts, saveDraft, saveResult, clearDraft, employeeSession } = useAppStore();

    const [activeTab, setActiveTab] = useState<number>(0);
    const [showInfo, setShowInfo] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isRuleLoading, setIsRuleLoading] = useState(true);
    const [activeRule, setActiveRule] = useState<ActiveRule>(getFallbackRule());
    const answers = useMemo<Record<string, boolean>>(
        () => (hospitalId ? (drafts[hospitalId]?.answers ?? {}) : {}),
        [hospitalId, drafts]
    );

    const authorizedHospital = employeeSession?.hospitals.find((item) => item.hospitalCode === hospitalId);
    const mockHospital = MOCK_HOSPITALS.find(h => h.id === hospitalId);
    const hospital = authorizedHospital
        ? { name: authorizedHospital.hospitalName || mockHospital?.name || '未知医院', id: hospitalId }
        : (mockHospital || { name: '未知医院', id: hospitalId });
    const hasHospitalAccess = Boolean(authorizedHospital);
    const questions = activeRule.questions;

    useEffect(() => {
        let isMounted = true;

        const loadActiveRule = async () => {
            const rule = await fetchActiveRule();
            if (isMounted) {
                setActiveRule(rule);
                setIsRuleLoading(false);
            }
        };

        loadActiveRule();
        return () => {
            isMounted = false;
        };
    }, []);

    const handleAnswer = (questionId: string, value: boolean) => {
        if (!hospitalId) return;
        saveDraft(hospitalId, { ...answers, [questionId]: value });
    };

    const currentDimLength = questions.filter(q => q.dimension === DIMENSIONS[activeTab].id).length;
    const currentDimAnswered = questions.filter(q => q.dimension === DIMENSIONS[activeTab].id).filter(q => answers[q.id] !== undefined).length;

    const isLastTab = activeTab === DIMENSIONS.length - 1;
    const calculatedAll = questions.length > 0 && questions.every(q => answers[q.id] !== undefined);

    const handleSubmit = async () => {
        if (!hospitalId || !calculatedAll || isSubmitting || !employeeSession || !hasHospitalAccess) return;

        setIsSubmitting(true);

        const scores: Record<Dimension, number> = { philosophy: 0, mechanism: 0, team: 0, tools: 0 };
        const maxScores: Record<Dimension, number> = { philosophy: 0, mechanism: 0, team: 0, tools: 0 };
        const failureActions: string[] = [];

        questions.forEach(q => {
            const weight = Number.isFinite(Number(q.weight)) ? Number(q.weight) : 1;
            maxScores[q.dimension] += weight;

            if (answers[q.id]) {
                scores[q.dimension] += weight;
            } else {
                const action = q.failureAction.trim();
                if (action.length > 0) {
                    failureActions.push(action);
                }
            }
        });

        const states = {
            philosophy: isHigh(scores.philosophy, activeRule.thresholds.philosophy),
            mechanism: isHigh(scores.mechanism, activeRule.thresholds.mechanism),
            team: isHigh(scores.team, activeRule.thresholds.team),
            tools: isHigh(scores.tools, activeRule.thresholds.tools),
        };

        const strategyKey = getStrategyKey(states.philosophy, states.mechanism, states.team, states.tools);
        const strategy = activeRule.strategies[strategyKey] || { type: '未知分型 (解析异常)', strategy: '请检查维度计算逻辑或规则配置。' };

        const result: ResultData = {
            scores,
            maxScores,
            states,
            strategyKey,
            strategyType: strategy.type,
            strategyText: strategy.strategy,
            ruleVersionId: activeRule.version?.id ?? null,
            failureActions,
            timestamp: Date.now()
        };

        let cloudSaved = false;
        let cloudRecordId: string | null = null;
        let cloudCreatedAt: string | null = null;

        try {
            const payload = {
                hospital_id: hospitalId,
                submitter_name: employeeSession.employeeName,
                submitter_code: employeeSession.employeeId,
                rule_version_id: result.ruleVersionId,
                scores: result.scores,
                max_scores: result.maxScores,
                states: result.states,
                strategy_key: result.strategyKey,
                strategy_type: result.strategyType,
                strategy_text: result.strategyText,
                failure_actions: result.failureActions,
                raw_answers: answers
            };

            const firstInsert = await supabase
                .from('survey_results')
                .insert(payload)
                .select('id, created_at')
                .single();
            let { error } = firstInsert;
            if (!error && firstInsert.data) {
                cloudRecordId = String(firstInsert.data.id ?? '');
                cloudCreatedAt = String(firstInsert.data.created_at ?? '');
            }

            if (error && /column .*submitter_name.* does not exist|column .*submitter_code.* does not exist|schema cache/i.test(error.message)) {
                const payloadWithoutSubmitter = {
                    hospital_id: hospitalId,
                    rule_version_id: result.ruleVersionId,
                    scores: result.scores,
                    max_scores: result.maxScores,
                    states: result.states,
                    strategy_key: result.strategyKey,
                    strategy_type: result.strategyType,
                    strategy_text: result.strategyText,
                    failure_actions: result.failureActions,
                    raw_answers: answers
                };
                const noSubmitterInsert = await supabase
                    .from('survey_results')
                    .insert(payloadWithoutSubmitter)
                    .select('id, created_at')
                    .single();
                error = noSubmitterInsert.error;
                if (!error && noSubmitterInsert.data) {
                    cloudRecordId = String(noSubmitterInsert.data.id ?? '');
                    cloudCreatedAt = String(noSubmitterInsert.data.created_at ?? '');
                }
            }

            if (error && /column .* does not exist|schema cache/i.test(error.message)) {
                const legacyPayload = {
                    hospital_id: hospitalId,
                    scores: result.scores,
                    states: result.states,
                    strategy_key: result.strategyKey,
                    failure_actions: result.failureActions,
                    raw_answers: answers
                };
                const legacyInsert = await supabase
                    .from('survey_results')
                    .insert(legacyPayload)
                    .select('id, created_at')
                    .single();
                error = legacyInsert.error;
                if (!error && legacyInsert.data) {
                    cloudRecordId = String(legacyInsert.data.id ?? '');
                    cloudCreatedAt = String(legacyInsert.data.created_at ?? '');
                }
            }

            if (error) {
                console.error('Supabase 写入失败:', error);
                const continueLocal = confirm(
                    `云端保存失败，后台不会出现这条记录。\n\n错误信息：${error.message}\n\n点击“确定”继续查看本地报告，点击“取消”留在当前页后重试提交。`
                );
                if (!continueLocal) {
                    setIsSubmitting(false);
                    return;
                }
            } else {
                cloudSaved = true;
            }
        } catch (err) {
            console.error('Network Error:', err);
            const continueLocal = confirm(
                '网络异常导致报告未能上传云端，后台不会出现这条记录。\n\n点击“确定”继续查看本地报告，点击“取消”留在当前页后重试提交。'
            );
            if (!continueLocal) {
                setIsSubmitting(false);
                return;
            }
        }

        const cloudTimestamp = cloudCreatedAt ? new Date(cloudCreatedAt).getTime() : Number.NaN;
        const finalResult: ResultData = {
            ...result,
            cloudRecordId: cloudSaved ? cloudRecordId : null,
            cloudCreatedAt: cloudSaved ? cloudCreatedAt : null,
            cloudSynced: cloudSaved,
            timestamp: cloudSaved && Number.isFinite(cloudTimestamp) ? cloudTimestamp : result.timestamp,
        };
        saveResult(hospitalId, finalResult);

        setIsSubmitting(false);
        clearDraft(hospitalId);
        navigate(`/result/${hospitalId}`);
    };

    const currentQuestions = questions.filter(q => q.dimension === DIMENSIONS[activeTab].id);

    if (!hasHospitalAccess) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
                <div className="max-w-md rounded-2xl p-6 med-panel">
                    <h2 className="text-lg font-bold text-slate-800">无访问权限</h2>
                    <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                        当前账号未分配该医院的调研权限，请返回列表选择可访问医院，或联系管理员配置权限。
                    </p>
                    <button
                        onClick={() => navigate('/select')}
                        className="mt-5 med-btn med-button-primary"
                    >
                        返回医院列表
                    </button>
                </div>
            </div>
        );
    }

    if (isRuleLoading) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-slate-500">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
                <p className="text-sm font-medium">正在加载云端规则版本...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col min-h-screen pb-safe flow-page text-white">
            <div className="px-5 py-4 pt-12 flex items-center sticky top-0 z-20 border-b border-white/20 bg-white/10 backdrop-blur-md">
                <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-white/90 active:bg-white/15 rounded-full transition-colors">
                    <ChevronLeft className="w-6 h-6" />
                </button>
                <div className="flex-1 ml-2">
                    <h1 className="med-title-md text-white">{hospital.name}</h1>
                    <p className="text-blue-100/90 med-eyebrow">VPS 评估调研</p>
                </div>
            </div>

            <div className="border-b border-white/20 px-2 flex justify-between sticky top-[88px] z-10 bg-white/10 backdrop-blur-md">
                {DIMENSIONS.map((dim, idx) => {
                    const isActive = activeTab === idx;
                    const totalQ = questions.filter(q => q.dimension === dim.id).length;
                    const ansQ = questions.filter(q => q.dimension === dim.id && answers[q.id] !== undefined).length;
                    const isDone = ansQ === totalQ;

                    return (
                        <button
                            key={dim.id}
                            onClick={() => setActiveTab(idx)}
                            className={`flex-1 py-3 text-sm font-semibold relative transition-colors ${isActive ? 'text-white' : 'text-blue-100/70'}`}
                        >
                            <div className="flex items-center justify-center gap-1">
                                {dim.label}
                                {isDone && <Check className="w-3.5 h-3.5 text-emerald-300" />}
                            </div>
                            {isActive && (
                                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-1 bg-white rounded-t-full shadow-[0_-2px_6px_rgba(255,255,255,0.45)]" />
                            )}
                        </button>
                    );
                })}
            </div>

            <div className="flex-1 px-5 py-6 overflow-y-auto relative z-10">
                <div className="mb-7 flex justify-between items-end">
                    <div>
                        <h2 className="med-title-lg text-white">{DIMENSIONS[activeTab].label} 维度评估</h2>
                        <p className="med-subtitle-light mt-1.5">请根据医院实际情况如实填写</p>
                    </div>
                    <div className="text-sm font-semibold text-white bg-white/18 px-3 py-1 rounded-full border border-white/30">
                        {currentDimAnswered} / {currentDimLength}
                    </div>
                </div>

                <div className="space-y-6">
                    {currentQuestions.length === 0 && (
                        <div className="rounded-2xl p-8 text-center text-blue-100 text-sm border border-white/25 bg-white/10 backdrop-blur-sm">
                            当前维度暂无可用题目，请联系管理员检查规则版本配置。
                        </div>
                    )}
                    {currentQuestions.map(q => {
                        const isYes = answers[q.id] === true;
                        const isNo = answers[q.id] === false;

                        return (
                            <div key={q.id} className="rounded-[1.7rem] p-6 relative overflow-hidden border border-white/24 bg-white/[0.14] backdrop-blur-sm">
                                <div className="absolute -right-10 -top-10 w-28 h-28 rounded-full bg-white/14 blur-2xl" />
                                <div className="flex items-start gap-3">
                                    <div className="flex-1 text-white font-semibold leading-relaxed text-[1.03rem] tracking-[0.01em]">
                                        {q.text}
                                    </div>
                                    <button onClick={() => setShowInfo(showInfo === q.id ? null : q.id)} className="text-blue-100 hover:text-white p-1 shrink-0">
                                        <HelpCircle className="w-5 h-5" />
                                    </button>
                                </div>

                                {showInfo === q.id && (
                                    <div className="mt-3 bg-white/90 border border-blue-100 rounded-xl p-3 text-sm text-blue-800 flex items-start gap-2">
                                        <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                                        <span className="leading-relaxed">{q.description}</span>
                                    </div>
                                )}

                                <div className="mt-6 grid grid-cols-2 gap-3">
                                    <button
                                        onClick={() => handleAnswer(q.id, true)}
                                        className={`flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-all ${isYes
                                            ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/30 border border-emerald-200'
                                            : 'bg-white/14 text-white hover:bg-white/22 border border-white/30'
                                            }`}
                                    >
                                        <Check className={`w-5 h-5 ${isYes ? 'text-white' : 'text-blue-100'}`} />
                                        是 (Yes)
                                    </button>
                                    <button
                                        onClick={() => handleAnswer(q.id, false)}
                                        className={`flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-all ${isNo
                                            ? 'bg-rose-600 text-white shadow-md shadow-rose-950/30 border border-rose-200'
                                            : 'bg-white/14 text-white hover:bg-white/22 border border-white/30'
                                            }`}
                                    >
                                        <X className={`w-5 h-5 ${isNo ? 'text-white' : 'text-blue-100'}`} />
                                        否 (No)
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="p-4 pb-8 border-t border-white/25 fixed bottom-0 left-0 right-0 z-20 bg-white/96 backdrop-blur-md">
                <div className="flex gap-3 max-w-md mx-auto">
                    {!isLastTab ? (
                        <button
                            onClick={() => setActiveTab(prev => prev + 1)}
                            className="w-full med-btn-lg text-white active:scale-95 transition-transform med-button-primary"
                        >
                            继续下一项
                        </button>
                    ) : (
                        <button
                            onClick={handleSubmit}
                            disabled={!calculatedAll || isSubmitting}
                            className={`w-full med-btn-lg shadow-lg active:scale-95 transition-all ${calculatedAll && !isSubmitting
                                ? 'med-button-primary'
                                : 'med-btn-disabled'
                                }`}
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="w-6 h-6 animate-spin" />
                                    云端写入中...
                                </>
                            ) : (
                                calculatedAll ? '提交评估并生成报告' : '请完成所有题目'
                            )}
                        </button>
                    )}
                </div>
            </div>

            <div className="h-[100px]" />
        </div>
    );
}
