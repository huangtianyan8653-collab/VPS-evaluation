import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Check, X, Loader2 } from 'lucide-react';
import { MOCK_HOSPITALS } from '../lib/constants';
import type { Dimension } from '../lib/constants';
import { isHigh, getStrategyKey } from '../lib/algorithm';
import { useAppStore } from '../lib/store';
import type { ResultData } from '../lib/store';
import { supabase } from '../lib/supabase';
import { fetchActiveRule, getFallbackRule } from '../lib/rules';
import type { ActiveRule } from '../lib/rules';
import { collectFailureActionsByDisplayOrder, evaluateDimensionQuestions } from '../lib/surveyEvaluation';
import type { DimensionEvaluation } from '../lib/surveyEvaluation';

const DIMENSIONS: { id: Dimension; label: string }[] = [
    { id: 'philosophy', label: '科学理念' },
    { id: 'tools', label: '信息化工具' },
    { id: 'mechanism', label: '管理机制' },
    { id: 'team', label: '专业团队' },
];

export default function SurveyPage() {
    const { hospitalId } = useParams();
    const navigate = useNavigate();
    const { drafts, saveDraft, saveResult, clearDraft, employeeSession } = useAppStore();

    const [activeTab, setActiveTab] = useState<number>(0);
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
        const nextAnswers = { ...answers, [questionId]: value };
        const currentQuestion = questions.find((item) => item.id === questionId);

        // 决定性题目选“否”后，清理该维度后续答案，防止脏数据残留
        if (currentQuestion?.isDecisive && value === false) {
            const dimensionQuestions = questions.filter((item) => item.dimension === currentQuestion.dimension);
            const currentIndex = dimensionQuestions.findIndex((item) => item.id === questionId);
            dimensionQuestions.slice(currentIndex + 1).forEach((item) => {
                if (Object.prototype.hasOwnProperty.call(nextAnswers, item.id)) {
                    delete nextAnswers[item.id];
                }
            });
        }

        saveDraft(hospitalId, nextAnswers);
    };

    const dimensionEvaluations = useMemo<Record<Dimension, DimensionEvaluation>>(() => {
        return {
            philosophy: evaluateDimensionQuestions(
                questions.filter((question) => question.dimension === 'philosophy'),
                answers
            ),
            mechanism: evaluateDimensionQuestions(
                questions.filter((question) => question.dimension === 'mechanism'),
                answers
            ),
            team: evaluateDimensionQuestions(
                questions.filter((question) => question.dimension === 'team'),
                answers
            ),
            tools: evaluateDimensionQuestions(
                questions.filter((question) => question.dimension === 'tools'),
                answers
            ),
        };
    }, [questions, answers]);

    const currentDimensionId = DIMENSIONS[activeTab].id;
    const currentEvaluation = dimensionEvaluations[currentDimensionId];
    const currentDimLength = currentEvaluation.requiredCount;
    const currentDimAnswered = currentEvaluation.answeredCount;

    const isLastTab = activeTab === DIMENSIONS.length - 1;
    const calculatedAll = questions.length > 0 && DIMENSIONS.every((dimension) => dimensionEvaluations[dimension.id].isComplete);

    const handleSubmit = async () => {
        if (!hospitalId || !calculatedAll || isSubmitting || !employeeSession || !hasHospitalAccess) return;

        setIsSubmitting(true);

        const scores: Record<Dimension, number> = { philosophy: 0, mechanism: 0, team: 0, tools: 0 };
        const maxScores: Record<Dimension, number> = { philosophy: 0, mechanism: 0, team: 0, tools: 0 };
        const states: Record<Dimension, boolean> = { philosophy: false, mechanism: false, team: false, tools: false };
        (Object.keys(dimensionEvaluations) as Dimension[]).forEach((dimension) => {
            const evaluation = dimensionEvaluations[dimension];
            scores[dimension] = evaluation.score;
            maxScores[dimension] = evaluation.maxScore;
            states[dimension] = evaluation.forcedFalse
                ? false
                : isHigh(evaluation.score, activeRule.thresholds[dimension]);
        });
        const failureActions = collectFailureActionsByDisplayOrder(dimensionEvaluations);

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
            const hospitalSnapshot = {
                hospital_name: authorizedHospital?.hospitalName || mockHospital?.name || '',
                province: authorizedHospital?.province ?? '',
                sg: authorizedHospital?.sg ?? '',
                rm: authorizedHospital?.rm ?? '',
                dm: authorizedHospital?.dm ?? '',
                mics: authorizedHospital?.mics ?? '',
            };
            const payload = {
                hospital_id: hospitalId,
                ...hospitalSnapshot,
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

            if (error && /column .*hospital_name|column .*province|column .*sg|column .*rm|column .*dm|column .*mics|schema cache/i.test(error.message)) {
                const payloadWithoutHospitalSnapshot = {
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
                const noHospitalSnapshotInsert = await supabase
                    .from('survey_results')
                    .insert(payloadWithoutHospitalSnapshot)
                    .select('id, created_at')
                    .single();
                error = noHospitalSnapshotInsert.error;
                if (!error && noHospitalSnapshotInsert.data) {
                    cloudRecordId = String(noHospitalSnapshotInsert.data.id ?? '');
                    cloudCreatedAt = String(noHospitalSnapshotInsert.data.created_at ?? '');
                }
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

    const currentQuestions = currentEvaluation.visibleQuestions;

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
        <div className="flex flex-col min-h-screen pb-safe flow-page flow-page-survey-unified text-white">
            <div className="px-5 py-4 pt-12 flex items-center sticky top-0 z-20 border-b border-white/20 bg-white/10 backdrop-blur-md">
                <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-white/90 active:bg-white/15 rounded-full transition-colors">
                    <ChevronLeft className="w-6 h-6" />
                </button>
                <div className="flex-1 ml-2">
                    <h1 className="med-title-md text-white">{hospital.name}</h1>
                    <p className="text-blue-100/90 med-eyebrow">VPSBTI医院分型测试</p>
                </div>
            </div>

            <div className="border-b border-white/20 px-2 flex justify-between sticky top-[88px] z-10 bg-white/10 backdrop-blur-md">
                {DIMENSIONS.map((dim, idx) => {
                    const isActive = activeTab === idx;
                    const summary = dimensionEvaluations[dim.id];
                    const totalQ = summary.requiredCount;
                    const isDone = summary.isComplete && totalQ > 0;

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
                        <h2 className="med-title-lg med-title-survey text-white">{DIMENSIONS[activeTab].label} 要素诊断</h2>
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
                                    <div className="flex-1 text-white font-medium leading-relaxed text-[0.94rem] tracking-[0.005em]">
                                        {q.text}
                                    </div>
                                </div>

                                <div className="mt-6 grid grid-cols-2 gap-3">
                                    <button
                                        onClick={() => handleAnswer(q.id, true)}
                                        className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all ${isYes
                                            ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/30 border border-emerald-200'
                                            : 'bg-white/14 text-white hover:bg-white/22 border border-white/30'
                                            }`}
                                    >
                                        <Check className={`w-4 h-4 ${isYes ? 'text-white' : 'text-blue-100'}`} />
                                        是 (Yes)
                                    </button>
                                    <button
                                        onClick={() => handleAnswer(q.id, false)}
                                        className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all ${isNo
                                            ? 'bg-rose-600 text-white shadow-md shadow-rose-950/30 border border-rose-200'
                                            : 'bg-white/14 text-white hover:bg-white/22 border border-white/30'
                                            }`}
                                    >
                                        <X className={`w-4 h-4 ${isNo ? 'text-white' : 'text-blue-100'}`} />
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
                                calculatedAll ? '提交评估并生成报告' : '请完成全部诊断'
                            )}
                        </button>
                    )}
                </div>
            </div>

            <div className="h-[100px]" />
        </div>
    );
}
