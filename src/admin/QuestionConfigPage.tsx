import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Loader2, Plus, Save, Trash2, Upload, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { DIMENSIONS } from '../lib/constants';
import type { Dimension, ImportanceLevel, StrategyProfile } from '../lib/constants';
import type { RuleQuestion } from '../lib/rules';
import { fetchActiveRule, publishRuleVersion } from '../lib/rules';
import { useAppStore } from '../lib/store';

const DIMENSION_LABELS: Record<Dimension, string> = {
    philosophy: '理念',
    mechanism: '机制',
    team: '团队',
    tools: '工具',
};

const DIMENSION_ORDER: Record<Dimension, number> = {
    philosophy: 0,
    mechanism: 1,
    team: 2,
    tools: 3,
};

const IMPORTANCE_OPTIONS: ImportanceLevel[] = ['H', 'M', 'L'];
const IMPORTANCE_LABELS: Record<ImportanceLevel, string> = {
    H: 'H（高）',
    M: 'M（中）',
    L: 'L（低）',
};

const IMPORT_PREVIEW_LIMIT = 12;

interface QuestionFormState {
    dimension: Dimension;
    text: string;
    failureAction: string;
    weight: string;
    isDecisive: boolean;
    importance: ImportanceLevel;
}

interface ParsedImportRow {
    rowNumber: number;
    dimension: Dimension;
    text: string;
    sortOrder: number;
    isDecisive: boolean;
    importance: ImportanceLevel;
    suggestionAction: string;
}

interface ParsedQuestionImport {
    fileName: string;
    sheetName: string;
    sourceRows: number;
    parsedRows: number;
    skippedEmptyRows: number;
    warnings: string[];
    previewRows: ParsedImportRow[];
    questions: RuleQuestion[];
}

const emptyForm = (dimension: Dimension = 'philosophy'): QuestionFormState => ({
    dimension,
    text: '',
    failureAction: '',
    weight: '1',
    isDecisive: false,
    importance: 'M',
});

function parseWeight(value: string | number, fallback = 1): number {
    const fallbackInt = Math.max(0, Math.round(Number(fallback)));
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallbackInt;
    return Math.max(0, Math.round(parsed));
}

function toText(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
    return '';
}

function normalizeHeader(value: string): string {
    const normalized = value.toLowerCase().replace(/[\s_（）()【】:：-]/g, '');
    return normalized.replaceAll('[', '').replaceAll(']', '');
}

function getHeaderMap(headers: string[]): Map<string, string> {
    const map = new Map<string, string>();
    headers.forEach((header) => {
        map.set(normalizeHeader(header), header);
    });
    return map;
}

function pickHeader(headerMap: Map<string, string>, aliases: string[]): string | null {
    for (const alias of aliases) {
        const matched = headerMap.get(normalizeHeader(alias));
        if (matched) return matched;
    }
    return null;
}

function parseDimension(value: string): Dimension | null {
    const normalized = value.toLowerCase().replace(/\s/g, '');

    if (['理念', 'philosophy', 'p'].includes(normalized)) return 'philosophy';
    if (['机制', 'mechanism', 'm'].includes(normalized)) return 'mechanism';
    if (['团队', 'team', 't'].includes(normalized)) return 'team';
    if (['工具', 'tools', 'tool', 'to'].includes(normalized)) return 'tools';

    return null;
}

function parseOrder(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const text = toText(value);
    if (!text) return null;

    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return null;
    if (parsed <= 0) return null;

    return Math.floor(parsed);
}

function parseDecisive(value: unknown): boolean {
    if (value === true || value === false) return value;
    const text = toText(value).toLowerCase();

    if (!text) return false;

    if (['1', 'true', 'yes', 'y', '是', '关键', '决定性', '需触发'].includes(text)) return true;
    if (['0', 'false', 'no', 'n', '否', '非关键', '非决定性'].includes(text)) return false;

    return false;
}

function parseImportance(value: unknown): ImportanceLevel {
    if (typeof value === 'string') {
        const normalized = value.trim().toUpperCase();
        if (normalized === 'H' || normalized === 'M' || normalized === 'L') return normalized;
        if (['高', 'HIGH'].includes(normalized)) return 'H';
        if (['中', 'MEDIUM'].includes(normalized)) return 'M';
        if (['低', 'LOW'].includes(normalized)) return 'L';
    }
    return 'M';
}

function makeQuestionKey(dimension: Dimension, text: string): string {
    return `${dimension}::${text.trim().toLowerCase()}`;
}

function buildQuestionId(dimension: Dimension, sortOrder: number, index: number): string {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}_${index}`;
    return `import_${dimension}_${sortOrder}_${suffix}`;
}

function parseImportFileRows(file: File, currentQuestions: RuleQuestion[]): Promise<ParsedQuestionImport> {
    return file.arrayBuffer().then((arrayBuffer) => {
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];

        if (!sheetName) {
            throw new Error('Excel 中没有可读取的工作表。');
        }

        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });

        if (rows.length === 0) {
            throw new Error('表格中没有可导入的数据行。');
        }

        const headerMap = getHeaderMap(Object.keys(rows[0] ?? {}));
        const dimensionKey = pickHeader(headerMap, ['维度', 'dimension']);
        const questionKey = pickHeader(headerMap, ['题目', '题干', '问题', 'question']);
        const orderKey = pickHeader(headerMap, ['顺序', '序号', '排序', 'sort_order', 'order']);
        const decisiveKey = pickHeader(headerMap, ['是否决定性题目', '决定性题目', 'is_decisive', 'isdecisive']);
        const importanceKey = pickHeader(headerMap, ['重要程度', '重要性', '重要程度排序', 'importance', 'priority']);
        const actionKey = pickHeader(headerMap, ['建议行动', '失败动作', '补救动作', 'failure_action', 'action']);

        const missingHeaders: string[] = [];
        if (!dimensionKey) missingHeaders.push('维度');
        if (!questionKey) missingHeaders.push('题目');
        if (!orderKey) missingHeaders.push('顺序');
        if (!decisiveKey) missingHeaders.push('是否决定性题目');
        if (!importanceKey) missingHeaders.push('重要程度');
        if (!actionKey) missingHeaders.push('建议行动');

        if (missingHeaders.length > 0) {
            throw new Error(`导入失败：缺少字段 ${missingHeaders.join('、')}。`);
        }

        const dimensionColumn = dimensionKey as string;
        const questionColumn = questionKey as string;
        const orderColumn = orderKey as string;
        const decisiveColumn = decisiveKey as string;
        const importanceColumn = importanceKey as string;
        const actionColumn = actionKey as string;

        const rowErrors: string[] = [];
        const warnings: string[] = [];
        const parsedRows: ParsedImportRow[] = [];
        let skippedEmptyRows = 0;

        rows.forEach((row, index) => {
            const rowNumber = index + 2;
            const dimensionRaw = toText(row[dimensionColumn]);
            const textRaw = toText(row[questionColumn]);
            const orderRaw = row[orderColumn];
            const decisiveRaw = row[decisiveColumn];
            const importanceRaw = row[importanceColumn];
            const actionRaw = toText(row[actionColumn]);

            if (!dimensionRaw && !textRaw && !toText(orderRaw) && !toText(decisiveRaw) && !toText(importanceRaw) && !actionRaw) {
                skippedEmptyRows += 1;
                return;
            }

            const dimension = parseDimension(dimensionRaw);
            if (!dimension) {
                rowErrors.push(`第 ${rowNumber} 行维度不合法（${dimensionRaw || '空'}），仅支持：理念/机制/团队/工具。`);
                return;
            }

            if (!textRaw) {
                rowErrors.push(`第 ${rowNumber} 行题目不能为空。`);
                return;
            }

            const sortOrder = parseOrder(orderRaw);
            if (sortOrder === null) {
                rowErrors.push(`第 ${rowNumber} 行顺序必须是大于 0 的数字。`);
                return;
            }

            parsedRows.push({
                rowNumber,
                dimension,
                text: textRaw,
                sortOrder,
                isDecisive: parseDecisive(decisiveRaw),
                importance: parseImportance(importanceRaw),
                suggestionAction: actionRaw,
            });
        });

        if (rowErrors.length > 0) {
            const firstErrors = rowErrors.slice(0, 8).join('；');
            throw new Error(`导入校验失败：${firstErrors}${rowErrors.length > 8 ? '；...' : ''}`);
        }

        if (parsedRows.length === 0) {
            throw new Error('导入文件没有有效数据行。');
        }

        const existingQuestionMap = new Map<string, RuleQuestion>();
        currentQuestions.forEach((question) => {
            existingQuestionMap.set(makeQuestionKey(question.dimension, question.text), question);
        });

        const dedupedMap = new Map<string, ParsedImportRow>();
        parsedRows.forEach((row) => {
            const key = makeQuestionKey(row.dimension, row.text);
            const existing = dedupedMap.get(key);
            if (existing) {
                warnings.push(`题目重复：${DIMENSION_LABELS[row.dimension]} / ${row.text}，已采用后出现的一行（第 ${row.rowNumber} 行）。`);
            }
            dedupedMap.set(key, row);
        });

        const dedupedRows = Array.from(dedupedMap.values()).sort((a, b) => {
            if (a.dimension !== b.dimension) {
                return DIMENSION_ORDER[a.dimension] - DIMENSION_ORDER[b.dimension];
            }
            if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
            return a.rowNumber - b.rowNumber;
        });

        const questions: RuleQuestion[] = dedupedRows.map((row, index) => {
            const key = makeQuestionKey(row.dimension, row.text);
            const existing = existingQuestionMap.get(key);

            return {
                id: existing?.id ?? buildQuestionId(row.dimension, row.sortOrder, index),
                dimension: row.dimension,
                text: row.text,
                description: existing?.description ?? '',
                failureAction: row.suggestionAction || existing?.failureAction || '',
                weight: parseWeight(existing?.weight ?? 1, 1),
                sortOrder: row.sortOrder,
                isDecisive: row.isDecisive,
                importance: row.importance,
            };
        });

        return {
            fileName: file.name,
            sheetName,
            sourceRows: rows.length,
            parsedRows: questions.length,
            skippedEmptyRows,
            warnings,
            previewRows: dedupedRows.slice(0, IMPORT_PREVIEW_LIMIT),
            questions,
        };
    });
}

export default function QuestionConfigPage() {
    const navigate = useNavigate();
    const publishQuestions = useAppStore((state) => state.publishQuestions);

    const [activeTab, setActiveTab] = useState<Dimension>('philosophy');
    const [questions, setQuestions] = useState<RuleQuestion[]>([]);
    const [thresholds, setThresholds] = useState<Record<Dimension, number> | null>(null);
    const [strategies, setStrategies] = useState<Record<string, StrategyProfile> | null>(null);
    const [activeVersionLabel, setActiveVersionLabel] = useState('未加载');

    const [isLoading, setIsLoading] = useState(true);
    const [isPublishing, setIsPublishing] = useState(false);
    const [isParsingImport, setIsParsingImport] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState<QuestionFormState>(emptyForm());
    const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
    const [formError, setFormError] = useState('');

    const [parsedImport, setParsedImport] = useState<ParsedQuestionImport | null>(null);
    const importInputRef = useRef<HTMLInputElement | null>(null);
    const [thresholdReviewNeeded, setThresholdReviewNeeded] = useState(false);
    const [isDraftDirty, setIsDraftDirty] = useState(false);

    const markThresholdReviewNeeded = () => {
        setThresholdReviewNeeded(true);
    };

    const markQuestionDraftDirty = () => {
        setIsDraftDirty(true);
    };

    const loadActiveRule = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const rule = await fetchActiveRule();
            setQuestions(rule.questions);
            setThresholds(rule.thresholds);
            setStrategies(rule.strategies);
            setIsDraftDirty(false);
            publishQuestions(null);

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
    }, [publishQuestions]);

    useEffect(() => {
        void loadActiveRule();
    }, [loadActiveRule]);

    useEffect(() => {
        if (!toast) return;
        const timer = window.setTimeout(() => setToast(null), 2500);
        return () => window.clearTimeout(timer);
    }, [toast]);

    useEffect(() => {
        if (!isDraftDirty) return;
        publishQuestions(questions);
    }, [isDraftDirty, questions, publishQuestions]);

    const currentQuestions = useMemo(
        () => questions.filter((question) => question.dimension === activeTab),
        [questions, activeTab],
    );

    const updateQuestion = (id: string, patch: Partial<RuleQuestion>) => {
        markQuestionDraftDirty();
        if (Object.prototype.hasOwnProperty.call(patch, 'weight')) {
            markThresholdReviewNeeded();
        }
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
                    isDecisive: Boolean(question.isDecisive),
                    importance: question.importance ?? 'M',
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

    const handleDeleteQuestion = () => {
        if (!deleteTargetId) return;
        markQuestionDraftDirty();
        markThresholdReviewNeeded();
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
            description: '',
            failureAction: form.failureAction.trim(),
            weight,
            sortOrder: questions.length + 1,
            isDecisive: form.isDecisive,
            importance: form.importance,
        };

        markQuestionDraftDirty();
        markThresholdReviewNeeded();
        setQuestions((prev) => [...prev, newQuestion]);
        setActiveTab(form.dimension);
        closeModal();
    };

    const openImportPicker = () => {
        setError(null);
        importInputRef.current?.click();
    };

    const handleImportFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsParsingImport(true);
        setError(null);

        try {
            const parsed = await parseImportFileRows(file, questions);
            setParsedImport(parsed);
        } catch (err) {
            setParsedImport(null);
            setError(err instanceof Error ? err.message : '导入失败，请检查表格内容后重试。');
        } finally {
            setIsParsingImport(false);
            event.target.value = '';
        }
    };

    const applyImportedQuestions = () => {
        if (!parsedImport) return;
        markQuestionDraftDirty();
        markThresholdReviewNeeded();
        setQuestions(parsedImport.questions);
        if (parsedImport.questions[0]) {
            setActiveTab(parsedImport.questions[0].dimension);
        }
        setParsedImport(null);
        setToast(`导入完成：共 ${parsedImport.parsedRows} 道题，点击「发布至云端」后生效。`);
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
            <input
                ref={importInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleImportFileSelect}
            />

            <div className="p-6 rounded-2xl flex justify-between items-end med-panel">
                <div>
                    <h1 className="med-title-xl text-slate-800 mb-2">题库与权重管理</h1>
                    <p className="med-subtitle text-slate-600">编辑题干、失败动作与题目权重，并发布云端版本。</p>
                    <p className="text-xs text-slate-400 mt-2">当前激活版本：{activeVersionLabel}</p>
                </div>
                <div className="flex items-center gap-3">
                    {toast && <span className="text-emerald-600 font-bold text-sm">{toast}</span>}
                    <button
                        onClick={openImportPicker}
                        disabled={isParsingImport || isPublishing}
                        className="med-btn-sm med-button-secondary disabled:opacity-60"
                    >
                        {isParsingImport ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        表格一键更新
                    </button>
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

            {thresholdReviewNeeded && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="flex items-start gap-2.5 text-amber-800">
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                        <div className="text-sm">
                            题库权重已变更，请前往「分型与策略」确认各维度阈值是否需要调整。
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setThresholdReviewNeeded(false)}
                            className="med-btn-sm med-button-secondary"
                        >
                            稍后处理
                        </button>
                        <button
                            onClick={() => {
                                setThresholdReviewNeeded(false);
                                navigate('/admin/strategies');
                            }}
                            className="med-btn-sm med-button-primary"
                        >
                            前往分型与策略
                            <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>
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

                            <div className="pl-4">
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6 items-start">
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
                                    <div className="md:col-span-1">
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                            权重
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="1"
                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
                                            value={question.weight}
                                            onChange={(event) =>
                                                updateQuestion(question.id, { weight: parseWeight(event.target.value, question.weight) })
                                            }
                                        />
                                        <label className="mt-3 inline-flex items-center gap-2 text-xs text-slate-600 font-semibold cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                                                checked={Boolean(question.isDecisive)}
                                                onChange={(event) => updateQuestion(question.id, { isDecisive: event.target.checked })}
                                            />
                                            决定性题目
                                        </label>
                                    </div>

                                    <div className="md:col-span-3">
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

                                    <div className="md:col-span-1">
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                            重要程度
                                        </label>
                                        <select
                                            value={question.importance ?? 'M'}
                                            onChange={(event) => updateQuestion(question.id, { importance: parseImportance(event.target.value) })}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
                                        >
                                            {IMPORTANCE_OPTIONS.map((level) => (
                                                <option key={level} value={level}>{IMPORTANCE_LABELS[level]}</option>
                                            ))}
                                        </select>
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
                                        onClick={() => setForm((prev) => ({ ...prev, dimension }))}
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
                                    setForm((prev) => ({ ...prev, text: event.target.value }));
                                    setFormError('');
                                }}
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">题目权重 *</label>
                            <input
                                type="number"
                                min="0"
                                step="1"
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
                                value={form.weight}
                                onChange={(event) => setForm((prev) => ({ ...prev, weight: event.target.value }))}
                            />
                            <label className="mt-3 inline-flex items-center gap-2 text-xs text-slate-600 font-semibold cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                                    checked={form.isDecisive}
                                    onChange={(event) => setForm((prev) => ({ ...prev, isDecisive: event.target.checked }))}
                                />
                                决定性题目
                            </label>
                            <div className="mt-3">
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">重要程度</label>
                                <select
                                    value={form.importance}
                                    onChange={(event) => setForm((prev) => ({ ...prev, importance: parseImportance(event.target.value) }))}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
                                >
                                    {IMPORTANCE_OPTIONS.map((level) => (
                                        <option key={level} value={level}>{IMPORTANCE_LABELS[level]}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-rose-500 uppercase tracking-wider mb-2">Failure Action (选否触发补救策略)</label>
                            <textarea
                                className="w-full bg-rose-50/30 border border-rose-200 rounded-lg p-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all resize-none"
                                rows={2}
                                placeholder="当用户选择「否」时触发的补救建议（可选）"
                                value={form.failureAction}
                                onChange={(event) => setForm((prev) => ({ ...prev, failureAction: event.target.value }))}
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

            {parsedImport && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setParsedImport(null)} />
                    <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-5xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <h2 className="text-xl font-bold text-slate-800">导入预览</h2>
                                <p className="text-sm text-slate-500 mt-1">
                                    文件：{parsedImport.fileName} ｜ Sheet：{parsedImport.sheetName} ｜ 源行数：{parsedImport.sourceRows} ｜ 有效题目：{parsedImport.parsedRows} ｜ 空行跳过：{parsedImport.skippedEmptyRows}
                                </p>
                            </div>
                            <button
                                onClick={() => setParsedImport(null)}
                                className="med-btn-sm med-button-secondary !h-8 !w-8 !p-0 text-slate-500"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {parsedImport.warnings.length > 0 && (
                            <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-xl px-4 py-3 text-sm">
                                <p className="font-semibold mb-1">导入提醒</p>
                                <p>{parsedImport.warnings.slice(0, 4).join('；')}{parsedImport.warnings.length > 4 ? '；...' : ''}</p>
                            </div>
                        )}

                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-slate-50 text-slate-600">
                                        <tr>
                                            <th className="px-3 py-2 text-left">行号</th>
                                            <th className="px-3 py-2 text-left">维度</th>
                                            <th className="px-3 py-2 text-left">题目</th>
                                            <th className="px-3 py-2 text-left">顺序</th>
                                            <th className="px-3 py-2 text-left">决定性题目</th>
                                            <th className="px-3 py-2 text-left">重要程度</th>
                                            <th className="px-3 py-2 text-left">建议行动</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {parsedImport.previewRows.map((row) => (
                                            <tr key={`${row.rowNumber}-${row.dimension}-${row.sortOrder}`} className="border-t border-slate-100 text-slate-700">
                                                <td className="px-3 py-2">{row.rowNumber}</td>
                                                <td className="px-3 py-2">{DIMENSION_LABELS[row.dimension]}</td>
                                                <td className="px-3 py-2 max-w-[440px] truncate" title={row.text}>{row.text}</td>
                                                <td className="px-3 py-2">{row.sortOrder}</td>
                                                <td className="px-3 py-2">{row.isDecisive ? '是' : '否'}</td>
                                                <td className="px-3 py-2">{IMPORTANCE_LABELS[row.importance]}</td>
                                                <td className="px-3 py-2 max-w-[420px] truncate" title={row.suggestionAction}>{row.suggestionAction || '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {parsedImport.parsedRows > parsedImport.previewRows.length && (
                            <p className="text-xs text-slate-400">仅预览前 {parsedImport.previewRows.length} 条，其余将在应用后一并写入当前题库草稿。</p>
                        )}

                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                onClick={() => setParsedImport(null)}
                                className="med-btn med-button-secondary"
                            >
                                取消
                            </button>
                            <button
                                onClick={applyImportedQuestions}
                                className="med-btn med-button-primary"
                            >
                                <Save className="w-4 h-4" />
                                应用导入结果
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
