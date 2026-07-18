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
import AxeThrow from './features/fun/AxeThrow';
import BattingCages from './features/fun/BattingCages';
import Bowling from './features/fun/Bowling';
import GoKarts from './features/fun/GoKarts';
import Install from './features/install/Install';
import { BuildStamp } from './ui/BuildStamp';
import { UpdateModal } from './ui/UpdateModal';
import SoundToggle from './ui/SoundToggle';
import ThemeToggle from './ui/ThemeToggle';

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
        <Route path="/fun/axe" element={<AxeThrow />} />
        <Route path="/fun/batting" element={<BattingCages />} />
        <Route path="/fun/bowling" element={<Bowling />} />
        <Route path="/fun/karts" element={<GoKarts />} />
        {/* Install-to-home-screen landing page (QR-code target). */}
        <Route path="/install" element={<Install />} />
        <Route path="*" element={<Home />} />
      </Routes>

      {/* Build stamp on every page — fixed, non-interactive so it never blocks
          a tap. Confirms which build the browser actually loaded. */}
      <div
        className="pointer-events-none fixed bottom-0 right-0 z-50 select-none px-2"
        style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom))' }}
      >
        <BuildStamp />
      </div>

      {/* Always-available controls, bottom-left (mirrors the build stamp):
          light/dark toggle beside the mute switch. */}
      <div
        className="fixed bottom-0 left-0 z-50 flex items-center gap-2 p-2"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        <ThemeToggle />
        <SoundToggle />
      </div>

      {/* Blocking prompt when a deploy lands while the app is open on a stale
          cached bundle — reloads onto the fresh build. */}
      <UpdateModal />
    </>
  );
}
