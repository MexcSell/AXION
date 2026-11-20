import { lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { TipProvider } from '@/components/ui/Tip';
import NotFound from '@/pages/NotFound';

const Overview = lazy(() => import('@/pages/Overview'));
const Missions = lazy(() => import('@/pages/Missions'));
const MissionControl = lazy(() => import('@/pages/MissionControl'));
const Agents = lazy(() => import('@/pages/Agents'));
const AgentProfile = lazy(() => import('@/pages/AgentProfile'));
const Organization = lazy(() => import('@/pages/Organization'));
const BrowserStudio = lazy(() => import('@/pages/BrowserStudio'));
const Results = lazy(() => import('@/pages/Results'));
const Knowledge = lazy(() => import('@/pages/Knowledge'));
const Evolution = lazy(() => import('@/pages/Evolution'));
const Models = lazy(() => import('@/pages/Models'));
const Users = lazy(() => import('@/pages/Users'));
const Governance = lazy(() => import('@/pages/Governance'));
const Usage = lazy(() => import('@/pages/Usage'));
const Notifications = lazy(() => import('@/pages/Notifications'));
const Settings = lazy(() => import('@/pages/Settings'));
const Operations = lazy(() => import('@/pages/Operations'));
const Help = lazy(() => import('@/pages/Help'));

function ControlRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/control/${id}` : '/control/M-126'} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <TipProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<Overview />} />
            <Route path="/missions" element={<Missions />} />
            <Route path="/missions/:id" element={<ControlRedirect />} />
            <Route path="/control" element={<ControlRedirect />} />
            <Route path="/control/:id" element={<MissionControl />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/agents/:id" element={<AgentProfile />} />
            <Route path="/organization" element={<Organization />} />
            <Route path="/browser" element={<BrowserStudio />} />
            <Route path="/results" element={<Results />} />
            <Route path="/knowledge" element={<Knowledge />} />
            <Route path="/evolution" element={<Evolution />} />
            <Route path="/models" element={<Models />} />
            <Route path="/users" element={<Users />} />
            <Route path="/governance" element={<Governance />} />
            <Route path="/usage" element={<Usage />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/operations" element={<Operations />} />
            <Route path="/help" element={<Help />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </TipProvider>
    </BrowserRouter>
  );
}
