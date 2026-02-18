import { BrowserRouter as Router, Routes, Route } from "react-router-dom"
import { Layout } from "@/components/layout/Layout"
import Dashboard from "@/pages/Dashboard"
import Settings from "@/pages/Settings"
import JobDetail from "@/pages/JobDetail"
import { Toaster } from "@/components/ui/sonner"
import { SyncProvider } from "@/contexts/SyncContext"

function App() {
  return (
    <Router>
      <SyncProvider>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="settings" element={<Settings />} />
            <Route path="job/:id" element={<JobDetail />} />
          </Route>
        </Routes>
        <Toaster />
      </SyncProvider>
    </Router>
  )
}

export default App
