import { Screen, TopBar, Content } from '../../ui/components';
import { Link } from 'react-router-dom';

// The app's attribution notices, and the one place they are written down.
//
// This is not decoration. The live-trivia question bank is loaded from
// OpenTriviaQA (server/importTriviaPack.js), which is CC BY-SA 4.0, and that
// licence makes attribution a condition of use — not of redistribution.
// "Share" is defined to include public display and public performance, so a
// venue putting these questions on a screen on a Tuesday night is Sharing
// them, even though nobody ever hands out the database.
//
// What saves this from being a credit line under every question is §3(a)(2):
// the conditions may be satisfied "in any reasonable manner based on the
// medium... For example, it may be reasonable to satisfy the conditions by
// providing a URI or hyperlink to a resource that includes the required
// information." This page is that resource. <QuestionCredit /> is the link.
//
// Keep the two together in this file: a credit line pointing at a page that
// has drifted away from what it claims is worse than no credit line.

const OPENTRIVIAQA = 'https://github.com/uberspot/OpenTriviaQA';
const CC_BY_SA_4 = 'https://creativecommons.org/licenses/by-sa/4.0/';

/**
 * The footer credit on any screen that deals questions from the platform pack.
 *
 * Shown on the live-trivia screens (TriviaLive, TriviaHost) and NOT on the
 * single-player game at /arcade/trivia, which deals the house's own bundled
 * deck (src/data/funContent.ts) and owes nobody anything.
 *
 * It is unconditional on those screens rather than driven by the questions
 * actually dealt: the dealt payload carries no `source` (see lib/triviaDeal.js),
 * and a credit that blinks in and out as the pack's questions come up would be
 * both uglier and less reliable than one that simply stays put.
 */
export function QuestionCredit() {
  return (
    <p className="mt-6 text-center text-[11px] leading-relaxed text-fairway-100/60">
      Some questions from OpenTriviaQA, CC BY-SA 4.0.{' '}
      <Link to="/credits" className="underline underline-offset-2 hover:text-fairway-100/90">
        Credits
      </Link>
    </p>
  );
}

export default function Credits() {
  return (
    <Screen>
      <TopBar title="Credits" back="/" />
      <Content>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fairway-400">
          Trivia questions
        </h2>
        <div className="space-y-3 text-sm leading-relaxed text-fairway-100/80">
          <p>
            Questions for live trivia come from{' '}
            <Ext href={OPENTRIVIAQA}>OpenTriviaQA</Ext>, a community-written
            collection of trivia questions, licensed under{' '}
            <Ext href={CC_BY_SA_4}>Creative Commons Attribution-ShareAlike 4.0 International</Ext>{' '}
            (CC BY-SA 4.0).
          </p>
          {/* Section 3(a)(1)(B) — indicating modification is not optional, and
              it is the element that gets forgotten. Say what was changed. */}
          <p>
            The questions have been <strong className="text-fairway-50">modified</strong>: filtered
            for content and length, repaired for text encoding and missing apostrophes, and their
            answer options reordered. Questions written by this venue are its own and are not part
            of that collection.
          </p>
          <p className="text-fairway-100/60">
            The collection is provided without warranties. Our adapted copy of it is available
            under the same CC BY-SA 4.0 licence.
          </p>
        </div>

        <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-fairway-400">
          Icons
        </h2>
        <div className="space-y-3 text-sm leading-relaxed text-fairway-100/80">
          <p>
            Some icons are from <Ext href="https://lucide.dev">Lucide</Ext> (ISC licence) —
            copyright for portions is held by Lucide Contributors 2022, and for portions of
            Feather by Cole Bemis 2013–2022 — and from{' '}
            <Ext href="https://phosphoricons.com">Phosphor Icons</Ext> (MIT licence), copyright ©
            2023 Phosphor Icons. The rest were drawn for this app.
          </p>
        </div>
      </Content>
    </Screen>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-fairway-300 underline underline-offset-2"
    >
      {children}
    </a>
  );
}
