import { Navigate, Outlet } from 'react-router-dom';
import { useModules, type ModuleKey } from '../../lib/modules';
import { useContentRevision } from '../../data/courses';

// À la carte module gate (layout route). Wraps the routes belonging to one
// separately-sold module and sends players home when this venue's plan doesn't
// include it.
//
// This exists because hiding a nav entry is presentation, not enforcement. The
// arcade tile disappearing from Home and the drawer did nothing about a
// bookmark, a shared link, a QR code printed last season, or simply typing
// /arcade — all of which handed a venue the whole module it hadn't bought.
//
// Deliberately a REDIRECT rather than an explanatory screen: "your venue didn't
// pay for this" is a conversation between us and the operator, not something to
// put in front of a guest. Home is the honest destination — the app there shows
// exactly what this venue does offer.
//
// The server enforces the same entitlements on the write paths (recording a
// score, opening a trivia session, issuing a challenge). This gate is the
// navigational half; neither half is load-bearing on its own.

export default function ModuleGate({ module }: { module: ModuleKey }) {
  // Content hydration can flip a module after first paint (an operator enabling
  // it in Master Control reaches players without a redeploy), so re-resolve
  // rather than latching the value from the first render.
  useContentRevision();
  const modules = useModules();
  if (modules[module]) return <Outlet />;
  return <Navigate to="/" replace />;
}
