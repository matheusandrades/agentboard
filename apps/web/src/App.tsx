import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthGate } from './components/AuthGate';
import { Layout } from './components/Layout';
import { Users } from './pages/Users';
import { Orgs } from './pages/Orgs';
import { Board } from './pages/Board';
import { Agents } from './pages/Agents';
import { AgentDetail } from './pages/AgentDetail';
import { Timeline } from './pages/Timeline';
import { Chat } from './pages/Chat';
import { Sprints } from './pages/Sprints';
import { Commits } from './pages/Commits';
import { Live } from './pages/Live';
import { Previews } from './pages/Previews';
import { Approvals } from './pages/Approvals';
import { Projects } from './pages/Projects';
import { ProjectDetail } from './pages/ProjectDetail';
import { Settings } from './pages/Settings';
import { Usage } from './pages/Usage';
import { Dashboard } from './pages/Dashboard';
import { TaskReplay } from './pages/TaskReplay';

export default function App() {
  return (
    <AuthGate>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/usage" element={<Usage />} />
          <Route path="/spend" element={<Navigate to="/usage" replace />} />
          <Route path="/tasks/:id/replay" element={<TaskReplay />} />
          <Route path="/live" element={<Live />} />
          <Route path="/board" element={<Board />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/agents/:id" element={<AgentDetail />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/commits" element={<Commits />} />
          <Route path="/previews" element={<Previews />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/orgs" element={<Orgs />} />
          <Route path="/users" element={<Users />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/sprints" element={<Sprints />} />
          <Route path="*" element={<Navigate to="/board" replace />} />
        </Route>
      </Routes>
    </AuthGate>
  );
}
