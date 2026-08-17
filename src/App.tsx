import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Home from './features/home/Home';
import GolfHome from './features/golf/GolfHome';
import MeHome from './features/me/MeHome';
import Achievements from './features/me/Achievements';
import CoursePicker from './features/scorecard/CoursePicker';
import PlayerSetup from './features/scorecard/PlayerSetup';
import Scorecard from './features/scorecard/Scorecard';
import Summary from './features/scorecard/Summary';
import CourseList from './features/courses/CourseList';
import CourseMap from './features/courses/CourseMap';
import LocationPicker from './features/locations/LocationPicker';
import Rules from './features/rules/Rules';
import Privacy from './features/privacy/Privacy';
import TvLeaderboard from './features/tv/TvLeaderboard';
import TvWall from './features/tv/TvWall';
import Hunt from './features/hunt/Hunt';
import HuntEntry from './features/hunt/HuntEntry';
import PhotoBooth from './features/photos/PhotoBooth';
import PuttGolf from './features/putt/PuttGolf';
import FunZone from './features/fun/FunZone';
import FunFacts from './features/fun/FunFacts';
import Trivia from './features/fun/Trivia';
import Spinner from './features/fun/Spinner';
import SkeeBall from './features/fun/SkeeBall';
import AirHockey from './features/fun/AirHockey';
import BumperCars from './features/fun/BumperCars';
import BumperBoats from './features/fun/BumperBoats';
import AxeThrow from './features/fun/AxeThrow';
import BattingCages from './features/fun/BattingCages';
import Bowling from './features/fun/Bowling';
import GoKarts from './features/fun/GoKarts';
import WhackAMole from './features/fun/WhackAMole';
import PopAShot from './features/fun/PopAShot';
import Darts from './features/fun/Darts';
import ShootingGallery from './features/fun/ShootingGallery';
import ClawMachine from './features/fun/ClawMachine';
import HighStriker from './features/fun/HighStriker';
import RingToss from './features/fun/RingToss';
import MilkBottle from './features/fun/MilkBottle';
import WaterGunRace from './features/fun/WaterGunRace';
import Pinball from './features/fun/Pinball';
import Food from './features/food/Food';
import Checkout from './features/food/Checkout';
import OrderStatusScreen from './features/food/OrderStatus';
import Rewards from './features/rewards/Rewards';
import Account from './features/account/Account';
import Teams from './features/teams/Teams';
import TeamDetail from './features/teams/TeamDetail';
import AcceptInvite from './features/teams/AcceptInvite';
import JoinGame from './features/shared/JoinGame';
import Lobby from './features/shared/Lobby';
import TenantUnavailable from './features/shared/TenantUnavailable';
import Install from './features/install/Install';
import StyleGuide from './features/style/StyleGuide';
import GeofenceGate from './features/shared/GeofenceGate';
import AccountGate from './features/shared/AccountGate';
import { BuildStamp } from './ui/BuildStamp';
import FeedbackButton from './ui/FeedbackButton';
import { CAPTURE_IGNORE_ATTR } from './lib/screenCapture';
import { UpdateModal } from './ui/UpdateModal';
import SkinPicker from './ui/SkinPicker';
import RotateNudge from './ui/RotateNudge';
import NavDrawer from './ui/NavDrawer';
import { DEV_MODE } from './lib/flags';
import { hydrateContent, isTenantUnavailable, useContentRevision } from './data/courses';

// Legacy → canonical redirect. The FEC restructure moved every screen under a
// section namespace (/golf/*, /arcade/*, /me/*); these forwarders keep old
// paths — printed QR codes, shared links, muscle memory, and any internal link
// not yet migrated — working. Preserves the sub-path and query string, so
// e.g. /account?link=expired → /me/account?link=expired and
// /fun/skeeball → /arcade/skeeball.
function PrefixRedirect({ from, to }: { from: string; to: string }) {
  const loc = useLocation();
  const rest = loc.pathname.slice(from.length); // '' for an exact hit, else '/sub…'
  return <Navigate to={`${to}${rest}${loc.search}`} replace />;
}

// Old → new section roots. Each entry forwards the exact path AND its sub-tree.
// Paths that are baked into external artifacts (printed QR /install, emailed
// /teams/accept, TV /tv, QR /join, shared-game /games/:id/lobby) are NOT
// renamespaced — they keep rendering at their original path below.
const REDIRECTS: [from: string, to: string][] = [
  ['/new', '/golf/new'],
  ['/play', '/golf/play'],
  ['/courses', '/golf/courses'],
  ['/rules', '/golf/rules'],
  // NOTE: /hunt is deliberately absent — it's a live route (HuntEntry), not a
  // redirect, because the course-free venue hunt claims it where a venue runs
  // one. HuntEntry forwards to /golf/hunt everywhere else, preserving exactly
  // what the redirect used to do.
  ['/fun', '/arcade'],
  ['/putt', '/arcade/putt'],
  // Photo booth and the challenge spinner are not arcade features — the booth
  // is a top-level venue activity, the spinner a mid-round golf feature — so
  // their brief stay under /arcade/* forwards on to the real homes.
  ['/arcade/photos', '/photos'],
  ['/arcade/spinner', '/golf/spinner'],
  ['/account', '/me/account'],
  ['/rewards', '/me/rewards'],
  ['/privacy', '/me/privacy'],
  ['/teams', '/me/teams'],
];

// §7 Routes / screens.
export default function App() {
  // The venue display wall is landscape by design (a TV pointed at the URL),
  // so it's exempt from the portrait nudge every phone screen gets.
  const isWall = useLocation().pathname.startsWith('/tv/wall');
  // Subscribe the whole route tree to live-content updates here, at the common
  // ancestor: catalog screens (/locations, /golf/*, /arcade, /tv/wall) read
  // LOCATIONS/COURSES as module globals without their own subscription, so
  // hydrating after first paint would otherwise leave them stale until an
  // unrelated render. Re-rendering App re-renders every route with fresh data.
  useContentRevision();
  // Pull the live catalog (venues, courses, POS config) once at boot so Master
  // Control changes reach players without a redeploy. Best-effort; falls back to
  // the cached/baked content offline. See src/data/courses.ts.
  useEffect(() => {
    void hydrateContent();
  }, []);
  // Tenant dead-end (MULTI-VENUE.md §1/§3): when /api/content marked this host
  // `unavailable: true` (unknown platform subdomain, suspended org), render the
  // dead-end page INSTEAD of the app — no routes, no nav drawer, no dev chrome,
  // nothing that could prompt (geolocation) or look like a working venue app.
  // The flag rides the content revisions (subscribed above) and is cached, so a
  // repeat visit dead-ends before first paint; the hydrate above still runs
  // every visit, and a flagless payload (org unsuspended / created) clears the
  // flag and swaps the full app back in. Placed after every hook so the two
  // branches stay Rules-of-Hooks clean.
  if (isTenantUnavailable()) return <TenantUnavailable />;
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/locations" element={<LocationPicker />} />

        {/* ── Mini Golf section ─────────────────────────────────────────── */}
        <Route path="/golf" element={<GolfHome />} />
        {/* Golf is an on-location activity — gate starting/playing a round
            behind the venue geofence (suspended unless VITE_GEOFENCE_ENFORCED). */}
        <Route element={<GeofenceGate />}>
          <Route path="/golf/new" element={<CoursePicker />} />
          <Route path="/golf/new/setup" element={<PlayerSetup />} />
          <Route path="/golf/play/:clientId" element={<Scorecard />} />
          <Route path="/golf/play/:clientId/summary" element={<Summary />} />
          {/* Challenge spinner — a mid-round handicap/dare wheel opened from the
              scorecard (carries the round's course + return path in nav state). */}
          <Route path="/golf/spinner" element={<Spinner />} />
        </Route>
        <Route path="/golf/courses" element={<CourseList />} />
        <Route path="/golf/courses/:id/map" element={<CourseMap />} />
        <Route path="/golf/rules" element={<Rules />} />
        {/* AI scavenger hunt — a golf-round activity. */}
        <Route path="/golf/hunt" element={<Hunt />} />
        {/* Player-facing leaderboard (the /tv board is phone-friendly and doubles
            as the venue display; /tv stays below for TVs/QRs). */}
        <Route path="/golf/leaderboard" element={<TvLeaderboard />} />

        {/* ── Arcade section ────────────────────────────────────────────── */}
        {/* Games and native F&B ordering are on-location activities — gate the
            whole Arcade and food behind the venue geofence (suspended unless
            VITE_GEOFENCE_ENFORCED). Food additionally redirects home when the
            venue lacks the ordering add-on (src/lib/pos). The photo booth is
            deliberately NOT gated (it's below, outside this group). */}
        <Route element={<GeofenceGate />}>
          <Route path="/arcade" element={<FunZone />} />
          {/* §12 "While You Wait" content — fun facts and trivia. */}
          <Route path="/arcade/facts" element={<FunFacts />} />
          <Route path="/arcade/trivia" element={<Trivia />} />
          {/* Clubhouse extra — Arcade Putt mini-golf minigame. */}
          <Route path="/arcade/putt" element={<PuttGolf />} />
          <Route path="/arcade/skeeball" element={<SkeeBall />} />
          <Route path="/arcade/airhockey" element={<AirHockey />} />
          <Route path="/arcade/bumper" element={<BumperCars />} />
          <Route path="/arcade/boats" element={<BumperBoats />} />
          <Route path="/arcade/axe" element={<AxeThrow />} />
          <Route path="/arcade/batting" element={<BattingCages />} />
          <Route path="/arcade/bowling" element={<Bowling />} />
          <Route path="/arcade/karts" element={<GoKarts />} />
          <Route path="/arcade/mole" element={<WhackAMole />} />
          <Route path="/arcade/hoops" element={<PopAShot />} />
          <Route path="/arcade/darts" element={<Darts />} />
          <Route path="/arcade/gallery" element={<ShootingGallery />} />
          <Route path="/arcade/claw" element={<ClawMachine />} />
          <Route path="/arcade/striker" element={<HighStriker />} />
          <Route path="/arcade/rings" element={<RingToss />} />
          <Route path="/arcade/bottles" element={<MilkBottle />} />
          <Route path="/arcade/watergun" element={<WaterGunRace />} />
          <Route path="/arcade/pinball" element={<Pinball />} />
          {/* Native F&B ordering — POS-integration add-on, rendered only for
              venues with a paid config (src/lib/pos); each screen redirects home
              when its capability is off. */}
          <Route path="/food" element={<Food />} />
          <Route path="/food/checkout" element={<Checkout />} />
          <Route path="/food/order/:orderId" element={<OrderStatusScreen />} />
        </Route>
        {/* Photo booth — photo sharing + stickers, no AI in the pipeline. A
            general venue activity, not an arcade game: top-level and not
            geofenced (matches its pre-restructure behavior). */}
        <Route path="/photos" element={<PhotoBooth />} />
        {/* Course-free scavenger hunt — a standalone venue activity for sites
            without mini golf (and a park-wide extra at ones with it). Not
            geofenced, matching the photo booth and the on-course hunt: the
            venue's own list is the thing that scopes it. HuntEntry decides
            whether this venue has one, forwarding to /golf/hunt if not. */}
        <Route path="/hunt" element={<HuntEntry />} />

        {/* ── Me section ────────────────────────────────────────────────── */}
        {/* The hub itself stays open — signed out it is the sign-in pitch, and
            it hides the rows that need an account (see MeHome). */}
        <Route path="/me" element={<MeHome />} />
        {/* Player account — passwordless email sign-in + profile. Necessarily
            ungated: it is how you get through the gate. */}
        <Route path="/me/account" element={<Account />} />
        {/* Everything that belongs to a person rather than a place needs an
            account. Walk-up play (golf, arcade, photo booth, food) deliberately
            stays open above — the gate is about identity, not friction. */}
        <Route element={<AccountGate />}>
          <Route path="/me/teams" element={<Teams />} />
          <Route path="/me/teams/:id" element={<TeamDetail />} />
          {/* Rewards card — POS loyalty add-on; redirects home when off. */}
          <Route path="/me/rewards" element={<Rewards />} />
          {/* Player achievements / badges gallery. */}
          <Route path="/me/achievements" element={<Achievements />} />
        </Route>
        {/* Plain-language disclosure of everything the app records. */}
        <Route path="/me/privacy" element={<Privacy />} />

        {/* ── Stable external targets (NOT renamespaced) ────────────────── */}
        {/* Emailed-invite deep link — must keep its original path for links
            already in inboxes. Ranks above /teams/* redirect (static > splat). */}
        <Route path="/teams/accept" element={<AcceptInvite />} />
        {/* Shared multi-device games — join by code (QR target) + host lobby. */}
        <Route path="/join" element={<JoinGame />} />
        <Route path="/games/:gameId/lobby" element={<Lobby />} />
        {/* Install-to-home-screen landing page (printed-QR target). */}
        <Route path="/install" element={<Install />} />
        {/* Leaderboard preview + venue display wall — TV / QR targets. */}
        <Route path="/tv" element={<TvLeaderboard />} />
        <Route path="/tv/wall" element={<TvWall />} />
        {/* Living component inventory / style guide — the theming reference. */}
        <Route path="/style" element={<StyleGuide />} />

        {/* ── Legacy redirects (old paths → new namespaces) ─────────────── */}
        {REDIRECTS.map(([from, to]) => (
          <Route key={from}>
            <Route path={from} element={<PrefixRedirect from={from} to={to} />} />
            <Route path={`${from}/*`} element={<PrefixRedirect from={from} to={to} />} />
          </Route>
        ))}

        <Route path="*" element={<Home />} />
      </Routes>

      {/* The global navigation drawer — opened by the hamburger in every
          screen's HeaderControls; the app's one persistent way between
          sections. Mounted once here so it overlays the whole route tree. */}
      <NavDrawer />

      {/* Dev-only chrome — build stamp + reviewer feedback (bottom-right) and
          skin picker (bottom-left). Gated behind DEV_MODE alongside the app's
          other development affordances; the light/dark and mute switches that
          used to share these corners now ride in each screen's header. */}
      {DEV_MODE && (
        <>
          {/* Each corner carries CAPTURE_IGNORE_ATTR so the feedback widget's
              screen grab leaves the dev chrome out — a reviewer's screenshot
              should show the app, not our own overlay sitting on top of it. */}

          {/* Build stamp on every page — fixed, non-interactive so it never
              blocks a tap. Confirms which build the browser actually loaded. */}
          <div
            {...{ [CAPTURE_IGNORE_ATTR]: '' }}
            className="pointer-events-none fixed bottom-0 right-0 z-50 select-none px-2"
            style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom))' }}
          >
            <BuildStamp />
          </div>

          {/* Reviewer commentary — sits directly above the build stamp so a
              reviewer's note and the build it's about share one corner. The
              overlay stays pass-through; only the pill takes taps. */}
          <div
            {...{ [CAPTURE_IGNORE_ATTR]: '' }}
            className="pointer-events-none fixed right-0 z-50 px-2"
            style={{ bottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
          >
            <FeedbackButton />
          </div>

          <div
            {...{ [CAPTURE_IGNORE_ATTR]: '' }}
            className="fixed bottom-0 left-0 z-50 flex items-center gap-2 p-2"
            style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
          >
            <SkinPicker />
          </div>
        </>
      )}

      {/* Blocking prompt when a deploy lands while the app is open on a stale
          cached bundle — reloads onto the fresh build. */}
      <UpdateModal />

      {/* Every screen is portrait-first — nudge phones back to vertical when
          held sideways. Exception: the landscape-by-design display wall. */}
      {!isWall && <RotateNudge />}
    </>
  );
}
