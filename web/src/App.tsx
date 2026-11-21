import { lazy, useEffect, useState, type ComponentType } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { TipProvider } from '@/components/ui/Tip';
import NotFound from '@/pages/NotFound';
import { loadHelp } from '@/help/load';
import { lazyShellParts } from '@/components/layout/AppShell';
import { AuthGate } from '@/features/auth/AuthGate';

/**
 * Like React.lazy, but once the chunk is loaded (by the idle preloader or a first visit) the page renders
 * directly. Plain lazy() suspends on every first mount even for an already-loaded chunk, and React then
 * keeps the skeleton up for its ~300 ms fallback throttle, which made each first page switch feel slow.
 */
type PageModule = { default: ComponentType };
const preloaders: (() => Promise<unknown>)[] = [];
function preloadable(factory: () => Promise<PageModule>) {
  let Loaded: ComponentType | null = null;
  const take = (m: PageModule) => { Loaded = m.default; return m; };
  const Lazy = lazy(() => factory().then(take));
  preloaders.push(() => factory().then(take));
  // Pick once per mount: switching Lazy → Loaded mid-life would remount the page and lose its state.
  return function Page() { const [C] = useState<ComponentType>(() => Loaded ?? Lazy); return <C />; };
}

// Route chunks: loaded lazily, then all preloaded once the browser is idle so a first visit to a page never waits on the network.
const load = {
  Overview: () => import('@/pages/Overview'),
  Missions: () => import('@/pages/Missions'),
  Agents: () => import('@/pages/Agents'),
  AgentProfile: () => import('@/pages/AgentProfile'),
  JobSearch: () => import('@/pages/plugins/JobSearch'),
  Results: () => import('@/pages/Results'),
  Models: () => import('@/pages/Models'),
  Notifications: () => import('@/pages/Notifications'),
  Settings: () => import('@/pages/Settings'),
  Operations: () => import('@/pages/Operations'),
  Help: () => import('@/pages/Help'),
};
const Overview = preloadable(load.Overview);
const Missions = preloadable(load.Missions);
const AgentsRedirect = preloadable(load.Agents);
const AgentProfile = preloadable(load.AgentProfile);
const JobSearch = preloadable(load.JobSearch);
const Results = preloadable(load.Results);
const ModelsRedirect = preloadable(load.Models);
const Notifications = preloadable(load.Notifications);
const Settings = preloadable(load.Settings);
const Operations = preloadable(load.Operations);
const Help = preloadable(load.Help);

function usePreloadRoutes() {
  useEffect(() => {
    const idle = (cb: () => void) => { if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(cb, { timeout: 3000 }); else setTimeout(cb, 1200); };
    // one chunk per idle slot so preloading never competes with the first paint
    const queue = [loadHelp, ...lazyShellParts, ...preloaders];
    const next = () => { const f = queue.shift(); if (f) f().catch(() => {}).finally(() => idle(next)); };
    idle(next);
  }, []);
}

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
  usePreloadRoutes();
  return (
    <BrowserRouter>
      <TipProvider>
        <AuthGate>
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
            <Route path="/browser" element={<Navigate to="/plugins/job-search" replace />} />
            <Route path="/plugins/job-search" element={<JobSearch />} />
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
        </AuthGate>
      </TipProvider>
    </BrowserRouter>
  );
}
