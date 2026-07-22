// Removes the accounts/org global-setup.ts seeded. Specs that create their
// own fixtures (a location, a course) are responsible for deleting those
// themselves — this only removes what setup put in, so a location left behind
// by a failing spec doesn't turn into an FK error deleting the org here.
import { testQuery } from '../server/test-support/testDb.js';
import { E2E_SUPER_ADMIN, E2E_ORG_ADMIN, E2E_ORG_SLUG } from './global-setup.js';

export default async function globalTeardown() {
  await testQuery(`delete from admin_user where email in ($1, $2)`, [
    E2E_SUPER_ADMIN.email,
    E2E_ORG_ADMIN.email,
  ]);
  await testQuery(`delete from org where slug = $1`, [E2E_ORG_SLUG]);
}
