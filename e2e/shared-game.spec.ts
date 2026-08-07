// Two-device shared scorecard: phone A (signed-in host) creates a game, phone
// B (guest) joins by code, both mark the same card, scores propagate live over
// SSE, and offline edits reconcile on reconnect. Auth UI is covered by
// server/routes/auth.integration.test.js — here the host's session is seeded
// straight into the DB so the spec exercises the shared-game flow, not OTP
// entry.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { testQuery } from '../server/test-support/testDb.js';

const PLAYER_APP = 'http://localhost:5173';
const COURSE_ID = 'a1111111-1111-4111-8111-111111111111'; // seeded Upland Blue
const HOST_EMAIL = 'e2e-shared-host@example.com';

let hostUserId: string;
let hostSession: string;

test.beforeAll(async () => {
  await testQuery(`delete from app_user where email = $1`, [HOST_EMAIL]);
  const user = await testQuery(
    `insert into app_user (email, email_verified_at, display_name, default_tag)
       values ($1, now(), 'E2E Host', 'HST') returning id`,
    [HOST_EMAIL]
  );
  hostUserId = user.rows[0].id;
  hostSession = randomBytes(32).toString('hex');
  await testQuery(
    `insert into user_session (id, app_user_id, expires_at) values ($1, $2, now() + interval '1 day')`,
    [hostSession, hostUserId]
  );
});

test.afterAll(async () => {
  const rounds = await testQuery(
    `select round_id from shared_game where created_by = $1 and round_id is not null`,
    [hostUserId]
  );
  await testQuery(`delete from shared_game where created_by = $1`, [hostUserId]);
  await testQuery(`delete from round where id = any($1)`, [rounds.rows.map((r) => r.round_id)]);
  await testQuery(`delete from app_user where email = $1`, [HOST_EMAIL]); // cascades sessions
});

async function strokes(page: Page, tag: string) {
  return page.getByRole('status', { name: `Strokes for ${tag}` });
}

test('two phones mark the same scorecard live, and offline edits reconcile', async ({
  browser,
}) => {
  // --- Phone A: signed-in host creates the game -----------------------------
  const contextA: BrowserContext = await browser.newContext();
  await contextA.addCookies([
    { name: 'ffc_session', value: hostSession, url: PLAYER_APP },
  ]);
  const phoneA = await contextA.newPage();
  await phoneA.goto(`${PLAYER_APP}/new/setup?courseId=${COURSE_ID}`);
  await phoneA.getByLabel('Player 1 tag').fill('AAA');
  await phoneA.getByRole('button', { name: /Play together/ }).click();

  // Lobby shows the join code.
  await expect(phoneA).toHaveURL(/\/games\/.+\/lobby/);
  const joinCode = (await phoneA.getByTestId('join-code').textContent())?.trim() ?? '';
  expect(joinCode).toMatch(/^[0-9A-Z]{6}$/);

  // --- Phone B: guest joins by code ----------------------------------------
  const contextB: BrowserContext = await browser.newContext();
  const phoneB = await contextB.newPage();
  await phoneB.goto(`${PLAYER_APP}/join?code=${joinCode}`);
  await phoneB.getByLabel('Your player tag').fill('BBB');
  await phoneB.getByRole('button', { name: 'Join game' }).click();
  await expect(phoneB).toHaveURL(/\/play\/shared:/);

  // Host's lobby roster picks up the joiner live, then play starts.
  await expect(phoneA.getByText('BBB')).toBeVisible({ timeout: 10_000 });
  await phoneA.getByRole('button', { name: 'Start playing' }).click();
  await expect(phoneA).toHaveURL(/\/play\/shared:/);

  // --- Live propagation -----------------------------------------------------
  // A scores for AAA; B sees it.
  await phoneA.getByRole('button', { name: 'Increase strokes for AAA' }).click();
  await expect(await strokes(phoneB, 'AAA')).toHaveText('1', { timeout: 10_000 });

  // B scores for BBB twice; A sees 2.
  await phoneB.getByRole('button', { name: 'Increase strokes for BBB' }).click();
  await phoneB.getByRole('button', { name: 'Increase strokes for BBB' }).click();
  await expect(await strokes(phoneA, 'BBB')).toHaveText('2', { timeout: 10_000 });

  // --- Offline reconcile ----------------------------------------------------
  // B drops offline, keeps scoring (AAA 1 -> 3), then reconnects; A converges.
  await contextB.setOffline(true);
  await phoneB.getByRole('button', { name: 'Increase strokes for AAA' }).click();
  await phoneB.getByRole('button', { name: 'Increase strokes for AAA' }).click();
  await expect(await strokes(phoneB, 'AAA')).toHaveText('3'); // local while offline
  await expect(await strokes(phoneA, 'AAA')).toHaveText('1'); // not delivered yet
  await contextB.setOffline(false);
  await expect(await strokes(phoneA, 'AAA')).toHaveText('3', { timeout: 15_000 });

  await contextA.close();
  await contextB.close();
});
