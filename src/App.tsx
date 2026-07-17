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
import { BuildStamp } from './ui/BuildStamp';

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
    </>
  );
}
