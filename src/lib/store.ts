import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Dimension, Question } from './constants';

interface SurveyDraft {
    answers: Record<string, boolean>; // questionId -> yes/no
    timestamp: number;
}

export interface AuthorizedHospital {
    hospitalCode: string;
    hospitalName: string;
    province?: string;
    sg: string;
    rm: string;
    dm: string;
    mics: string;
}

export interface EmployeeSession {
    employeeName: string;
    employeeId: string;
    hospitals: AuthorizedHospital[];
    loggedInAt: number;
}

export interface AdminPermissions {
    dashboard: boolean;
    dataManage: boolean;
    questions: boolean;
    strategies: boolean;
    employeeAuth: boolean;
}

export interface AdminSession {
    employeeName: string;
    employeeId: string;
    role: string;
    permissions: AdminPermissions;
    loggedInAt: number;
}

export interface ResultData {
    scores: Record<Dimension, number>;
    maxScores?: Record<Dimension, number>;
    states: Record<Dimension, boolean>;
    strategyKey: string;
    strategyType?: string;
    strategyText?: string;
    ruleVersionId?: string | null;
    cloudRecordId?: string | null;
    cloudCreatedAt?: string | null;
    cloudSynced?: boolean;
    failureActions: string[];
    timestamp: number;
}

interface AppState {
    drafts: Record<string, SurveyDraft>; // hospitalId -> draft
    results: Record<string, ResultData>; // hospitalId -> result
    publishedQuestions: Question[] | null; // 后台题库草稿（跨页面联动）；null=无草稿
    employeeSession: EmployeeSession | null;
    adminSession: AdminSession | null;
    saveDraft: (hospitalId: string, answers: Record<string, boolean>) => void;
    saveResult: (hospitalId: string, result: ResultData) => void;
    clearDraft: (hospitalId: string) => void;
    publishQuestions: (questions: Question[] | null) => void;
    saveEmployeeSession: (session: EmployeeSession) => void;
    clearEmployeeSession: () => void;
    saveAdminSession: (session: AdminSession) => void;
    clearAdminSession: () => void;
    clearResults: () => void;
    clearDrafts: () => void;
}

export const useAppStore = create<AppState>()(
    persist(
        (set) => ({
            drafts: {},
            results: {},
            publishedQuestions: null,
            employeeSession: null,
            adminSession: null,
            saveDraft: (hospitalId, answers) =>
                set((state) => ({ drafts: { ...state.drafts, [hospitalId]: { answers, timestamp: Date.now() } } })),
            saveResult: (hospitalId, result) =>
                set((state) => ({ results: { ...state.results, [hospitalId]: result } })),
            clearDraft: (hospitalId) =>
                set((state) => {
                    const newDrafts = { ...state.drafts };
                    delete newDrafts[hospitalId];
                    return { drafts: newDrafts };
                }),
            publishQuestions: (questions) =>
                set({ publishedQuestions: questions }),
            saveEmployeeSession: (session) =>
                set({ employeeSession: session }),
            clearEmployeeSession: () =>
                set({ employeeSession: null }),
            saveAdminSession: (session) =>
                set({ adminSession: session, publishedQuestions: null }),
            clearAdminSession: () =>
                set({ adminSession: null, publishedQuestions: null }),
            clearResults: () =>
                set({ results: {} }),
            clearDrafts: () =>
                set({ drafts: {} }),
        }),
        {
            name: 'vps-survey-storage',
        }
    )
);
