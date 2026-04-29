import { expect, test } from '@playwright/test';

test.describe('VPS smoke checks', () => {
    test.beforeEach(async ({ page }) => {
        await page.context().clearCookies();
        await page.addInitScript(() => {
            window.localStorage.clear();
            window.sessionStorage.clear();
        });
    });

    test('frontend auth page renders key elements', async ({ page }) => {
        await page.goto('/auth');

        await expect(page.getByRole('heading', { name: 'VPSBTI医院分型测试' })).toBeVisible();
        await expect(page.getByText('姓名', { exact: true })).toBeVisible();
        await expect(page.getByText('员工号', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '开启测试' })).toBeVisible();
    });

    test('admin login page renders key elements', async ({ page }) => {
        await page.goto('/admin/login');

        await expect(page.getByRole('heading', { name: '后台管理员登录' })).toBeVisible();
        await expect(page.getByText('员工姓名', { exact: true })).toBeVisible();
        await expect(page.getByText('员工号', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '进入后台' })).toBeVisible();
    });

    test('protected routes redirect without session', async ({ page }) => {
        await page.goto('/select');
        await expect(page).toHaveURL(/\/auth$/);

        await page.goto('/admin/dashboard');
        await expect(page).toHaveURL(/\/admin\/login$/);
    });
});
