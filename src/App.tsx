import { Routes, Route } from 'react-router-dom';
import Home from './features/home/Home';
import CoursePicker from './features/scorecard/CoursePicker';
import PlayerSetup from './features/scorecard/PlayerSetup';
import Scorecard from './features/scorecard/Scorecard';
import Summary from './features/scorecard/Summary';
import CourseList from './features/courses/CourseList';
import CourseMap from './features/courses/CourseMap';
import LocationPicker from './features/locations/LocationPicker';
import Rules from './features/rules/Rules';
import TvLeaderboard from './features/tv/TvLeaderboard';
import Hunt from './features/hunt/Hunt';
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
import CoinPusher from './features/fun/CoinPusher';
import Account from './features/account/Account';
import Install from './features/install/Install';
import StyleGuide from './features/style/StyleGuide';
import { BuildStamp } from './ui/BuildStamp';
import { UpdateModal } from './ui/UpdateModal';
import SkinPicker from './ui/SkinPicker';
import RotateNudge from './ui/RotateNudge';
import { DEV_MODE } from './lib/flags';

// §7 Routes / screens.
export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/locations" element={<LocationPicker />} />
        <Route path="/new" element={<CoursePicker />} />
        <Route path="/new/setup" element={<PlayerSetup />} />
        <Route path="/play/:clientId" element={<Scorecard />} />
        <Route path="/play/:clientId/summary" element={<Summary />} />
        <Route path="/courses" element={<CourseList />} />
        <Route path="/courses/:id/map" element={<CourseMap />} />
        <Route path="/rules" element={<Rules />} />
        {/* P2 preview — the API already serves the leaderboard. */}
        <Route path="/tv" element={<TvLeaderboard />} />
        {/* P3 — AI scavenger hunt. */}
        <Route path="/hunt" element={<Hunt />} />
        {/* Clubhouse extra — Arcade Putt mini-golf minigame. */}
        <Route path="/putt" element={<PuttGolf />} />
        {/* §12 "While You Wait" content — fun facts, trivia, challenge spinner. */}
        <Route path="/fun" element={<FunZone />} />
        <Route path="/fun/facts" element={<FunFacts />} />
        <Route path="/fun/trivia" element={<Trivia />} />
        <Route path="/fun/spinner" element={<Spinner />} />
        <Route path="/fun/skeeball" element={<SkeeBall />} />
        <Route path="/fun/airhockey" element={<AirHockey />} />
        <Route path="/fun/bumper" element={<BumperCars />} />
        <Route path="/fun/boats" element={<BumperBoats />} />
        <Route path="/fun/axe" element={<AxeThrow />} />
        <Route path="/fun/batting" element={<BattingCages />} />
        <Route path="/fun/bowling" element={<Bowling />} />
        <Route path="/fun/karts" element={<GoKarts />} />
        <Route path="/fun/mole" element={<WhackAMole />} />
        <Route path="/fun/hoops" element={<PopAShot />} />
        <Route path="/fun/darts" element={<Darts />} />
        <Route path="/fun/gallery" element={<ShootingGallery />} />
        <Route path="/fun/claw" element={<ClawMachine />} />
        <Route path="/fun/striker" element={<HighStriker />} />
        <Route path="/fun/rings" element={<RingToss />} />
        <Route path="/fun/bottles" element={<MilkBottle />} />
        <Route path="/fun/watergun" element={<WaterGunRace />} />
        <Route path="/fun/pinball" element={<Pinball />} />
        <Route path="/fun/pusher" element={<CoinPusher />} />
        {/* Player account — passwordless email sign-in + profile. */}
        <Route path="/account" element={<Account />} />
        {/* Install-to-home-screen landing page (QR-code target). */}
        <Route path="/install" element={<Install />} />
        {/* Living component inventory / style guide — the theming reference. */}
        <Route path="/style" element={<StyleGuide />} />
        <Route path="*" element={<Home />} />
      </Routes>

      {/* Dev-only chrome — build stamp (bottom-right) and skin picker
          (bottom-left). Gated behind DEV_MODE alongside the app's other
          development affordances; the light/dark and mute switches that used to
          share these corners now ride in each screen's header. */}
      {DEV_MODE && (
        <>
          {/* Build stamp on every page — fixed, non-interactive so it never
              blocks a tap. Confirms which build the browser actually loaded. */}
          <div
            className="pointer-events-none fixed bottom-0 right-0 z-50 select-none px-2"
            style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom))' }}
          >
            <BuildStamp />
          </div>

          <div
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
          held sideways. */}
      <RotateNudge />
    </>
  );
}
