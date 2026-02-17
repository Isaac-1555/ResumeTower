import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Search, Filter, Download, ExternalLink, Briefcase } from "lucide-react"

type JobStatus = "prepared" | "applied" | "interview" | "rejected"

type ResumeRow = {
  resume_pdf_url?: string | null
  created_at?: string | null
}

type JobRow = {
  id: string
  job_title?: string | null
  company?: string | null
  location?: string | null
  status: string
  created_at?: string | null
  job_link?: string | null
  posting_url?: string | null
  apply_url?: string | null
  extracted_skills?: string[] | null
  resumes?: ResumeRow[] | null
  matchScore: number
  latest_resume_pdf_url?: string | null
}

const STATUS_TABS: Array<{ label: string; value: string }> = [
  { label: "Prepared", value: "prepared" },
  { label: "Applied", value: "applied" },
  { label: "Interviews", value: "interview" },
  { label: "Rejected", value: "rejected" },
  { label: "All Jobs", value: "all" },
]

const normalizeStatus = (value: string): JobStatus | "unknown" => {
  if (value === "prepared" || value === "applied" || value === "interview" || value === "rejected") {
    return value
  }
  return "unknown"
}

const computeMatchScore = (skills: unknown): number => {
  if (!Array.isArray(skills)) return 78
  const count = skills.filter((skill) => typeof skill === "string" && skill.trim().length > 0).length
  return Math.min(99, 70 + count * 4)
}

const getLatestResumePdfUrl = (resumes: ResumeRow[] | null | undefined): string | null => {
  if (!Array.isArray(resumes) || resumes.length === 0) return null
  const sorted = [...resumes].sort((a, b) => {
    const aTs = a.created_at ? new Date(a.created_at).getTime() : 0
    const bTs = b.created_at ? new Date(b.created_at).getTime() : 0
    return bTs - aTs
  })
  return sorted[0]?.resume_pdf_url || null
}

const getOutboundJobLink = (job: JobRow): string | null => {
  return job.apply_url || job.posting_url || job.job_link || null
}

export default function Dashboard() {
  const [searchTerm, setSearchTerm] = useState("")
  const [activeTab, setActiveTab] = useState("prepared")
  const [jobs, setJobs] = useState<JobRow[]>([])

  useEffect(() => {
    async function fetchJobs() {
      if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) return

      const { data, error } = await supabase
        .from("jobs")
        .select("*, resumes(resume_pdf_url, created_at)")
        .order("created_at", { ascending: false })

      if (error) {
        console.error("Error fetching jobs:", error)
        return
      }

      const normalized: JobRow[] = (data || []).map((job) => ({
        ...job,
        matchScore: computeMatchScore(job.extracted_skills),
        latest_resume_pdf_url: getLatestResumePdfUrl(job.resumes),
      }))
      setJobs(normalized)
    }

    fetchJobs()
  }, [])

  const filteredJobs = useMemo(() => {
    const needle = searchTerm.toLowerCase()
    return jobs.filter((job) => {
      const matchesTab = activeTab === "all" || job.status === activeTab
      const title = (job.job_title || "").toLowerCase()
      const company = (job.company || "").toLowerCase()
      const matchesSearch = title.includes(needle) || company.includes(needle)
      return matchesTab && matchesSearch
    })
  }, [jobs, activeTab, searchTerm])

  const getStatusBadge = (status: string) => {
    switch (normalizeStatus(status)) {
      case "prepared":
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Prepared</Badge>
      case "applied":
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">Applied</Badge>
      case "interview":
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Interview</Badge>
      case "rejected":
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Rejected</Badge>
      default:
        return <Badge variant="outline">Unknown</Badge>
    }
  }

  const preparedCount = jobs.filter((job) => job.status === "prepared").length
  const appliedCount = jobs.filter((job) => job.status === "applied").length
  const interviewCount = jobs.filter((job) => job.status === "interview").length
  const rejectedCount = jobs.filter((job) => job.status === "rejected").length

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
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>
        <Button variant="outline" size="icon" className="rounded-xl" type="button" disabled>
          <Filter className="h-4 w-4" />
        </Button>
      </div>

      <Tabs defaultValue="prepared" className="space-y-4" onValueChange={setActiveTab}>
        <TabsList className="rounded-xl w-full justify-start overflow-x-auto whitespace-nowrap">
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>
          ))}
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
                    {filteredJobs.map((job) => {
                      const outboundLink = getOutboundJobLink(job)
                      const resumePdfUrl = job.latest_resume_pdf_url
                      return (
                        <Card key={job.id} className="rounded-xl border">
                          <CardContent className="p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium leading-tight">{job.job_title || "Untitled role"}</p>
                                <p className="text-sm text-muted-foreground">{job.company || "Unknown company"} • {job.location || "Unknown"}</p>
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
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-lg"
                                type="button"
                                disabled={!outboundLink}
                                onClick={() => outboundLink && window.open(outboundLink, "_blank", "noopener,noreferrer")}
                              >
                                <ExternalLink className="h-4 w-4 mr-1" />
                                Apply
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-lg"
                                type="button"
                                disabled={!resumePdfUrl}
                                onClick={() => resumePdfUrl && window.open(resumePdfUrl, "_blank", "noopener,noreferrer")}
                              >
                                <Download className="h-4 w-4 mr-1" />
                                Resume
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
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
                        {filteredJobs.map((job) => {
                          const outboundLink = getOutboundJobLink(job)
                          const resumePdfUrl = job.latest_resume_pdf_url
                          return (
                            <TableRow key={job.id}>
                              <TableCell className="font-medium">
                                <div className="flex items-center space-x-2">
                                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                                  <Link to={`/job/${job.id}`} className="hover:underline">
                                    <span>{job.job_title || "Untitled role"}</span>
                                  </Link>
                                </div>
                              </TableCell>
                              <TableCell>{job.company || "Unknown company"}</TableCell>
                              <TableCell>{job.location || "Unknown"}</TableCell>
                              <TableCell>
                                <Badge variant={job.matchScore > 80 ? "default" : "secondary"}>
                                  {job.matchScore}%
                                </Badge>
                              </TableCell>
                              <TableCell>{getStatusBadge(job.status)}</TableCell>
                              <TableCell className="text-right space-x-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Open apply/source link"
                                  type="button"
                                  disabled={!outboundLink}
                                  onClick={() => outboundLink && window.open(outboundLink, "_blank", "noopener,noreferrer")}
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Download resume PDF"
                                  type="button"
                                  disabled={!resumePdfUrl}
                                  onClick={() => resumePdfUrl && window.open(resumePdfUrl, "_blank", "noopener,noreferrer")}
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          )
                        })}
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
