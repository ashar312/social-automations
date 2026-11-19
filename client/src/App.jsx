import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Compose from './pages/Compose.jsx'
import History from './pages/History.jsx'
import PostDetail from './pages/PostDetail.jsx'
import Connections from './pages/Connections.jsx'
import Overview from './pages/Overview.jsx'
import Projects from './pages/Projects.jsx'
import Integration from './pages/Integration.jsx'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/compose" replace />} />
        <Route path="overview" element={<Overview />} />
        <Route path="quests" element={<Navigate to="/overview" replace />} />
        <Route path="compose" element={<Compose />} />
        <Route path="history" element={<History />} />
        <Route path="history/:id" element={<PostDetail />} />
        <Route path="connections" element={<Connections />} />
        <Route path="projects" element={<Projects />} />
        <Route path="integration" element={<Integration />} />
      </Route>
    </Routes>
  )
}
