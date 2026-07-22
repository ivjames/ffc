// Seeds the fixed accounts/org e2e specs log in as. Runs once before the
// whole e2e run (see playwright.config.ts's globalSetup), against the same
// TEST_DATABASE_URL the webServer-launched API points at.
import { ensureSchema, testQuery } from '../server/test-support/testDb.js';
import { hashPassword } from '../server/lib/adminPasswords.js';

export const E2E_SUPER_ADMIN = { email: 'e2e-super-admin@example.com', password: 'e2e-super-pw-1' };
export const E2E_ORG_ADMIN = { email: 'e2e-org-admin@example.com', password: 'e2e-org-admin-pw-1' };
export const E2E_ORG_NAME = 'E2E Test Org';
export const E2E_ORG_SLUG = 'e2e-test-org';

export default async function globalSetup() {
  await ensureSchema();

  // Idempotent: clear out any leftovers from a prior interrupted run before
  // reseeding, rather than assuming a clean slate.
  await testQuery(`delete from admin_user where email in ($1, $2)`, [
    E2E_SUPER_ADMIN.email,
    E2E_ORG_ADMIN.email,
  ]);
  await testQuery(`delete from org where slug = $1`, [E2E_ORG_SLUG]);

  const org = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    E2E_ORG_NAME,
    E2E_ORG_SLUG,
  ]);
  const orgId = org.rows[0].id;

  await testQuery(
    `insert into admin_user (email, role, password_hash) values ($1, 'super_admin', $2)`,
    [E2E_SUPER_ADMIN.email, hashPassword(E2E_SUPER_ADMIN.password)]
  );
  await testQuery(
    `insert into admin_user (email, role, org_id, password_hash) values ($1, 'org_admin', $2, $3)`,
    [E2E_ORG_ADMIN.email, orgId, hashPassword(E2E_ORG_ADMIN.password)]
  );
}
