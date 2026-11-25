import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { TipProvider } from '@/components/ui/Tip';
import { AuthGate } from '@/features/auth/AuthGate';

const AppShell = lazy(() => import('@/components/layout/AppShell').then(m => ({ default: m.AppShell })));
const NotFound = lazy(() => import('@/pages/NotFound'));
const Overview = lazy(() => import('@/pages/Overview'));
const Missions = lazy(() => import('@/pages/Missions'));
const AgentsRedirect = lazy(() => import('@/pages/Agents'));
const AgentProfile = lazy(() => import('@/pages/AgentProfile'));
const Results = lazy(() => import('@/pages/Results'));
const ModelsRedirect = lazy(() => import('@/pages/Models'));
const Notifications = lazy(() => import('@/pages/Notifications'));
const Settings = lazy(() => import('@/pages/Settings'));
const Operations = lazy(() => import('@/pages/Operations'));
const Help = lazy(() => import('@/pages/Help'));

/** Old Mission Control links (/control[/:id]) land on the merged Missions page, keeping ?tab=&agent=. */
function ControlRedirect() {
  const { id } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/missions${id ? `/${id}` : ''}${search}`} replace />;
}

/** The Organization page was merged into Agents: the org chart is the Directory's Hierarchy view. */
function OrgRedirect() {
  const { search } = useLocation();
  const tab = new URLSearchParams(search).get('tab');
  const keep = ['departments', 'assignments', 'policies', 'proposals'];
  return <Navigate to={tab && keep.includes(tab) ? `/operations?tab=agents&sub=${tab}` : '/operations?tab=agents&sub=directory&view=hierarchy'} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <TipProvider>
        <AuthGate>
        <Suspense fallback={<div className="center" role="status">Loading workspace…</div>}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/missions" replace />} />
            <Route path="/overview" element={<Overview />} />
            <Route path="/missions/:id?" element={<Missions />} />
            <Route path="/control" element={<ControlRedirect />} />
            <Route path="/control/:id" element={<ControlRedirect />} />
            <Route path="/agents" element={<AgentsRedirect />} />
            <Route path="/agents/:id" element={<AgentProfile />} />
            <Route path="/organization" element={<OrgRedirect />} />
            <Route path="/browser" element={<Navigate to="/missions" replace />} />
            <Route path="/plugins/job-search" element={<Navigate to="/missions" replace />} />
            <Route path="/results" element={<Results />} />
            <Route path="/knowledge" element={<Navigate to="/operations?tab=agents&sub=lineage" replace />} />
            <Route path="/evolution" element={<Navigate to="/operations?tab=agents&sub=development" replace />} />
            <Route path="/models" element={<ModelsRedirect />} />
            <Route path="/users" element={<Navigate to="/settings?tab=users" replace />} />
            <Route path="/governance" element={<Navigate to="/notifications?tab=pending" replace />} />
            <Route path="/usage" element={<Navigate to="/operations" replace />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/operations" element={<Operations />} />
            <Route path="/help" element={<Help />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
        </Suspense>
        </AuthGate>
      </TipProvider>
    </BrowserRouter>
  );
}
