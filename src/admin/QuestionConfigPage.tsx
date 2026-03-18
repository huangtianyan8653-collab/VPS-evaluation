import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { DIMENSIONS } from '../lib/constants';
import type { Dimension } from '../lib/constants';
import type { RuleQuestion } from '../lib/rules';
import { fetchActiveRule, publishRuleVersion } from '../lib/rules';

const DIMENSION_LABELS: Record<Dimension, string> = {
    philosophy: '理念',
    mechanism: '机制',
    team: '团队',
    tools: '工具',
};

interface QuestionFormState {
    dimension: Dimension;
    text: string;
    description: string;
    failureAction: string;
    weight: string;
}

const emptyForm = (dimension: Dimension = 'philosophy'): QuestionFormState => ({
    dimension,
    text: '',
    description: '',
    failureAction: '',
    weight: '1',
});

function parseWeight(value: string | number, fallback = 1): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export default function QuestionConfigPage() {
    const [activeTab, setActiveTab] = useState<Dimension>('philosophy');
    const [questions, setQuestions] = useState<RuleQuestion[]>([]);
    const [thresholds, setThresholds] = useState<Record<Dimension, number> | null>(null);
    const [strategies, setStrategies] = useState<Record<string, { type: string; strategy: string }> | null>(null);
    const [activeVersionLabel, setActiveVersionLabel] = useState('未加载');

    const [isLoading, setIsLoading] = useState(true);
    const [isPublishing, setIsPublishing] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState<QuestionFormState>(emptyForm());
    const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
    const [formError, setFormError] = useState('');

    const loadActiveRule = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const rule = await fetchActiveRule();
            setQuestions(rule.questions);
            setThresholds(rule.thresholds);
            setStrategies(rule.strategies);

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

    const currentQuestions = useMemo(
        () => questions.filter((question) => question.dimension === activeTab),
        [questions, activeTab],
    );

    const updateQuestion = (id: string, patch: Partial<RuleQuestion>) => {
        setQuestions((prev) =>
            prev.map((question) => (question.id === id ? { ...question, ...patch } : question)),
        );
    };

    const handleSave = async () => {
        if (!thresholds || !strategies) return;
        if (questions.length === 0) {
            setError('题库不能为空，至少保留一道题。');
            return;
        }

        setIsPublishing(true);
        setError(null);

        try {
            const normalizedQuestions = questions
                .map((question, index) => ({
                    ...question,
                    id: question.id.trim(),
                    text: question.text.trim(),
                    description: question.description.trim(),
                    failureAction: question.failureAction.trim(),
                    weight: parseWeight(question.weight, 1),
                    sortOrder: index + 1,
                }))
                .filter((question) => question.id.length > 0 && question.text.length > 0);

            if (normalizedQuestions.length === 0) {
                throw new Error('题干内容不能为空。');
            }

            const result = await publishRuleVersion({
                versionName: `题库发布 ${new Date().toLocaleString()}`,
                questions: normalizedQuestions,
                thresholds,
                strategies,
            });

            setToast(`发布成功：${result.versionCode}`);
            await loadActiveRule();
        } catch (err) {
            setError(err instanceof Error ? err.message : '发布失败，请重试。');
        } finally {
            setIsPublishing(false);
        }
    };

    const openModal = () => {
        setForm(emptyForm(activeTab));
        setFormError('');
        setShowModal(true);
    };

    const closeModal = () => {
        setShowModal(false);
        setFormError('');
    };

    const handleFormChange = (field: keyof QuestionFormState, value: string) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const handleDeleteQuestion = () => {
        if (!deleteTargetId) return;
        setQuestions((prev) => prev.filter((question) => question.id !== deleteTargetId));
        setDeleteTargetId(null);
    };

    const handleAddQuestion = () => {
        if (!form.text.trim()) {
            setFormError('题干内容不能为空');
            return;
        }

        const weight = parseWeight(form.weight, -1);
        if (weight < 0) {
            setFormError('权重必须是大于等于 0 的数字');
            return;
        }

        const newQuestion: RuleQuestion = {
            id: `custom_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            dimension: form.dimension,
            text: form.text.trim(),
            description: form.description.trim(),
            failureAction: form.failureAction.trim(),
            weight,
            sortOrder: questions.length + 1,
        };

        setQuestions((prev) => [...prev, newQuestion]);
        setActiveTab(form.dimension);
        closeModal();
    };

    if (isLoading) {
        return (
            <div className="rounded-2xl p-12 text-center text-slate-500 med-panel">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500 mx-auto mb-3" />
                正在加载云端规则...
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-10">
            <div className="p-6 rounded-2xl flex justify-between items-end med-panel">
                <div>
                    <h1 className="med-title-xl text-slate-800 mb-2">题库与权重管理</h1>
                    <p className="med-subtitle text-slate-600">编辑题干、提示、失败动作与题目权重，并发布云端版本。</p>
                    <p className="text-xs text-slate-400 mt-2">当前激活版本：{activeVersionLabel}</p>
                </div>
                <div className="flex items-center gap-3">
                    {toast && <span className="text-emerald-600 font-bold text-sm">{toast}</span>}
                    <button
                        onClick={openModal}
                        className="med-btn-sm med-button-secondary"
                    >
                        <Plus className="w-4 h-4" />
                        新增题目
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isPublishing}
                        className="med-btn-sm med-button-primary disabled:opacity-60"
                    >
                        {isPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        发布至云端
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-sm">
                    {error}
                </div>
            )}

            <div className="rounded-2xl overflow-hidden med-panel">
                <div className="flex border-b border-slate-100 px-2 bg-slate-50">
                    {DIMENSIONS.map((dimension) => (
                        <button
                            key={dimension}
                            onClick={() => setActiveTab(dimension)}
                            className={`px-8 py-4 font-bold text-sm transition-colors border-b-2 ${activeTab === dimension
                                ? 'border-primary-600 text-primary-600 bg-white'
                                : 'border-transparent text-slate-500 hover:text-slate-800'
                                }`}
                        >
                            {DIMENSION_LABELS[dimension]} ({questions.filter((question) => question.dimension === dimension).length})
                        </button>
                    ))}
                </div>

                <div className="p-8 space-y-8 bg-slate-50/30">
                    {currentQuestions.length === 0 && (
                        <div className="text-center py-16 text-slate-400">
                            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto mb-3">
                                <Plus className="w-5 h-5" />
                            </div>
                            <p className="font-medium">当前维度暂无题目，点击「新增题目」添加</p>
                        </div>
                    )}
                    {currentQuestions.map((question, index) => (
                        <div key={question.id} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm relative group">
                            <div className="absolute top-6 -left-3 w-6 h-6 bg-slate-900 text-white flex items-center justify-center rounded-full text-xs font-bold shadow-md">
                                {index + 1}
                            </div>
                            <button
                                onClick={() => setDeleteTargetId(question.id)}
                                title="删除此题目"
                                className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-all"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>

                            <div className="space-y-4 pl-4">
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                                    <div className="md:col-span-3">
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                            题干内容 (是/否)
                                        </label>
                                        <textarea
                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all resize-none"
                                            rows={2}
                                            value={question.text}
                                            onChange={(event) => updateQuestion(question.id, { text: event.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                            权重
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.1"
                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
                                            value={question.weight}
                                            onChange={(event) =>
                                                updateQuestion(question.id, { weight: parseWeight(event.target.value, question.weight) })
                                            }
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">补充提示说明</label>
                                        <textarea
                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all resize-none"
                                            rows={2}
                                            value={question.description}
                                            onChange={(event) => updateQuestion(question.id, { description: event.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-rose-500 uppercase tracking-wider mb-2">
                                            Failure Action (选否触发补救策略)
                                        </label>
                                        <textarea
                                            className="w-full bg-rose-50/30 border border-rose-200 rounded-lg p-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all resize-none"
                                            rows={2}
                                            value={question.failureAction}
                                            onChange={(event) => updateQuestion(question.id, { failureAction: event.target.value })}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {deleteTargetId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteTargetId(null)} />
                    <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 space-y-5">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0">
                                <Trash2 className="w-5 h-5 text-rose-500" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-slate-800">确认删除</h2>
                                <p className="text-sm text-slate-500 mt-0.5">此操作仅影响当前待发布内容，发布后才会生效。</p>
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                onClick={() => setDeleteTargetId(null)}
                                className="med-btn med-button-secondary"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleDeleteQuestion}
                                className="med-btn med-button-danger"
                            >
                                <Trash2 className="w-4 h-4" />
                                确认删除
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeModal} />
                    <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-xl p-8 space-y-6">
                        <div className="flex justify-between items-center">
                            <h2 className="text-xl font-bold text-slate-800">新增题目</h2>
                            <button
                                onClick={closeModal}
                                className="med-btn-sm med-button-secondary !h-8 !w-8 !p-0 text-slate-500"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">所属维度</label>
                            <div className="flex gap-2">
                                {DIMENSIONS.map((dimension) => (
                                    <button
                                        key={dimension}
                                        onClick={() => handleFormChange('dimension', dimension)}
                                        className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors ${form.dimension === dimension
                                            ? 'bg-primary-600 text-white border-primary-600'
                                            : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-primary-400 hover:text-primary-600'
                                            }`}
                                    >
                                        {DIMENSION_LABELS[dimension]}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">题干内容 (是/否) *</label>
                            <textarea
                                className={`w-full bg-slate-50 border rounded-lg p-3 text-slate-800 font-medium focus:outline-none focus:ring-2 transition-all resize-none ${formError ? 'border-rose-400 focus:ring-rose-500/20' : 'border-slate-200 focus:ring-primary-500/20 focus:border-primary-500'}`}
                                rows={3}
                                placeholder="请输入问题内容，例如：管理层是否支持集采政策落地？"
                                value={form.text}
                                onChange={(event) => {
                                    handleFormChange('text', event.target.value);
                                    setFormError('');
                                }}
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">题目权重 *</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.1"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
                                    value={form.weight}
                                    onChange={(event) => handleFormChange('weight', event.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">补充提示说明</label>
                                <input
                                    type="text"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
                                    placeholder="补充说明或评判标准（可选）"
                                    value={form.description}
                                    onChange={(event) => handleFormChange('description', event.target.value)}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-rose-500 uppercase tracking-wider mb-2">Failure Action (选否触发补救策略)</label>
                            <textarea
                                className="w-full bg-rose-50/30 border border-rose-200 rounded-lg p-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all resize-none"
                                rows={2}
                                placeholder="当用户选择「否」时触发的补救建议（可选）"
                                value={form.failureAction}
                                onChange={(event) => handleFormChange('failureAction', event.target.value)}
                            />
                            {formError && <p className="text-rose-500 text-xs mt-2">{formError}</p>}
                        </div>

                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                onClick={closeModal}
                                className="med-btn med-button-secondary"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleAddQuestion}
                                className="med-btn med-button-primary"
                            >
                                <Plus className="w-4 h-4" />
                                确认新增
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
