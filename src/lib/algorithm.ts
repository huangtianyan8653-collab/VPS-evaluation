import type { Dimension } from './constants';

export type DimensionStatesBoolean = Record<Dimension, boolean>;

const HIGH_LOW_CODE_MAP: Record<Dimension, { high: string; low: string }> = {
    philosophy: { high: 'J', low: 'P' },
    mechanism: { high: 'T', low: 'F' },
    team: { high: 'E', low: 'I' },
    tools: { high: 'S', low: 'N' },
};

const STRATEGY_DIMENSION_ORDER: Dimension[] = ['team', 'tools', 'mechanism', 'philosophy'];
const LEGACY_STRATEGY_DIMENSION_ORDER: Dimension[] = ['philosophy', 'mechanism', 'team', 'tools'];

const LEGACY_CODE_MAP: Record<Dimension, { high: string; low: string }> = {
    philosophy: { high: 'H', low: 'L' },
    mechanism: { high: 'H', low: 'L' },
    team: { high: 'H', low: 'L' },
    tools: { high: 'H', low: 'L' },
};

/**
 * 维度是否达标
 * 规则：score >= threshold => true，否则 false
 */
export function isHigh(score: number, threshold: number): boolean {
    return score >= threshold;
}

/**
 * 将布尔维度状态转换为分型键（团队E/I、工具S/N、机制T/F、理念J/P）
 */
export function getStrategyKey(philosophy: boolean, mechanism: boolean, team: boolean, tools: boolean): string {
    const states: DimensionStatesBoolean = { philosophy, mechanism, team, tools };
    return STRATEGY_DIMENSION_ORDER.map((dimension) => toDimensionCode(dimension, states[dimension])).join(',');
}

export function getStrategyKeyFromStates(states: DimensionStatesBoolean): string {
    return getStrategyKey(states.philosophy, states.mechanism, states.team, states.tools);
}

export function toStateLabel(value: boolean): 'H' | 'L' {
    return value ? 'H' : 'L';
}

export function toDimensionCode(dimension: Dimension, value: boolean): string {
    const map = HIGH_LOW_CODE_MAP[dimension];
    return value ? map.high : map.low;
}

export function normalizeStrategyKey(value: unknown): string {
    if (typeof value !== 'string') return '';
    const parts = value
        .split(',')
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean);

    if (parts.length !== 4) return '';

    const modernStates: Partial<DimensionStatesBoolean> = {};
    const applyModernCode = (code: string) => {
        switch (code) {
            case 'J':
                modernStates.philosophy = true;
                return true;
            case 'P':
                modernStates.philosophy = false;
                return true;
            case 'T':
                modernStates.mechanism = true;
                return true;
            case 'F':
                modernStates.mechanism = false;
                return true;
            case 'E':
                modernStates.team = true;
                return true;
            case 'I':
                modernStates.team = false;
                return true;
            case 'S':
                modernStates.tools = true;
                return true;
            case 'N':
                modernStates.tools = false;
                return true;
            default:
                return false;
        }
    };

    const isAllModernCode = parts.every((code) => applyModernCode(code));
    if (
        isAllModernCode
        && typeof modernStates.philosophy === 'boolean'
        && typeof modernStates.mechanism === 'boolean'
        && typeof modernStates.team === 'boolean'
        && typeof modernStates.tools === 'boolean'
    ) {
        return getStrategyKeyFromStates(modernStates as DimensionStatesBoolean);
    }

    const isLegacyHLLetters = parts.every((code) => code === 'H' || code === 'L');
    if (!isLegacyHLLetters) return '';

    const states: DimensionStatesBoolean = {
        philosophy: false,
        mechanism: false,
        team: false,
        tools: false,
    };
    LEGACY_STRATEGY_DIMENSION_ORDER.forEach((dimension, index) => {
        const legacyCode = parts[index];
        const legacyMap = LEGACY_CODE_MAP[dimension];
        states[dimension] = legacyCode === legacyMap.high;
    });
    return getStrategyKeyFromStates(states);
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
