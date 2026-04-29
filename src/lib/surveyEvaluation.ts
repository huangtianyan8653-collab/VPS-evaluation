import { DIMENSIONS } from './constants';
import type { Dimension } from './constants';
import type { RuleQuestion } from './rules';

function normalizeWeight(value: unknown, fallback = 1): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return Math.max(0, Math.round(fallback));
    return Math.max(0, Math.round(parsed));
}

export interface DimensionEvaluation {
    visibleQuestions: RuleQuestion[];
    requiredCount: number;
    answeredCount: number;
    isComplete: boolean;
    score: number;
    maxScore: number;
    forcedFalse: boolean;
    failureActions: string[];
}

export function collectFailureActionsByDisplayOrder(
    evaluations: Record<Dimension, { failureActions: string[] }>
): string[] {
    return DIMENSIONS.flatMap((dimension) => evaluations[dimension]?.failureActions ?? []);
}

export function evaluateDimensionQuestions(
    dimensionQuestions: RuleQuestion[],
    answers: Record<string, boolean>
): DimensionEvaluation {
    const visibleQuestions: RuleQuestion[] = [];
    const failureActions: string[] = [];
    let score = 0;
    let maxScore = 0;
    let answeredCount = 0;
    let forcedFalse = false;

    for (const question of dimensionQuestions) {
        visibleQuestions.push(question);
        const weight = normalizeWeight(question.weight, 1);
        maxScore += weight;

        const hasAnswer = answers[question.id] !== undefined;
        if (hasAnswer) {
            answeredCount += 1;
            if (answers[question.id] === true) {
                score += weight;
            } else {
                const action = question.failureAction.trim();
                const importance = (question.importance ?? 'M').toUpperCase();
                if (importance === 'H' && action.length > 0) {
                    failureActions.push(action);
                }
            }
        }

        if (question.isDecisive) {
            if (answers[question.id] === false) {
                forcedFalse = true;
                break;
            }
            if (answers[question.id] !== true) {
                break;
            }
        }
    }

    return {
        visibleQuestions,
        requiredCount: visibleQuestions.length,
        answeredCount,
        isComplete: answeredCount === visibleQuestions.length,
        score,
        maxScore,
        forcedFalse,
        failureActions,
    };
}
