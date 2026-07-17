import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Screen, TopBar, Content } from '../../ui/components';
import { courseById } from '../../data/courses';

// §5.2 Course map — bundled asset (SVG), viewable offline, with a simple
// pinch-free zoom toggle (detailed maps can be tapped to enlarge). Per-hole
// pars are shown alongside the map.
export default function CourseMap() {
  const { id = '' } = useParams();
  const course = courseById(id);
  const [zoomed, setZoomed] = useState(false);

  if (!course) {
    return (
      <Screen>
        <TopBar title="Map" back="/courses" />
        <Content>
          <p className="text-fairway-100/70">Course not found.</p>
        </Content>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title={course.name} back="/courses" />
      <Content>
        <div
          className={`overflow-auto rounded-2xl border border-fairway-800 bg-fairway-900/40 ${
            zoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'
          }`}
          onClick={() => setZoomed((z) => !z)}
        >
          <img
            src={course.mapAsset}
            alt={`${course.name} course map`}
            className="mx-auto block h-auto transition-all"
            style={{ width: zoomed ? '200%' : '100%', maxWidth: zoomed ? 'none' : '100%' }}
          />
        </div>
        <p className="mt-2 text-center text-xs text-fairway-100/40">
          Tap the map to {zoomed ? 'shrink' : 'zoom'} · placeholder art until real maps land
        </p>

        {/* Per-hole pars */}
        <h2 className="mt-6 mb-2 text-sm font-semibold text-fairway-100/80">Pars</h2>
        <div className="grid grid-cols-6 gap-2">
          {course.pars.map((p, h) => (
            <div
              key={h}
              className="rounded-lg border border-fairway-800 bg-fairway-950 py-2 text-center"
            >
              <div className="text-[10px] text-fairway-100/40">{h + 1}</div>
              <div className="text-lg font-bold" style={{ color: course.accent }}>
                {p}
              </div>
            </div>
          ))}
        </div>
      </Content>
    </Screen>
  );
}
