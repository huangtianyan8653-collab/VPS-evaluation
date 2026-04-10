import { describe, expect, it } from 'vitest';
import {
    getStrategyKey,
    isHigh,
    normalizeBooleanState,
    normalizeStrategyKey,
    toDimensionCode,
} from './algorithm';

describe('algorithm core rules', () => {
    it('uses score >= threshold as true', () => {
        expect(isHigh(2, 2)).toBe(true);
        expect(isHigh(1, 2)).toBe(false);
    });

    it('maps dimension boolean to J/P, T/F, E/I, S/N', () => {
        expect(toDimensionCode('philosophy', true)).toBe('J');
        expect(toDimensionCode('philosophy', false)).toBe('P');
        expect(toDimensionCode('mechanism', true)).toBe('T');
        expect(toDimensionCode('mechanism', false)).toBe('F');
        expect(toDimensionCode('team', true)).toBe('E');
        expect(toDimensionCode('team', false)).toBe('I');
        expect(toDimensionCode('tools', true)).toBe('S');
        expect(toDimensionCode('tools', false)).toBe('N');
    });

    it('builds strategy key in order: team, tools, mechanism, philosophy', () => {
        expect(getStrategyKey(true, true, true, true)).toBe('E,S,T,J');
        expect(getStrategyKey(false, false, false, false)).toBe('I,N,F,P');
        expect(getStrategyKey(true, false, true, false)).toBe('E,N,F,J');
    });

    it('normalizes modern strategy keys to canonical order', () => {
        expect(normalizeStrategyKey('E,S,T,J')).toBe('E,S,T,J');
        expect(normalizeStrategyKey('J,T,E,S')).toBe('E,S,T,J');
        expect(normalizeStrategyKey(' i , n , f , p ')).toBe('I,N,F,P');
    });

    it('normalizes legacy H/L strategy keys to canonical order', () => {
        // legacy order: philosophy, mechanism, team, tools
        // H,L,H,L => philosophy=H, mechanism=L, team=H, tools=L => E,N,F,J
        expect(normalizeStrategyKey('H,L,H,L')).toBe('E,N,F,J');
    });

    it('normalizes bool-like values used in historical states', () => {
        expect(normalizeBooleanState(true)).toBe(true);
        expect(normalizeBooleanState('H')).toBe(true);
        expect(normalizeBooleanState('true')).toBe(true);
        expect(normalizeBooleanState(1)).toBe(true);

        expect(normalizeBooleanState(false)).toBe(false);
        expect(normalizeBooleanState('L')).toBe(false);
        expect(normalizeBooleanState('false')).toBe(false);
        expect(normalizeBooleanState(0)).toBe(false);
    });
});
