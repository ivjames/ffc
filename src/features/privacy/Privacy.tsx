import { Screen, TopBar, Content } from '../../ui/components';

// Privacy notice — the plain-language player-facing disclosure of everything
// the app records, in one place. Static bundled content, works offline.
//
// Keep this page honest: it is written from what the code actually does, and
// changes to data handling should land here in the same PR. The load-bearing
// disclosures are (1) hunt photos are stored on the venue's server and sent
// to a third-party AI service (Anthropic) for verification/moderation, and
// (2) how long photos live (server HUNT_PHOTO_RETENTION_DAYS, default 30 —
// keep the wording in step if that changes).

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
            Stored photos are automatically deleted after about 30 days. Only your group (via your
            round) can see your photos — there is no public gallery. If you&apos;d like a photo
            removed sooner, ask a staff member and they can delete it on the spot.
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
