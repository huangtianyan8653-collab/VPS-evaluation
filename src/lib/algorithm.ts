import type { Dimension } from './constants';

export type DimensionStatesBoolean = Record<Dimension, boolean>;

/**
 * 维度是否达标
 * 规则：score >= threshold => true，否则 false
 */
export function isHigh(score: number, threshold: number): boolean {
    return score >= threshold;
}

/**
 * 将布尔维度状态转换为分型键（H/L）
 */
export function getStrategyKey(philosophy: boolean, mechanism: boolean, team: boolean, tools: boolean): string {
    return `${toStateLabel(philosophy)},${toStateLabel(mechanism)},${toStateLabel(team)},${toStateLabel(tools)}`;
}

export function getStrategyKeyFromStates(states: DimensionStatesBoolean): string {
    return getStrategyKey(states.philosophy, states.mechanism, states.team, states.tools);
}

export function toStateLabel(value: boolean): 'H' | 'L' {
    return value ? 'H' : 'L';
}

/**
 * 兼容历史数据中可能出现的 'H'/'L'、1/0、'true'/'false'
 */
export function normalizeBooleanState(value: unknown): boolean {
    if (value === true || value === 'H' || value === 'h' || value === 'true' || value === 1 || value === '1') {
        return true;
    }
    if (value === false || value === 'L' || value === 'l' || value === 'false' || value === 0 || value === '0') {
        return false;
    }
    return false;
}
