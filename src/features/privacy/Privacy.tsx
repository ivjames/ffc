import { useEffect, useState } from 'react';
import { Screen, TopBar, Content } from '../../ui/components';
import { apiUrl } from '../../sync';

// Privacy notice — the plain-language player-facing disclosure of everything
// the app records, in one place.
//
// Keep this page honest: it is written from what the code actually does, and
// changes to data handling should land here in the same PR. The load-bearing
// disclosures are (1) hunt photos are stored on the venue's server, sent to
// a third-party AI service (Anthropic) for verification/moderation, and
// viewable by venue staff in their review tool, and (2) how long photos
// live. The retention period is read LIVE from the server
// (GET /api/hunt/photo-retention) so this page can never promise a number
// the venue's HUNT_PHOTO_RETENTION_DAYS configuration contradicts —
// including the sweep-disabled case; offline/unreachable falls back to
// wording that promises nothing specific.

/** The retention sentence, always true for the venue's actual config:
 *  days > 0 (known)  -> "deleted after N days"
 *  days <= 0 (known) -> sweep disabled -> "kept until deleted on request"
 *  null (unknown)    -> no fetched config -> promise nothing specific. */
function retentionSentence(days: number | null): string {
  if (days == null) {
    return 'Stored photos are automatically deleted after this venue’s retention period (30 days unless the venue configures otherwise).';
  }
  if (days <= 0) {
    return 'This venue keeps stored photos until they are deleted — ask a staff member to remove yours at any time.';
  }
  return `Stored photos are automatically deleted after ${days === 1 ? '1 day' : `${days} days`}.`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fairway-400">
        {title}
      </h2>
      <div className="space-y-3 text-fairway-100/90">{children}</div>
    </section>
  );
}

export default function Privacy() {
  // null = unknown (offline or fetch failed) — retentionSentence words that
  // case without promising a specific number.
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/api/hunt/photo-retention'))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.days === 'number') setRetentionDays(data.days);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Screen>
      <TopBar title="Your info" back="/" />
      <Content>
        <p className="mb-8 text-fairway-100/90">
          This app is built to need as little of your information as possible. Here&apos;s
          everything it records, in plain language.
        </p>

        <Section title="Playing a round">
          <p>
            Scorecards use 3-letter arcade tags (like <span className="font-arcade">ACE</span>), not
            names. Scores, tags, and finish times are saved so the leaderboards work — none of it is
            linked to you personally unless you sign in.
          </p>
        </Section>

        <Section title="If you create an account">
          <p>
            Accounts are optional — you can play, score, and appear on leaderboards without one. If
            you sign in, we store your email address (that&apos;s the account), and optionally a
            display name and default tag. Email is used only for sign-in codes and team invites.
            Teammates on a shared team can see each other&apos;s email addresses.
          </p>
        </Section>

        <Section title="Scavenger-hunt photos">
          <p>
            When you snap a photo for the hunt, it is sent to an AI image service (Anthropic&apos;s
            Claude) to check whether the item is in the shot and that the photo is family-friendly.
            Verified photos are stored on the venue&apos;s own server so your group can view and
            share them; rejected photos are never stored.
          </p>
          <p>
            {retentionSentence(retentionDays)} In the app, only your group (via your round) can see
            your photos — there is no public gallery. Venue staff can also view stored photos in a
            private review tool; that&apos;s how they moderate content and how they delete a photo
            the moment you ask. If you&apos;d like a photo removed, ask any staff member and
            they&apos;ll do it on the spot.
          </p>
        </Section>

        <Section title="What we don't do">
          <ul className="list-disc space-y-2 pl-5">
            <li>No ads, no analytics, no tracking pixels, no third-party trackers.</li>
            <li>No selling or sharing your information with anyone.</li>
            <li>
              No location tracking — &quot;which venue am I at?&quot; is worked out on your phone
              and your GPS position never leaves it.
            </li>
            <li>No IP address logs or browsing history on our server.</li>
          </ul>
        </Section>

        <Section title="Questions">
          <p>
            Talk to any staff member at the venue — they can delete photos immediately and pass
            account-removal requests to the operator.
          </p>
        </Section>
      </Content>
    </Screen>
  );
}
