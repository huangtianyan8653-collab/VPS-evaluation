import { expect, test, type Page } from '@playwright/test';

type PersistedState = {
    drafts: Record<string, unknown>;
    results: Record<string, unknown>;
    publishedQuestions: null;
    employeeSession: {
        employeeName: string;
        employeeId: string;
        hospitals: Array<{
            hospitalCode: string;
            hospitalName: string;
            province: string;
            sg: string;
            rm: string;
            dm: string;
            mics: string;
        }>;
        loggedInAt: number;
    } | null;
    adminSession: {
        employeeName: string;
        employeeId: string;
        role: string;
        permissions: {
            dashboard: boolean;
            dataManage: boolean;
            questions: boolean;
            strategies: boolean;
            employeeAuth: boolean;
        };
        loggedInAt: number;
    } | null;
};

const BASE_STATE: PersistedState = {
    drafts: {},
    results: {},
    publishedQuestions: null,
    employeeSession: null,
    adminSession: null,
};

const EMPLOYEE_SESSION: NonNullable<PersistedState['employeeSession']> = {
    employeeName: '自动化测试员',
    employeeId: 'AUTO_U001',
    hospitals: [
        {
            hospitalCode: 'AUTO001',
            hospitalName: '自动化医院A',
            province: '广东',
            sg: 'SG_A',
            rm: 'RM_A',
            dm: 'DM_A',
            mics: 'MICS_A',
        },
        {
            hospitalCode: 'AUTO002',
            hospitalName: '自动化医院B',
            province: '广东',
            sg: 'SG_A',
            rm: 'RM_A',
            dm: 'DM_A',
            mics: 'MICS_A',
        },
    ],
    loggedInAt: 1_710_000_000_000,
};

const SEEDED_RESULT = {
    scores: { philosophy: 2, mechanism: 1, team: 1, tools: 1 },
    maxScores: { philosophy: 2, mechanism: 2, team: 2, tools: 2 },
    states: { philosophy: true, mechanism: true, team: true, tools: true },
    strategyKey: 'E,S,T,J',
    strategyType: '总经理',
    strategyText: '分享优秀经验，孵化更多的标杆医院。',
    ruleVersionId: 'rv-test',
    cloudRecordId: 'record-1',
    cloudCreatedAt: '2026-04-01T10:00:00.000Z',
    cloudSynced: true,
    failureActions: ['建议动作A'],
    timestamp: 1_710_000_100_000,
};

const VIEWER_ADMIN_SESSION: NonNullable<PersistedState['adminSession']> = {
    employeeName: '只读管理员',
    employeeId: 'ADMIN_VIEWER',
    role: 'viewer',
    permissions: {
        dashboard: true,
        dataManage: false,
        questions: false,
        strategies: false,
        employeeAuth: false,
    },
    loggedInAt: 1_710_000_000_000,
};

const EMPLOYEE_AUTH_ADMIN_SESSION: NonNullable<PersistedState['adminSession']> = {
    employeeName: '员工库管理员',
    employeeId: 'ADMIN_EMPLOYEE',
    role: 'editor',
    permissions: {
        dashboard: true,
        dataManage: false,
        questions: false,
        strategies: false,
        employeeAuth: true,
    },
    loggedInAt: 1_710_000_000_000,
};

async function seedStore(page: Page, partial: Partial<PersistedState>) {
    await page.addInitScript((nextState) => {
        const state = {
            drafts: {},
            results: {},
            publishedQuestions: null,
            employeeSession: null,
            adminSession: null,
            ...nextState,
        };
        localStorage.setItem('vps-survey-storage', JSON.stringify({ state, version: 0 }));
    }, { ...BASE_STATE, ...partial });
}

test.describe('VPS regression checks', () => {
    test.beforeEach(async ({ context, page }) => {
        await context.clearCookies();
        await context.route('**://*.supabase.co/**', (route) =>
            route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'e2e mocked offline' }),
            })
        );
        await page.addInitScript(() => {
            window.localStorage.clear();
            window.sessionStorage.clear();
        });
    });

    test('select page shows completed/pending split and actions', async ({ page }) => {
        await seedStore(page, {
            employeeSession: EMPLOYEE_SESSION,
            results: {
                AUTO001: SEEDED_RESULT,
            },
        });

        await page.goto('/select');

        await expect(page.getByRole('heading', { name: 'VPSBTI医院分型测试' })).toBeVisible();
        await expect(page.getByText('自动化医院A')).toBeVisible();
        await expect(page.getByText('自动化医院B')).toBeVisible();
        await expect(page.getByRole('button', { name: '回顾' })).toBeVisible();
        await expect(page.getByRole('button', { name: '更新' })).toBeVisible();
        await expect(page.getByRole('button', { name: '开始' })).toBeVisible();

        await page.getByRole('button', { name: '已完成 (1)' }).click();
        await expect(page.getByText('已完成医院 (1)')).toBeVisible();

        await page.getByRole('button', { name: '未填写 (1)' }).click();
        await expect(page.getByText('待分型测试医院 (1)')).toBeVisible();
    });

    test('survey page blocks hospital without permission', async ({ page }) => {
        await seedStore(page, {
            employeeSession: {
                ...EMPLOYEE_SESSION,
                hospitals: [EMPLOYEE_SESSION.hospitals[0]],
            },
        });

        await page.goto('/survey/AUTO002');
        await expect(page.getByRole('heading', { name: '无访问权限' })).toBeVisible();
        await expect(page.getByRole('button', { name: '返回医院列表' })).toBeVisible();
    });

    test('survey page supports dimension progression', async ({ page }) => {
        await seedStore(page, {
            employeeSession: EMPLOYEE_SESSION,
        });

        await page.goto('/survey/AUTO001');
        await expect(page.getByRole('heading', { name: '科学理念 要素诊断' })).toBeVisible();

        await page.getByRole('button', { name: '是 (Yes)' }).first().click();
        await page.getByRole('button', { name: '继续下一项' }).click();

        await expect(page.getByRole('heading', { name: '信息化工具 要素诊断' })).toBeVisible();
    });

    test('result page renders seeded MBTI summary', async ({ page }) => {
        await seedStore(page, {
            employeeSession: EMPLOYEE_SESSION,
            results: {
                AUTO001: SEEDED_RESULT,
            },
        });

        await page.goto('/result/AUTO001');
        await expect(page.getByText('本次分型结论')).toBeVisible();
        await expect(page.getByText('总经理')).toBeVisible();
        await expect(page.getByText('ESTJ')).toBeVisible();
        await expect(page.getByText('建议方向')).toBeVisible();
        await expect(page.getByRole('button', { name: '返回我的医院列表' })).toBeVisible();
    });

    test('admin permissions route is guarded for non-super-admin', async ({ page }) => {
        await seedStore(page, {
            adminSession: VIEWER_ADMIN_SESSION,
        });

        await page.goto('/admin/permissions');

        await expect(page).toHaveURL(/\/admin\/dashboard$/);
        await expect(page.getByText('数据中心看板')).toBeVisible();
        await expect(page.getByRole('link', { name: '权限管理' })).toHaveCount(0);
    });

    test('admin employee access page is visible when permission exists', async ({ page }) => {
        await seedStore(page, {
            adminSession: EMPLOYEE_AUTH_ADMIN_SESSION,
        });

        await page.goto('/admin/employee-access');

        await expect(page).toHaveURL(/\/admin\/employee-access$/);
        await expect(page.getByRole('heading', { name: '员工登录库管理（双文件上传）' })).toBeVisible();
    });
});
