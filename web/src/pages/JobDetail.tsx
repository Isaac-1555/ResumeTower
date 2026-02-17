import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowLeft, ExternalLink, Download, CalendarClock, Building2, MapPin, CheckCircle2 } from "lucide-react"
import { Link } from "react-router-dom"
import { cn } from "@/lib/utils"

type JobStatus = "prepared" | "applied" | "rejected" | "interview"

const statusBadgeStyles: Record<JobStatus, string> = {
  prepared: "bg-blue-50 text-blue-700 border-blue-200",
  applied: "bg-yellow-50 text-yellow-700 border-yellow-200",
  interview: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
}

const orderedStatuses: JobStatus[] = ["prepared", "applied", "interview", "rejected"]

export default function JobDetail() {
  const { id } = useParams()
  
  // Mock Job Data (In real app, fetch by ID)
  const job = {
    id: id || "1",
    title: "Senior React Developer",
    company: "TechCorp",
    location: "Remote",
    matchScore: 92,
    status: "prepared" as JobStatus,
    posted: "2 days ago",
    description: "We are looking for a Senior React Developer...",
    link: "https://example.com/job/1",
    skills: ["React", "TypeScript", "Node.js"]
  }
  const [status, setStatus] = useState<JobStatus>(job.status)
  const statusClass = useMemo(() => statusBadgeStyles[status], [status])

  const advanceStatus = () => {
    const currentIndex = orderedStatuses.indexOf(status)
    if (currentIndex < orderedStatuses.length - 1) {
      setStatus(orderedStatuses[currentIndex + 1])
    }
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
              <CardTitle className="text-2xl">{job.title}</CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" />
                  {job.company}
                </span>
                <span>•</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {job.location}
                </span>
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn("capitalize", statusClass)}>
                {status}
              </Badge>
              <Badge variant="outline" className="text-base">
                {job.matchScore}% Match
              </Badge>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border px-3 py-2 text-sm">
              <p className="text-muted-foreground">Posted</p>
              <p className="font-medium inline-flex items-center gap-1">
                <CalendarClock className="h-4 w-4" />
                {job.posted}
              </p>
            </div>
            <div className="rounded-xl border px-3 py-2 text-sm">
              <p className="text-muted-foreground">Company</p>
              <p className="font-medium">{job.company}</p>
            </div>
            <div className="rounded-xl border px-3 py-2 text-sm">
              <p className="text-muted-foreground">Location</p>
              <p className="font-medium">{job.location}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={advanceStatus} className="rounded-xl">
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Advance Status
            </Button>
            <Button variant="outline" className="rounded-xl" asChild>
              <a href={job.link} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                View Original Job
              </a>
            </Button>
            <Button variant="outline" className="rounded-xl">
              <Download className="mr-2 h-4 w-4" />
              Download Application PDF
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6 order-2 xl:order-1">
            <Card className="rounded-2xl shadow-sm">
                <CardHeader>
                    <CardTitle>Job Description</CardTitle>
                    <CardDescription>Parsed content from the source message.</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                        {job.description}
                        {"\n\n"}
                        Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
                    </p>
                </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-sm">
                <CardHeader>
                    <CardTitle>Generated Application</CardTitle>
                    <CardDescription>Tailored resume and cover letter previews.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Tabs defaultValue="resume">
                        <TabsList className="grid w-full grid-cols-2 rounded-xl">
                            <TabsTrigger value="resume">Resume</TabsTrigger>
                            <TabsTrigger value="cover-letter">Cover Letter</TabsTrigger>
                        </TabsList>
                        <TabsContent value="resume" className="mt-4 border rounded-xl p-4 min-h-[320px] sm:min-h-[500px] bg-white text-black shadow-inner">
                            {/* Resume Preview Component would go here */}
                            <div className="flex items-center justify-center h-full text-gray-400">Resume Preview PDF/HTML</div>
                        </TabsContent>
                        <TabsContent value="cover-letter" className="mt-4 border rounded-xl p-4 min-h-[320px] sm:min-h-[500px] bg-white text-black shadow-inner">
                             {/* Cover Letter Preview Component would go here */}
                             <div className="flex items-center justify-center h-full text-gray-400">Cover Letter Preview</div>
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
                        onClick={() => setStatus(candidateStatus)}
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
                        {job.skills.map((skill) => (
                            <Badge key={skill} variant="secondary" className="rounded-full">{skill}</Badge>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
      </div>
    </div>
  )
}
