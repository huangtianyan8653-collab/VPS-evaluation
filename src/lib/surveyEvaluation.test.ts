import { describe, expect, it } from 'vitest';
import type { Dimension } from './constants';
import type { RuleQuestion } from './rules';
import * as surveyEvaluationModule from './surveyEvaluation';
import { evaluateDimensionQuestions } from './surveyEvaluation';

function makeQuestion(
    id: string,
    overrides: Partial<RuleQuestion> = {}
): RuleQuestion {
    return {
        id,
        dimension: 'philosophy',
        text: `Q-${id}`,
        description: '',
        failureAction: '',
        weight: 1,
        sortOrder: 1,
        isDecisive: false,
        importance: 'M',
        ...overrides,
    };
}

describe('survey dimension evaluation', () => {
    it('stops this dimension when decisive question answer is false and forces false', () => {
        const questions: RuleQuestion[] = [
            makeQuestion('q1', {
                isDecisive: true,
                weight: 2,
                failureAction: '触发补救',
                importance: 'H',
            }),
            makeQuestion('q2', { weight: 3 }),
        ];
        const answers = { q1: false, q2: true };

        const result = evaluateDimensionQuestions(questions, answers);

        expect(result.visibleQuestions.map((q) => q.id)).toEqual(['q1']);
        expect(result.requiredCount).toBe(1);
        expect(result.answeredCount).toBe(1);
        expect(result.isComplete).toBe(true);
        expect(result.forcedFalse).toBe(true);
        expect(result.score).toBe(0);
        expect(result.maxScore).toBe(2);
        expect(result.failureActions).toEqual(['触发补救']);
    });

    it('continues to later questions when decisive answer is true', () => {
        const questions: RuleQuestion[] = [
            makeQuestion('q1', { isDecisive: true, weight: 2 }),
            makeQuestion('q2', { weight: 1 }),
        ];
        const answers = { q1: true, q2: true };

        const result = evaluateDimensionQuestions(questions, answers);

        expect(result.visibleQuestions.map((q) => q.id)).toEqual(['q1', 'q2']);
        expect(result.requiredCount).toBe(2);
        expect(result.answeredCount).toBe(2);
        expect(result.isComplete).toBe(true);
        expect(result.forcedFalse).toBe(false);
        expect(result.score).toBe(3);
        expect(result.maxScore).toBe(3);
    });

    it('pauses at unanswered decisive question and hides following questions', () => {
        const questions: RuleQuestion[] = [
            makeQuestion('q1', { isDecisive: true, weight: 2 }),
            makeQuestion('q2', { weight: 1 }),
        ];
        const answers: Record<string, boolean> = {};

        const result = evaluateDimensionQuestions(questions, answers);

        expect(result.visibleQuestions.map((q) => q.id)).toEqual(['q1']);
        expect(result.requiredCount).toBe(1);
        expect(result.answeredCount).toBe(0);
        expect(result.isComplete).toBe(false);
        expect(result.forcedFalse).toBe(false);
        expect(result.maxScore).toBe(2);
    });

    it('collects failure actions only for H importance when answer is false', () => {
        const questions: RuleQuestion[] = [
            makeQuestion('q1', { failureAction: 'H-action', importance: 'H' }),
            makeQuestion('q2', { failureAction: 'M-action', importance: 'M' }),
            makeQuestion('q3', { failureAction: 'L-action', importance: 'L' }),
            makeQuestion('q4', { failureAction: '   ', importance: 'H' }),
        ];
        const answers = { q1: false, q2: false, q3: false, q4: false };

        const result = evaluateDimensionQuestions(questions, answers);

        expect(result.failureActions).toEqual(['H-action']);
    });

    it('collects failure actions in displayed dimension order', () => {
        const collectFailureActionsByDisplayOrder = (
            surveyEvaluationModule as {
                collectFailureActionsByDisplayOrder?: (
                    evaluations: Record<Dimension, { failureActions: string[] }>
                ) => string[];
            }
        ).collectFailureActionsByDisplayOrder;

        expect(collectFailureActionsByDisplayOrder).toBeDefined();
        if (!collectFailureActionsByDisplayOrder) return;

        expect(
            collectFailureActionsByDisplayOrder({
                philosophy: { failureActions: ['P-action'] },
                mechanism: { failureActions: ['M-action'] },
                team: { failureActions: ['T-action'] },
                tools: { failureActions: ['Tool-action-1', 'Tool-action-2'] },
            }),
        ).toEqual(['P-action', 'Tool-action-1', 'Tool-action-2', 'M-action', 'T-action']);
    });

    it('rounds decimal weights to integer before score calculation', () => {
        const questions: RuleQuestion[] = [
            makeQuestion('q1', { weight: 1.6 }),
            makeQuestion('q2', { weight: 1.4 }),
        ];
        const answers = { q1: true, q2: true };

        const result = evaluateDimensionQuestions(questions, answers);

        expect(result.score).toBe(3);
        expect(result.maxScore).toBe(3);
    });
});
