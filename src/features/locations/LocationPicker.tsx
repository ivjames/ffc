import { useNavigate, useSearchParams } from 'react-router-dom';
import { Screen, TopBar, Content } from '../../ui/components';
import { LOCATIONS, coursesByLocation } from '../../data/courses';
import { useCurrentLocationId, setCurrentLocationId } from '../../lib/location';

// §5 Location picker — the client runs several sites; choose which one you're
// playing at. The choice is remembered (localStorage) and scopes course lists
// and round setup. An optional `?next=/path` chains onward after choosing
// (e.g. straight into starting a round); otherwise we return to Home.
export default function LocationPicker() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const current = useCurrentLocationId();

  function choose(id: string) {
    setCurrentLocationId(id);
    navigate(next, { replace: true });
  }

  return (
    <Screen>
      <TopBar title="Choose a location" back="/" />
      <Content>
        <div className="space-y-3">
          {LOCATIONS.map((loc) => {
            const count = coursesByLocation(loc.id).length;
            const selected = loc.id === current;
            return (
              <button
                key={loc.id}
                onClick={() => choose(loc.id)}
                className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left active:bg-fairway-800/60 ${
                  selected
                    ? 'border-fairway-500/60 bg-fairway-900/70'
                    : 'border-fairway-800 bg-fairway-900/40'
                }`}
              >
                <span
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl"
                  style={{ background: `${loc.accent}22`, border: `1px solid ${loc.accent}55` }}
                >
                  📍
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-bold text-fairway-50">
                    {loc.name}
                  </span>
                  <span className="block text-sm text-fairway-100/60">
                    {count} {count === 1 ? 'course' : 'courses'}
                  </span>
                </span>
                {selected ? (
                  <span className="text-sm font-semibold text-fairway-400">Current</span>
                ) : (
                  <span className="text-xl text-fairway-400">›</span>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-4 text-center text-xs text-fairway-100/40">
          Placeholder sites — the client's real locations swap in here.
        </p>
      </Content>
    </Screen>
  );
}
