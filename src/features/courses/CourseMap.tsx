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
        {course.mapAsset ? (
          <>
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
              Tap the map to {zoomed ? 'shrink' : 'zoom'}
            </p>
          </>
        ) : (
          <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-fairway-800 bg-fairway-900/40 text-center text-sm text-fairway-100/40">
            Course map coming soon
          </div>
        )}

        {/* Per-hole names and pars */}
        <h2 className="mt-6 mb-2 text-sm font-semibold text-fairway-100/80">Holes</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {course.pars.map((p, h) => (
            <div
              key={h}
              className="flex items-center justify-between gap-2 rounded-lg border border-fairway-800 bg-fairway-950 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-[10px] text-fairway-100/40">Hole {h + 1}</div>
                {course.holeNames?.[h] && (
                  <div className="truncate text-sm font-semibold text-fairway-100">
                    {course.holeNames[h]}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="text-[10px] text-fairway-100/40">Par</div>
                <div className="text-lg font-bold leading-none" style={{ color: course.accent }}>
                  {p}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Content>
    </Screen>
  );
}
