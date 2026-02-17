import { BrowserRouter as Router, Routes, Route } from "react-router-dom"
import { Layout } from "@/components/layout/Layout"
import Dashboard from "@/pages/Dashboard"
import Settings from "@/pages/Settings"
import JobDetail from "@/pages/JobDetail"

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="settings" element={<Settings />} />
          <Route path="job/:id" element={<JobDetail />} />
        </Route>
      </Routes>
    </Router>
  )
}

export default App
