import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowLeft, ExternalLink, Download, CalendarClock, Building2, MapPin, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"

type JobStatus = "prepared" | "applied" | "rejected" | "interview"

type JobRecord = {
  id: string
  job_title?: string | null
  company?: string | null
  location?: string | null
  status: string
  created_at?: string | null
  description?: string | null
  extracted_skills?: string[] | null
  job_link?: string | null
  posting_url?: string | null
  apply_url?: string | null
}

type ResumeRecord = {
  resume_pdf_url?: string | null
  resume_json?: unknown
  created_at?: string | null
}

const statusBadgeStyles: Record<JobStatus, string> = {
  prepared: "bg-blue-50 text-blue-700 border-blue-200",
  applied: "bg-yellow-50 text-yellow-700 border-yellow-200",
  interview: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
}

const orderedStatuses: JobStatus[] = ["prepared", "applied", "interview", "rejected"]

const coerceStatus = (value: string): JobStatus => {
  if (value === "applied" || value === "rejected" || value === "interview") return value
  return "prepared"
}

export default function JobDetail() {
  const { id } = useParams()
  const [job, setJob] = useState<JobRecord | null>(null)
  const [status, setStatus] = useState<JobStatus>("prepared")
  const [resume, setResume] = useState<ResumeRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    async function fetchData() {
      if (!id) {
        setErrorMessage("Missing job ID.")
        setLoading(false)
        return
      }

      setLoading(true)
      setErrorMessage(null)

      const [{ data: jobData, error: jobError }, { data: resumeData, error: resumeError }] = await Promise.all([
        supabase.from("jobs").select("*").eq("id", id).maybeSingle(),
        supabase
          .from("resumes")
          .select("resume_pdf_url, resume_json, created_at")
          .eq("job_id", id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

      if (jobError || !jobData) {
        setErrorMessage(jobError?.message || "Job not found.")
        setLoading(false)
        return
      }

      if (resumeError) {
        console.error("Failed to fetch resume for job", id, resumeError)
      }

      setJob(jobData as JobRecord)
      setStatus(coerceStatus(jobData.status))
      setResume((resumeData || null) as ResumeRecord | null)
      setLoading(false)
    }

    fetchData()
  }, [id])

  const statusClass = useMemo(() => statusBadgeStyles[status], [status])

  const applyLink = useMemo(() => {
    if (!job) return null
    return job.apply_url || job.posting_url || job.job_link || null
  }, [job])

  const skills = useMemo(() => {
    if (!job?.extracted_skills || !Array.isArray(job.extracted_skills)) return []
    return job.extracted_skills.filter((value) => typeof value === "string" && value.trim().length > 0)
  }, [job])

  const postedLabel = useMemo(() => {
    if (!job?.created_at) return "Unknown"
    return new Date(job.created_at).toLocaleString()
  }, [job])

  const updateStatus = async (nextStatus: JobStatus) => {
    if (!job || updatingStatus) return
    const previous = status
    setStatus(nextStatus)
    setUpdatingStatus(true)

    const updates: { status: JobStatus; applied_at?: string | null } = { status: nextStatus }
    if (nextStatus === "applied") {
      updates.applied_at = new Date().toISOString()
    }

    const { error } = await supabase
      .from("jobs")
      .update(updates)
      .eq("id", job.id)

    if (error) {
      console.error("Failed to update job status", error)
      setStatus(previous)
      alert(`Failed to update status: ${error.message}`)
    } else {
      setJob((current) => (current ? { ...current, status: nextStatus } : current))
    }

    setUpdatingStatus(false)
  }

  const advanceStatus = () => {
    const currentIndex = orderedStatuses.indexOf(status)
    if (currentIndex < orderedStatuses.length - 1) {
      void updateStatus(orderedStatuses[currentIndex + 1])
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle>Loading job…</CardTitle>
            <CardDescription>Please wait while we fetch the job details.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (errorMessage || !job) {
    return (
      <div className="space-y-6">
        <Link to="/">
          <Button variant="ghost" className="rounded-xl">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </Link>
        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle>Unable to load job</CardTitle>
            <CardDescription>{errorMessage || "Unknown error."}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/">
          <Button variant="ghost" className="rounded-xl">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </Link>
      </div>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-2xl">{job.job_title || "Untitled role"}</CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" />
                  {job.company || "Unknown company"}
                </span>
                <span>•</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {job.location || "Unknown"}
                </span>
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn("capitalize", statusClass)}>
                {status}
              </Badge>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border px-3 py-2 text-sm">
              <p className="text-muted-foreground">Ingested</p>
              <p className="font-medium inline-flex items-center gap-1">
                <CalendarClock className="h-4 w-4" />
                {postedLabel}
              </p>
            </div>
            <div className="rounded-xl border px-3 py-2 text-sm">
              <p className="text-muted-foreground">Company</p>
              <p className="font-medium">{job.company || "Unknown company"}</p>
            </div>
            <div className="rounded-xl border px-3 py-2 text-sm">
              <p className="text-muted-foreground">Location</p>
              <p className="font-medium">{job.location || "Unknown"}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={advanceStatus} className="rounded-xl" disabled={updatingStatus}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {updatingStatus ? "Updating…" : "Advance Status"}
            </Button>
            <Button variant="outline" className="rounded-xl" asChild disabled={!applyLink}>
              <a href={applyLink || "#"} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Open Job / Apply Link
              </a>
            </Button>
            <Button
              variant="outline"
              className="rounded-xl"
              type="button"
              disabled={!resume?.resume_pdf_url}
              onClick={() => resume?.resume_pdf_url && window.open(resume.resume_pdf_url, "_blank", "noopener,noreferrer")}
            >
              <Download className="mr-2 h-4 w-4" />
              Download Resume PDF
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6 order-2 xl:order-1">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle>Job Description</CardTitle>
              <CardDescription>Parsed content from the source email and linked posting.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {job.description || "No description available."}
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle>Generated Application</CardTitle>
              <CardDescription>Tailored resume artifacts generated for this role.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="resume">
                <TabsList className="grid w-full grid-cols-2 rounded-xl">
                  <TabsTrigger value="resume">Resume</TabsTrigger>
                  <TabsTrigger value="resume-json">Resume JSON</TabsTrigger>
                </TabsList>
                <TabsContent value="resume" className="mt-4 border rounded-xl p-4 min-h-[320px] sm:min-h-[500px] bg-white text-black shadow-inner">
                  {resume?.resume_pdf_url ? (
                    <iframe
                      title="Generated Resume PDF"
                      src={resume.resume_pdf_url}
                      className="w-full h-[480px] rounded-md border"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-400">
                      Resume PDF not generated yet.
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="resume-json" className="mt-4 border rounded-xl p-4 min-h-[320px] sm:min-h-[500px] bg-white text-black shadow-inner">
                  <pre className="text-xs whitespace-pre-wrap break-words overflow-auto h-[460px]">
                    {resume?.resume_json ? JSON.stringify(resume.resume_json, null, 2) : "No generated resume JSON yet."}
                  </pre>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 order-1 xl:order-2">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle>Pipeline Status</CardTitle>
              <CardDescription>Quickly update state as your process changes.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {orderedStatuses.map((candidateStatus) => (
                <Button
                  key={candidateStatus}
                  variant={status === candidateStatus ? "default" : "outline"}
                  className="capitalize rounded-xl"
                  disabled={updatingStatus}
                  onClick={() => void updateStatus(candidateStatus)}
                >
                  {candidateStatus}
                </Button>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle>Keywords</CardTitle>
              <CardDescription>Detected skills and terms for this posting.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {skills.length === 0 ? (
                  <Badge variant="secondary" className="rounded-full">No skills extracted</Badge>
                ) : (
                  skills.map((skill) => (
                    <Badge key={skill} variant="secondary" className="rounded-full">{skill}</Badge>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
