import { Routes, Route, Navigate } from 'react-router-dom'
import { RequireAuth, GuestOnly } from './auth/guards.jsx'
import { ProjectProvider } from './projects/ProjectProvider.jsx'
import Login from './pages/auth/Login.jsx'
import Signup from './pages/auth/Signup.jsx'
import ForgotPassword from './pages/auth/ForgotPassword.jsx'
import ResetPassword from './pages/auth/ResetPassword.jsx'
import FinishSignup from './pages/auth/FinishSignup.jsx'
import VerifyEmail from './pages/auth/VerifyEmail.jsx'
import Settings from './pages/Settings.jsx'
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
      <Route element={<GuestOnly />}>
        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
      </Route>
      <Route path="reset-password" element={<ResetPassword />} />
      <Route path="auth/finish" element={<FinishSignup />} />
      <Route path="verify-email" element={<VerifyEmail />} />
      <Route element={<RequireAuth><ProjectProvider><Layout /></ProjectProvider></RequireAuth>}>
        <Route index element={<Navigate to="/compose" replace />} />
        <Route path="overview" element={<Overview />} />
        <Route path="quests" element={<Navigate to="/overview" replace />} />
        <Route path="compose" element={<Compose />} />
        <Route path="history" element={<History />} />
        <Route path="history/:id" element={<PostDetail />} />
        <Route path="connections" element={<Connections />} />
        <Route path="projects" element={<Projects />} />
        <Route path="integration" element={<Integration />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
