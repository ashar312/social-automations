import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Compose from './pages/Compose.jsx'
import History from './pages/History.jsx'
import PostDetail from './pages/PostDetail.jsx'
import Connections from './pages/Connections.jsx'
import Quests from './pages/Quests.jsx'
import Projects from './pages/Projects.jsx'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/compose" replace />} />
        <Route path="compose" element={<Compose />} />
        <Route path="quests" element={<Quests />} />
        <Route path="history" element={<History />} />
        <Route path="history/:id" element={<PostDetail />} />
        <Route path="connections" element={<Connections />} />
        <Route path="projects" element={<Projects />} />
      </Route>
    </Routes>
  )
}
