import { Routes, Route } from 'react-router-dom';
import Home from './features/home/Home';
import CoursePicker from './features/scorecard/CoursePicker';
import PlayerSetup from './features/scorecard/PlayerSetup';
import Scorecard from './features/scorecard/Scorecard';
import Summary from './features/scorecard/Summary';
import CourseList from './features/courses/CourseList';
import CourseMap from './features/courses/CourseMap';
import Rules from './features/rules/Rules';
import TvLeaderboard from './features/tv/TvLeaderboard';

// §7 Routes / screens.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/new" element={<CoursePicker />} />
      <Route path="/new/setup" element={<PlayerSetup />} />
      <Route path="/play/:clientId" element={<Scorecard />} />
      <Route path="/play/:clientId/summary" element={<Summary />} />
      <Route path="/courses" element={<CourseList />} />
      <Route path="/courses/:id/map" element={<CourseMap />} />
      <Route path="/rules" element={<Rules />} />
      {/* P2 preview — the API already serves the leaderboard. */}
      <Route path="/tv" element={<TvLeaderboard />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
