import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'

import Welcome from './pages/Welcome'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import Analytics from './pages/Analytics'
import Settings from './pages/Settings'
import Profile from './pages/Profile'
import About from './pages/About'
import Backlog from './pages/Backlog'
import Tickets from './pages/Tickets'
import TicketDetail from './pages/TicketDetail'
import UserRequestIncidents from './pages/UserRequestIncidents'
import Data from './pages/Data'
import TeamAvailability from './pages/TeamAvailability'
import AI from './pages/AI'
import SentimentIncidentDetail from './pages/SentimentIncidentDetail'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Welcome />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route path="/dashboard" element={<ProtectedRoute><Layout><Dashboard /></Layout></ProtectedRoute>} />
      <Route path="/data" element={<ProtectedRoute><Layout><Data /></Layout></ProtectedRoute>} />
      {/* Old separate Upload/Uploaded-Data pages are now one tabbed page - keep the old paths working as redirects. */}
      <Route path="/upload" element={<Navigate to="/data?tab=upload" replace />} />
      <Route path="/datasets" element={<Navigate to="/data?tab=manage" replace />} />
      <Route path="/backlog" element={<ProtectedRoute><Layout><Backlog /></Layout></ProtectedRoute>} />
      <Route path="/tickets" element={<ProtectedRoute><Layout><Tickets /></Layout></ProtectedRoute>} />
      <Route path="/tickets/:number" element={<ProtectedRoute><Layout><TicketDetail /></Layout></ProtectedRoute>} />
      <Route path="/user-requests" element={<ProtectedRoute><Layout><UserRequestIncidents /></Layout></ProtectedRoute>} />
      <Route path="/team-availability" element={<ProtectedRoute><Layout><TeamAvailability /></Layout></ProtectedRoute>} />
      <Route path="/ai" element={<ProtectedRoute><Layout><AI /></Layout></ProtectedRoute>} />
      <Route path="/sentiment-analysis/:number" element={<ProtectedRoute><Layout><SentimentIncidentDetail /></Layout></ProtectedRoute>} />
      {/* Copilot, incident response, and chat now live together in the SDM AI Workspace. */}
      <Route path="/sdm-copilot" element={<Navigate to="/ai?tab=copilot" replace />} />
      <Route path="/ai-insights" element={<Navigate to="/ai?tab=insights" replace />} />
      <Route path="/ai-chat" element={<Navigate to="/ai?tab=copilot" replace />} />
      <Route path="/ai-token-analytics" element={<Navigate to="/ai?tab=usage" replace />} />
      <Route path="/analytics" element={<ProtectedRoute><Layout><Analytics /></Layout></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Layout><Settings /></Layout></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Layout><Profile /></Layout></ProtectedRoute>} />
      <Route path="/about" element={<ProtectedRoute><Layout><About /></Layout></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
