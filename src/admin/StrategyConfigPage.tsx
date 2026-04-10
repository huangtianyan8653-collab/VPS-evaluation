import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { AlertTriangle, Loader2, Save, Settings2, Target, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import { DIMENSIONS, STRATEGIES, STRATEGY_KEY_ORDER } from '../lib/constants';
import type { Dimension, Question, StrategyProfile } from '../lib/constants';
import type { RuleQuestion } from '../lib/rules';
import { fetchActiveRule, updateActiveStrategyConfig } from '../lib/rules';
import { normalizeStrategyKey } from '../lib/algorithm';
import { useAppStore } from '../lib/store';

interface StrategyItem {
    key: string;
    vpsHospitalLevel: string;
    mbtiPersona: string;
    traitDescription: string;
    guidanceDirection: string;
}

const DIMENSION_LABELS: Record<Dimension, string> = {
    philosophy: '理念',
    mechanism: '机制',
    team: '团队',
    tools: '工具',
};

function parseThreshold(value: string | number, fallback: number): number {
    const fallbackInt = Math.max(0, Math.round(Number(fallback)));
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallbackInt;
    return Math.max(0, Math.round(parsed));
}

function parseQuestionWeight(value: unknown, fallback = 1): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return Math.max(0, Math.round(fallback));
    return Math.max(0, Math.round(parsed));
}

function normalizeQuestionDraft(questions: Question[]): RuleQuestion[] {
    return questions
        .map((question, index) => {
            const sortOrderCandidate = Number((question as RuleQuestion).sortOrder);
            return {
                ...question,
                description: question.description ?? '',
                failureAction: question.failureAction ?? '',
                weight: parseQuestionWeight(question.weight, 1),
                sortOrder: Number.isFinite(sortOrderCandidate) ? sortOrderCandidate : index + 1,
                isDecisive: Boolean((question as RuleQuestion).isDecisive),
                importance: (question as RuleQuestion).importance ?? 'M',
            };
        })
        .filter((question) => question.id.trim().length > 0 && question.text.trim().length > 0)
        .sort((a, b) => a.sortOrder - b.sortOrder);
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
        const found = headerMap.get(normalizeHeader(alias));
        if (found) return found;
    }
    return null;
}

function parseMbtiKey(value: unknown): string | null {
    const raw = toText(value).toUpperCase();
    if (!raw) return null;

    if (raw.length === 4 && !raw.includes(',') && !raw.includes('/')) {
        const chars = raw.split('');
        const composed = chars.join(',');
        const normalized = normalizeStrategyKey(composed);
        return normalized || null;
    }

    const compact = raw.replace(/[/\s]+/g, ',');
    const normalized = normalizeStrategyKey(compact);
    return normalized || null;
}

async function parseStrategyImportFile(file: File): Promise<{
    parsedRows: number;
    skippedEmptyRows: number;
    warnings: string[];
    strategies: Map<string, Omit<StrategyItem, 'key'>>;
}> {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
        throw new Error('Excel 中没有可读取的工作表。');
    }

    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
    if (!rows.length) {
        throw new Error('Excel 没有可导入的数据行。');
    }

    const headerMap = getHeaderMap(Object.keys(rows[0] ?? {}));
    const levelKey = pickHeader(headerMap, ['VPS医院分级', '医院分级', 'vps_hospital_level']);
    const mbtiTypeKey = pickHeader(headerMap, ['MBTI分型', '分型', 'mbti_type', 'mbti']);
    const mbtiPersonaKey = pickHeader(headerMap, ['MBTI人格', '人格', 'mbti_persona']);
    const traitDescriptionKey = pickHeader(headerMap, ['特征描述', '特征', 'trait_description']);
    const guidanceDirectionKey = pickHeader(headerMap, ['建议方向', '建议策略', 'guidance_direction']);

    const missingHeaders: string[] = [];
    if (!levelKey) missingHeaders.push('VPS医院分级');
    if (!mbtiTypeKey) missingHeaders.push('MBTI分型');
    if (!mbtiPersonaKey) missingHeaders.push('MBTI人格');
    if (!traitDescriptionKey) missingHeaders.push('特征描述');
    if (!guidanceDirectionKey) missingHeaders.push('建议方向');
    if (missingHeaders.length > 0) {
        throw new Error(`导入失败：缺少字段 ${missingHeaders.join('、')}。`);
    }

    const levelColumn = levelKey as string;
    const mbtiTypeColumn = mbtiTypeKey as string;
    const mbtiPersonaColumn = mbtiPersonaKey as string;
    const traitDescriptionColumn = traitDescriptionKey as string;
    const guidanceDirectionColumn = guidanceDirectionKey as string;

    const strategies = new Map<string, Omit<StrategyItem, 'key'>>();
    const warnings: string[] = [];
    let skippedEmptyRows = 0;

    rows.forEach((row, index) => {
        const rowNumber = index + 2;
        const level = toText(row[levelColumn]);
        const mbtiTypeRaw = row[mbtiTypeColumn];
        const mbtiPersona = toText(row[mbtiPersonaColumn]);
        const traitDescription = toText(row[traitDescriptionColumn]);
        const guidanceDirection = toText(row[guidanceDirectionColumn]);
        const allEmpty = !level && !toText(mbtiTypeRaw) && !mbtiPersona && !traitDescription && !guidanceDirection;
        if (allEmpty) {
            skippedEmptyRows += 1;
            return;
        }

        const strategyKey = parseMbtiKey(mbtiTypeRaw);
        if (!strategyKey) {
            warnings.push(`第 ${rowNumber} 行 MBTI分型 无法识别，已跳过。`);
            return;
        }

        if (!STRATEGY_KEY_ORDER.includes(strategyKey)) {
            warnings.push(`第 ${rowNumber} 行 MBTI分型 ${strategyKey} 不在16分型范围内，已跳过。`);
            return;
        }

        strategies.set(strategyKey, {
            vpsHospitalLevel: level,
            mbtiPersona,
            traitDescription,
            guidanceDirection,
        });
    });

    if (strategies.size === 0) {
        throw new Error('导入文件没有有效策略行。请检查 MBTI分型 列格式（如 E,S,T,J 或 ESTJ）。');
    }

    return {
        parsedRows: strategies.size,
        skippedEmptyRows,
        warnings,
        strategies,
    };
}

function buildStrategyList(sourceStrategies: Record<string, StrategyProfile>): StrategyItem[] {
    const merged = { ...STRATEGIES, ...sourceStrategies };
    return STRATEGY_KEY_ORDER.map((key) => ({
        key,
        vpsHospitalLevel: merged[key]?.vpsLevel ?? '',
        mbtiPersona: merged[key]?.mbtiPersona ?? merged[key]?.type ?? '未命名人格',
        traitDescription: merged[key]?.traitDescription ?? '',
        guidanceDirection: merged[key]?.guidanceDirection ?? merged[key]?.strategy ?? '',
    }));
}

export default function StrategyConfigPage() {
    const publishedQuestions = useAppStore((state) => state.publishedQuestions);
    const publishQuestions = useAppStore((state) => state.publishQuestions);

    const [thresholds, setThresholds] = useState<Record<Dimension, number> | null>(null);
    const [strategyList, setStrategyList] = useState<StrategyItem[]>([]);
    const [questions, setQuestions] = useState<RuleQuestion[]>([]);
    const [activeVersionLabel, setActiveVersionLabel] = useState('未加载');

    const [isLoading, setIsLoading] = useState(true);
    const [isPublishing, setIsPublishing] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const strategyImportInputRef = useRef<HTMLInputElement | null>(null);

    const draftQuestions = useMemo(
        () => (publishedQuestions && publishedQuestions.length > 0 ? normalizeQuestionDraft(publishedQuestions) : []),
        [publishedQuestions],
    );
    const hasQuestionDraft = draftQuestions.length > 0;
    const effectiveQuestions = hasQuestionDraft ? draftQuestions : questions;

    const loadActiveRule = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const rule = await fetchActiveRule();
            setThresholds(rule.thresholds);
            setQuestions(rule.questions);
            setStrategyList(buildStrategyList(rule.strategies));

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

        effectiveQuestions.forEach((question) => {
            totals[question.dimension] += Number(question.weight ?? 1);
        });

        return totals;
    }, [effectiveQuestions]);

    const handleStrategyChange = (
        index: number,
        field: 'vpsHospitalLevel' | 'mbtiPersona' | 'traitDescription' | 'guidanceDirection',
        value: string,
    ) => {
        setStrategyList((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: value };
            return next;
        });
    };

    const updateThreshold = (dimension: Dimension, nextValue: number) => {
        setThresholds((prev) => {
            if (!prev) return prev;
            return { ...prev, [dimension]: parseThreshold(nextValue, prev[dimension]) };
        });
    };

    const handleClickStrategyImport = () => {
        setError(null);
        strategyImportInputRef.current?.click();
    };

    const handleStrategyImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        setIsImporting(true);
        setError(null);

        try {
            const parsed = await parseStrategyImportFile(file);
            setStrategyList((prev) =>
                prev.map((item) => {
                    const imported = parsed.strategies.get(item.key);
                    if (!imported) return item;
                    return { ...item, ...imported };
                }),
            );
            const warningText = parsed.warnings.length > 0 ? `（含 ${parsed.warnings.length} 条跳过提示）` : '';
            const skipText = parsed.skippedEmptyRows > 0 ? `，空行跳过 ${parsed.skippedEmptyRows} 条` : '';
            setToast(`策略导入完成：匹配 ${parsed.parsedRows} 条${skipText}${warningText}`);
            if (parsed.warnings.length > 0) {
                setError(parsed.warnings.slice(0, 6).join('；'));
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : '策略导入失败');
        } finally {
            setIsImporting(false);
        }
    };

    const handleSave = async () => {
        if (!thresholds) return;
        if (effectiveQuestions.length === 0) {
            setError('题库为空，无法生效策略。请先在题库管理中至少保留一个题目。');
            return;
        }

        setIsPublishing(true);
        setError(null);

        try {
            const strategies = strategyList.reduce<Record<string, StrategyProfile>>((acc, item) => {
                const mbtiPersona = item.mbtiPersona.trim() || '未命名人格';
                const guidanceDirection = item.guidanceDirection.trim();
                acc[item.key] = {
                    type: mbtiPersona,
                    strategy: guidanceDirection,
                    vpsLevel: item.vpsHospitalLevel.trim(),
                    mbtiPersona,
                    traitDescription: item.traitDescription.trim(),
                    guidanceDirection,
                };
                return acc;
            }, {});

            const result = await updateActiveStrategyConfig({
                thresholds,
                strategies,
            });

            setToast(`生效成功：沿用版本 ${result.versionCode}`);
            publishQuestions(null);
            await loadActiveRule();
        } catch (err) {
            setError(err instanceof Error ? err.message : '生效失败，请稍后重试。');
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
                    <p className="med-subtitle text-slate-600">编辑阈值和 16 种分型策略，保存后直接覆盖当前激活题库版本，不新建版本号。</p>
                    <p className="text-xs text-slate-400 mt-2">当前题库版本（策略就地生效）：{activeVersionLabel}</p>
                </div>
                <div className="flex items-center gap-3">
                    {toast && <span className="text-emerald-600 font-bold text-sm">{toast}</span>}
                    <button
                        onClick={handleClickStrategyImport}
                        disabled={isImporting || isPublishing}
                        className="med-btn-sm med-button-secondary disabled:opacity-60"
                    >
                        {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        表格一键导入
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isPublishing || isImporting}
                        className="med-btn-sm med-button-primary disabled:opacity-60"
                    >
                        {isPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        保存并生效
                    </button>
                </div>
            </div>

            <input
                ref={strategyImportInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleStrategyImportFileChange}
            />

            {error && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-sm">
                    {error}
                </div>
            )}

            {hasQuestionDraft && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 flex items-start gap-2.5 text-amber-800 text-sm">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    当前“满分权重”与本页发布所用题库，已联动题库管理中的未发布草稿。
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
                                        <div className="text-xs text-slate-400">当前满分权重: {Math.round(dimensionMaxScores[dimension])}</div>
                                    </div>

                                    <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden">
                                        <button
                                            onClick={() => updateThreshold(dimension, thresholds[dimension] - 1)}
                                            className="px-3 py-2 font-bold text-slate-500 hover:bg-slate-100 transition-colors"
                                        >
                                            -
                                        </button>
                                        <input
                                            type="number"
                                            min="0"
                                            step="1"
                                            value={thresholds[dimension]}
                                            onChange={(event) => updateThreshold(dimension, parseThreshold(event.target.value, thresholds[dimension]))}
                                            className="w-full text-center font-bold text-primary-600 border-x border-slate-200 py-2 focus:outline-none bg-white"
                                        />
                                        <button
                                            onClick={() => updateThreshold(dimension, thresholds[dimension] + 1)}
                                            className="px-3 py-2 font-bold text-slate-500 hover:bg-slate-100 transition-colors"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>
                            ))}

                            <div className="mt-4 text-xs leading-relaxed bg-blue-50/60 p-3 rounded-lg text-blue-800 border border-blue-100">
                                判定规则：当维度得分 <code>score &gt;= threshold</code> 时，理念记为 <strong>J</strong>（否则 P）、
                                机制记为 <strong>T</strong>（否则 F）、团队记为 <strong>E</strong>（否则 I）、工具记为 <strong>S</strong>（否则 N）。
                            </div>
                        </div>
                    </div>
                </div>

                <div className="xl:col-span-2">
                    <div className="rounded-2xl p-6 med-panel">
                        <h2 className="med-title-md text-slate-800 flex items-center gap-2 mb-6">
                            <Target className="w-5 h-5 text-amber-500" />
                            16项组合策略池 (E/I, S/N, T/F, J/P)
                        </h2>
                        <p className="text-xs text-slate-500 mb-4">
                            可通过“表格一键导入”更新，字段要求：VPS医院分级、MBTI分型、MBTI人格、特征描述、建议方向（以 MBTI分型 作为唯一匹配键）。
                        </p>

                        <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
                            {strategyList.map((item, index) => (
                                <div key={item.key} className="flex gap-4 p-4 rounded-xl border border-slate-200 bg-slate-50 hover:border-primary-300 transition-colors">
                                    <div className="w-24 shrink-0 flex flex-col justify-center items-center bg-white rounded-lg border border-slate-200">
                                        <span className="text-[10px] uppercase font-bold text-slate-400 mb-1">MBTI分型</span>
                                        <span className="font-mono font-bold tracking-widest text-primary-700">{item.key}</span>
                                    </div>
                                    <div className="flex-1 space-y-3">
                                        <div className="flex gap-2">
                                            <span className="bg-slate-200 text-slate-600 text-xs px-2 py-1 rounded-md font-bold whitespace-nowrap">
                                                VPS医院分级
                                            </span>
                                            <input
                                                type="text"
                                                value={item.vpsHospitalLevel}
                                                onChange={(event) => handleStrategyChange(index, 'vpsHospitalLevel', event.target.value)}
                                                className="flex-1 bg-white border border-slate-200 rounded-md px-3 text-sm font-bold text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-1 rounded-md font-bold whitespace-nowrap">
                                                MBTI人格
                                            </span>
                                            <input
                                                type="text"
                                                value={item.mbtiPersona}
                                                onChange={(event) => handleStrategyChange(index, 'mbtiPersona', event.target.value)}
                                                className="flex-1 bg-white border border-slate-200 rounded-md px-3 text-sm font-bold text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <span className="bg-slate-200 text-slate-600 text-xs px-2 py-1 rounded-md font-bold whitespace-nowrap self-start">
                                                特征描述
                                            </span>
                                            <textarea
                                                value={item.traitDescription}
                                                onChange={(event) => handleStrategyChange(index, 'traitDescription', event.target.value)}
                                                className="flex-1 bg-white border border-slate-200 rounded-md p-2 text-sm text-slate-600 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 resize-none h-14 leading-relaxed"
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <span className="bg-amber-100 text-amber-700 text-xs px-2 py-1 rounded-md font-bold whitespace-nowrap self-start">
                                                建议方向
                                            </span>
                                            <textarea
                                                value={item.guidanceDirection}
                                                onChange={(event) => handleStrategyChange(index, 'guidanceDirection', event.target.value)}
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
