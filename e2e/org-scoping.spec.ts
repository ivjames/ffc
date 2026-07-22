// Replicates the manual verification that org_admin's restricted actions
// stay hidden in a real browser against the real server (not a mocked
// api.ts) — the same two-role check done by hand when the RBAC UI work
// landed.
import { test, expect, type Page } from '@playwright/test';
import { E2E_SUPER_ADMIN, E2E_ORG_ADMIN, E2E_ORG_NAME } from './global-setup';
import { testQuery } from '../server/test-support/testDb.js';

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByText('Log in with email and password instead').click();
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText('FFC · Master Control')).toBeVisible();
}

test('super_admin sees the Create-org form and an org-detail Archive button', async ({ page }) => {
  await loginAs(page, E2E_SUPER_ADMIN.email, E2E_SUPER_ADMIN.password);

  await page.getByRole('link', { name: 'Orgs' }).click();
  await expect(page.getByRole('heading', { name: 'New org (owner / franchise)' })).toBeVisible();

  await page.getByText(E2E_ORG_NAME).click();
  await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible();
});

test('org_admin does not see super_admin-only controls', async ({ page }) => {
  await loginAs(page, E2E_ORG_ADMIN.email, E2E_ORG_ADMIN.password);
  await expect(page.getByText(/org admin/)).toBeVisible();

  await page.getByRole('link', { name: 'Orgs' }).click();
  await expect(page.getByRole('heading', { name: 'New org (owner / franchise)' })).not.toBeVisible();
  await expect(page.getByText('Only a super admin can create or rename orgs.')).toBeVisible();

  await page.getByText(E2E_ORG_NAME).click();
  await expect(page.getByRole('button', { name: 'Archive' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: '+ Location' })).toBeVisible();

  // Scoped to the nav bar — the org-detail page above also has its own
  // "+ Location" link (pre-scoped to that org), which would otherwise match too.
  await page.getByRole('navigation').getByRole('link', { name: '+ Location' }).click();
  await expect(page.locator('select')).toHaveCount(0);
  await expect(page.getByText(E2E_ORG_NAME)).toBeVisible();
});

test('org_admin can still create, then archive/unarchive, their own location end to end', async ({
  page,
}) => {
  const venueName = `E2E Org Admin Venue ${Date.now()}`;
  await loginAs(page, E2E_ORG_ADMIN.email, E2E_ORG_ADMIN.password);

  await page.getByRole('navigation').getByRole('link', { name: '+ Location' }).click();
  // A raw, case-sensitive CSS attribute selector, not getByPlaceholder/getByLabel
  // — the Slug field's placeholder is also "riverside" (lowercase) when Name is
  // empty, and Playwright's text-based locators match case-insensitively by
  // default, so both fuzzy approaches matched both fields.
  await page.locator('input[placeholder="Riverside"]').fill(venueName);
  await page.getByRole('button', { name: 'Create location' }).click();
  await expect(page.getByText(`Saved ${venueName}.`)).toBeVisible();

  await page.getByRole('link', { name: 'Add courses →' }).click();
  await expect(page.getByRole('heading', { name: venueName })).toBeVisible();
  await page.getByRole('button', { name: 'Archive location' }).click();
  await expect(page.getByRole('button', { name: 'Unarchive location' })).toBeVisible();

  try {
    const rows = await testQuery(`select id from location where name = $1`, [venueName]);
    expect(rows.rowCount).toBe(1);
  } finally {
    await testQuery(`delete from location where name = $1`, [venueName]);
  }
});
