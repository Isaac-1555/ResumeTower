import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Search, Filter, Download, ExternalLink, Briefcase } from "lucide-react"
import { Link } from "react-router-dom"

// Mock Data
const MOCK_JOBS = [
  {
    id: "1",
    job_title: "Senior React Developer",
    company: "TechCorp",
    location: "Remote",
    matchScore: 92,
    status: "prepared",
    created_at: "2023-10-25T12:00:00Z",
  },
  {
    id: "2",
    job_title: "Frontend Engineer",
    company: "StartupInc",
    location: "New York, NY",
    matchScore: 85,
    status: "applied",
    created_at: "2023-10-24T12:00:00Z",
  },
  {
    id: "3",
    job_title: "Full Stack Developer",
    company: "Enterprise Solutions",
    location: "San Francisco, CA",
    matchScore: 78,
    status: "rejected",
    created_at: "2023-10-20T12:00:00Z",
  },
  {
    id: "4",
    job_title: "Software Engineer",
    company: "Google",
    location: "Mountain View, CA",
    matchScore: 95,
    status: "interview",
    created_at: "2023-10-22T12:00:00Z",
  },
]
type JobRow = {
  id: string
  job_title?: string
  company?: string
  location?: string
  matchScore: number
  status: string
  created_at?: string
  job_link?: string
}

export default function Dashboard() {
  const [searchTerm, setSearchTerm] = useState("")
  const [activeTab, setActiveTab] = useState("prepared")
  const [jobs, setJobs] = useState<JobRow[]>(MOCK_JOBS)

  useEffect(() => {
    async function fetchJobs() {
      // Check if Supabase env vars are set properly
      if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) return;
      
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (data) {
          const jobsWithScore = data.map(job => ({
              ...job,
              matchScore: Math.floor(Math.random() * 20) + 80 // Mock score between 80-100
          }))
          setJobs(jobsWithScore);
      }
      if (error) console.error("Error fetching jobs:", error);
    }
    fetchJobs();
  }, [])

  const filteredJobs = jobs.filter(job => 
    (activeTab === "all" || job.status === activeTab) &&
    ((job.job_title?.toLowerCase() || "").includes(searchTerm.toLowerCase()) || 
     (job.company?.toLowerCase() || "").includes(searchTerm.toLowerCase()))
  )
// ... rest of the file using job.job_title instead of job.title, etc.


  const getStatusBadge = (status: string) => {
    switch (status) {
      case "prepared": return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Prepared</Badge>
      case "applied": return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">Applied</Badge>
      case "interview": return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Interview</Badge>
      case "rejected": return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Rejected</Badge>
      default: return <Badge variant="outline">Unknown</Badge>
    }
  }

  const preparedCount = jobs.filter((j) => j.status === "prepared").length
  const appliedCount = jobs.filter((j) => j.status === "applied").length
  const interviewCount = jobs.filter((j) => j.status === "interview").length
  const rejectedCount = jobs.filter((j) => j.status === "rejected").length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Track parsed opportunities and manage application status.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardDescription>Prepared</CardDescription>
            <CardTitle className="text-2xl">{preparedCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardDescription>Applied</CardDescription>
            <CardTitle className="text-2xl">{appliedCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardDescription>Interviews</CardDescription>
            <CardTitle className="text-2xl">{interviewCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardDescription>Rejected</CardDescription>
            <CardTitle className="text-2xl">{rejectedCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search jobs..."
            className="pl-8"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Button variant="outline" size="icon" className="rounded-xl">
            <Filter className="h-4 w-4" />
        </Button>
      </div>

      <Tabs defaultValue="prepared" className="space-y-4" onValueChange={setActiveTab}>
        <TabsList className="rounded-xl w-full justify-start overflow-x-auto whitespace-nowrap">
          <TabsTrigger value="prepared">Prepared</TabsTrigger>
          <TabsTrigger value="applied">Applied</TabsTrigger>
          <TabsTrigger value="interview">Interviews</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
          <TabsTrigger value="all">All Jobs</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="space-y-4">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle>Job Applications</CardTitle>
              <CardDescription>Manage your job search pipeline.</CardDescription>
            </CardHeader>
            <CardContent>
              {filteredJobs.length === 0 ? (
                <div className="text-center h-24 flex items-center justify-center text-muted-foreground">
                  No jobs found.
                </div>
              ) : (
                <>
                  <div className="md:hidden space-y-3">
                    {filteredJobs.map((job) => (
                      <Card key={job.id} className="rounded-xl border">
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium leading-tight">{job.job_title}</p>
                              <p className="text-sm text-muted-foreground">{job.company} • {job.location}</p>
                            </div>
                            <Badge variant={job.matchScore > 80 ? "default" : "secondary"}>
                              {job.matchScore}%
                            </Badge>
                          </div>
                          <div>{getStatusBadge(job.status)}</div>
                          <div className="flex items-center gap-2">
                            <Button asChild variant="outline" size="sm" className="rounded-lg">
                              <Link to={`/job/${job.id}`}>Open</Link>
                            </Button>
                            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => window.open(job.job_link || `/job/${job.id}`, "_blank")}>
                              <ExternalLink className="h-4 w-4 mr-1" />
                              Source
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Job Title</TableHead>
                          <TableHead>Company</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead>Match</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredJobs.map((job) => (
                          <TableRow key={job.id}>
                            <TableCell className="font-medium">
                                <div className="flex items-center space-x-2">
                                    <Briefcase className="h-4 w-4 text-muted-foreground" />
                                    <Link to={`/job/${job.id}`} className="hover:underline">
                                        <span>{job.job_title}</span>
                                    </Link>
                                </div>
                            </TableCell>
                            <TableCell>{job.company}</TableCell>
                            <TableCell>{job.location}</TableCell>
                            <TableCell>
                                <Badge variant={job.matchScore > 80 ? "default" : "secondary"}>
                                    {job.matchScore}%
                                </Badge>
                            </TableCell>
                            <TableCell>{getStatusBadge(job.status)}</TableCell>
                            <TableCell className="text-right space-x-2">
                              <Button variant="ghost" size="icon" title="View Job" onClick={() => window.open(job.job_link || `/job/${job.id}`, '_blank')}>
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" title="Download Resume">
                                <Download className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
