import { useState, useEffect } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { getToken, setToken, clearToken } from './api';
import { Button, Card, Field, Input } from './ui';
import Overview from './Overview';
import Orgs from './Orgs';
import OrgDetail from './OrgDetail';
import LocationWizard from './LocationWizard';
import LocationDetail from './LocationDetail';
import Archived from './Archived';

export function TokenGate({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="mx-auto mt-24 max-w-sm px-4">
      <Card>
        <h1 className="mb-1 text-lg font-semibold">Master Control</h1>
        <p className="mb-4 text-sm text-slate-500">Enter the admin token to continue.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setToken(value.trim());
            onUnlock();
          }}
          className="space-y-3"
        >
          <Field label="Admin token">
            <Input
              type="password"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="APP_TOKEN"
            />
          </Field>
          <Button type="submit" disabled={!value.trim()} className="w-full">
            Unlock
          </Button>
        </form>
      </Card>
    </div>
  );
}

function Shell({ onLock }: { onLock: () => void }) {
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${
      isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200'
    }`;
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2">
          <span className="mr-2 font-semibold">FFC · Master Control</span>
          <nav className="flex gap-1">
            <NavLink to="/" end className={linkCls}>
              Overview
            </NavLink>
            <NavLink to="/orgs" className={linkCls}>
              Orgs
            </NavLink>
            <NavLink to="/locations/new" className={linkCls}>
              + Location
            </NavLink>
            <NavLink to="/archived" className={linkCls}>
              Archived
            </NavLink>
          </nav>
          <div className="ml-auto">
            <Button variant="ghost" onClick={onLock}>
              Lock
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/orgs" element={<Orgs />} />
          <Route path="/orgs/:id" element={<OrgDetail />} />
          <Route path="/locations/new" element={<LocationWizard />} />
          <Route path="/locations/:id" element={<LocationDetail />} />
          <Route path="/archived" element={<Archived />} />
          <Route path="*" element={<Overview />} />
        </Routes>
      </main>
    </div>
  );
}

export default function ControlApp() {
  const [unlocked, setUnlocked] = useState(Boolean(getToken()));

  // Any API call that hits 401 dispatches this event -> drop to the gate.
  useEffect(() => {
    const onUnauthorized = () => {
      clearToken();
      setUnlocked(false);
    };
    window.addEventListener('ffc-admin-unauthorized', onUnauthorized);
    return () => window.removeEventListener('ffc-admin-unauthorized', onUnauthorized);
  }, []);

  if (!unlocked) return <TokenGate onUnlock={() => setUnlocked(true)} />;
  return (
    <Shell
      onLock={() => {
        clearToken();
        setUnlocked(false);
      }}
    />
  );
}
