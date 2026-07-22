// Replicates the manual verification from the RBAC login-wiring session:
// gate -> wrong password shows the real message -> correct password logs in
// -> reload keeps the session -> lock -> reload stays locked.
import { test, expect } from '@playwright/test';
import { E2E_SUPER_ADMIN } from './global-setup';

test('gate -> login -> session persists across reload -> lock -> stays locked', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Enter the admin token to continue.')).toBeVisible();

  await page.getByText('Log in with email and password instead').click();
  await page.getByPlaceholder('you@example.com').fill(E2E_SUPER_ADMIN.email);
  await page.getByPlaceholder('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText('invalid email or password')).toBeVisible();

  await page.getByPlaceholder('Password').fill(E2E_SUPER_ADMIN.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText('FFC · Master Control')).toBeVisible();
  await expect(page.getByText(E2E_SUPER_ADMIN.email)).toBeVisible();

  await page.reload();
  await expect(page.getByText(E2E_SUPER_ADMIN.email)).toBeVisible();

  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByText('Enter the admin token to continue.')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Enter the admin token to continue.')).toBeVisible();
});

test('an unknown email gets the same message as a wrong password (no user enumeration)', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByText('Log in with email and password instead').click();

  await page.getByPlaceholder('you@example.com').fill('nobody@example.com');
  await page.getByPlaceholder('Password').fill('whatever');
  await page.getByRole('button', { name: 'Log in' }).click();
  const unknownEmailMessage = await page.getByText('invalid email or password').textContent();

  await page.reload();
  await page.getByText('Log in with email and password instead').click();
  await page.getByPlaceholder('you@example.com').fill(E2E_SUPER_ADMIN.email);
  await page.getByPlaceholder('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  const wrongPasswordMessage = await page.getByText('invalid email or password').textContent();

  expect(unknownEmailMessage).toBe(wrongPasswordMessage);
});
