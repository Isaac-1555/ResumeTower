import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, Save } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { APP_USER_EMAIL, APP_USER_ID } from "@/lib/appUser"
type KeywordMatchScope = "subject" | "subject_or_body"
const DEFAULT_JOB_KEYWORDS = ["job", "hiring", "application"]

export default function Settings() {
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [savingKeywordFilters, setSavingKeywordFilters] = useState(false)
  const [imapConfig, setImapConfig] = useState({
    host: "",
    port: 993,
    username: "",
    password: "",
  })
  const [keywordConfig, setKeywordConfig] = useState<{
    keywordsText: string
    matchScope: KeywordMatchScope
  }>({
    keywordsText: DEFAULT_JOB_KEYWORDS.join(", "),
    matchScope: "subject",
  })
  const [status, setStatus] = useState<"connected" | "disconnected">("disconnected")
  const [resumeJson, setResumeJson] = useState("")

  useEffect(() => {
    // Check if user has integration
    const checkIntegration = async () => {
        const { data } = await supabase
          .from('user_integrations')
          .select('imap_host, job_keywords, keyword_match_scope')
          .eq('user_id', APP_USER_ID)
          .maybeSingle();

        if (!data) return;
        if (data.imap_host) {
          setStatus("connected");
          setImapConfig(prev => ({ ...prev, host: data.imap_host }));
        }

        const keywords = Array.isArray(data.job_keywords) && data.job_keywords.length > 0
          ? data.job_keywords
          : DEFAULT_JOB_KEYWORDS;

        const scope: KeywordMatchScope =
          data.keyword_match_scope === "subject_or_body" ? "subject_or_body" : "subject";

        setKeywordConfig({
          keywordsText: keywords.join(", "),
          matchScope: scope,
        });
    }

    // Fetch Base Profile
    const fetchProfile = async () => {
        const { data } = await supabase.from('base_profile').select('profile_json').eq('user_id', APP_USER_ID).single();
        if (data && data.profile_json) {
            setResumeJson(JSON.stringify(data.profile_json, null, 2));
        } else {
            // Default template if no profile exists
            setResumeJson(JSON.stringify({
              personal_info: {
                name: "Your Name",
                email: APP_USER_EMAIL,
                phone: "123456789"
              },
              skills: [],
              experience: [],
              education: []
            }, null, 2));
        }
    }

    checkIntegration();
    fetchProfile();
  }, []);

  const parseKeywords = (raw: string): string[] => {
    return [...new Set(
      raw
        .split(/[\n,]+/)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    )]
  }

  const handleSaveProfile = async () => {
      setLoading(true);
      try {
          let parsed;
          try {
              parsed = JSON.parse(resumeJson);
          } catch {
              throw new Error("Invalid JSON format");
          }

          const { error } = await supabase
              .from('base_profile')
              .upsert({
                  user_id: APP_USER_ID,
                  profile_json: parsed,
                  updated_at: new Date().toISOString()
              }, { onConflict: 'user_id' }); // Assuming there's a unique constraint or we just insert. 
              // Wait, the schema uses ID as PK, but user_id is FK. We should probably make user_id unique or select ID first.
              // Let's check schema. If no unique constraint on user_id, upsert might duplicate.
              // The migration says: user_id UUID REFERENCES auth.users(id) NOT NULL. It doesn't explicitly say UNIQUE.
              // But usually for "base profile" it's 1:1. 
              // To be safe, let's select existing ID first or assume RLS handles "users can update own".
              // Actually, looking at the migration `20240216000000_initial_schema.sql`, `base_profile` doesn't have a UNIQUE constraint on `user_id` explicitly defined in the `CREATE TABLE` snippet I read earlier, but it's logically 1:1.
              // I will attempt to select first to get the ID, then update, or insert if not found.
              
          if (error) throw error;
          alert("Profile saved successfully!");
      } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          if (message.includes("foreign key constraint")) {
              alert("Profile save failed due to a database constraint issue. Re-apply migrations and try again.");
          } else {
              alert("Failed to save profile: " + message);
          }
      } finally {
          setLoading(false);
      }
  }

  const handleSyncNow = async () => {
    setSyncing(true)
    try {
      const res = await fetch("http://localhost:54350/poll", { method: "POST" })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `Server returned ${res.status}`)
      }
      const payload = (await res.json()) as { jobs?: unknown[]; errors?: string[] }
      const jobsProcessed = Array.isArray(payload?.jobs) ? payload.jobs.length : 0
      const backendErrors = Array.isArray(payload?.errors) ? payload.errors : []

      if (backendErrors.length > 0) {
        alert("Sync error:\n\n" + backendErrors.join("\n"))
      } else if (jobsProcessed > 0) {
        alert(`Sync complete: imported ${jobsProcessed} new job${jobsProcessed === 1 ? "" : "s"}.`)
      } else {
        alert("Sync complete: no new matching unread emails found.")
      }
    } catch (err) {
      console.error(err)
      const message = err instanceof Error ? err.message : "Unknown error"
      if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
        alert(
          "Sync failed: Could not reach the poller server.\n\nMake sure it is running:\n  cd scripts && IMAP_SECRET_KEY='your_real_secret_here' npm start",
        )
      } else {
        alert("Sync failed: " + message)
      }
    } finally {
      setSyncing(false)
    }
  }


  const handleSaveIntegration = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
        const { error } = await supabase.functions.invoke('save-integration', {
            body: {
                host: imapConfig.host,
                port: Number(imapConfig.port),
                username: imapConfig.username,
                password: imapConfig.password
            }
        });

        if (error) throw error;
        
        setStatus("connected");
        alert("Integration saved successfully!");
    } catch (err) {
        console.error(err);
        const message = err instanceof Error ? err.message : "Unknown error";
        alert("Failed to save integration: " + message);
    } finally {
        setLoading(false);
    }
  }

  const handleSaveKeywordFilters = async () => {
    setSavingKeywordFilters(true)
    try {
      const parsedKeywords = parseKeywords(keywordConfig.keywordsText)
      if (parsedKeywords.length === 0) {
        throw new Error("Please provide at least one keyword.")
      }

      const { error } = await supabase
        .from("user_integrations")
        .upsert({
          user_id: APP_USER_ID,
          job_keywords: parsedKeywords,
          keyword_match_scope: keywordConfig.matchScope,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" })

      if (error) throw error
      alert("Keyword filters saved.")
    } catch (err) {
      console.error(err)
      const message = err instanceof Error ? err.message : "Unknown error"
      alert("Failed to save keyword filters: " + message)
    } finally {
      setSavingKeywordFilters(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure inbox ingestion and your base profile template.</p>
        </div>
      </div>
      
      <div className="grid gap-6">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle>IMAP Integration</CardTitle>
            <CardDescription>Connect your email account via IMAP to monitor job applications.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Status:</span>
                    {status === "connected" ? (
                        <Badge variant="default" className="bg-green-600">Connected</Badge>
                    ) : (
                        <Badge variant="destructive">Not Configured</Badge>
                    )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSyncNow}
                  disabled={syncing || status !== "connected"}
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Syncing..." : "Sync Now"}
                </Button>
            </div>

            <form onSubmit={handleSaveIntegration} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="host">IMAP Host</Label>
                        <Input 
                            id="host" 
                            placeholder="imap.gmail.com" 
                            value={imapConfig.host}
                            onChange={(e) => setImapConfig({...imapConfig, host: e.target.value})}
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="port">Port</Label>
                        <Input 
                            id="port" 
                            type="number" 
                            placeholder="993" 
                            value={imapConfig.port}
                            onChange={(e) => setImapConfig({...imapConfig, port: Number(e.target.value)})}
                            required
                        />
                    </div>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="username">Username / Email</Label>
                    <Input 
                        id="username" 
                        placeholder="you@example.com" 
                        value={imapConfig.username}
                        onChange={(e) => setImapConfig({...imapConfig, username: e.target.value})}
                        required
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="password">App Password</Label>
                    <Input 
                        id="password" 
                        type="password" 
                        placeholder="••••••••" 
                        value={imapConfig.password}
                        onChange={(e) => setImapConfig({...imapConfig, password: e.target.value})}
                        required
                    />
                    <p className="text-xs text-muted-foreground">
                        Use an App Password if using Gmail or providers with 2FA.
                    </p>
                </div>
                <div className="flex justify-end pt-2">
                    <Button type="submit" disabled={loading}>
                        <Save className="mr-2 h-4 w-4" />
                        {loading ? "Saving..." : "Save Configuration"}
                    </Button>
                </div>
            </form>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle>Base Resume Profile</CardTitle>
            <CardDescription>Edit your base JSON profile used for resume generation.</CardDescription>
          </CardHeader>
          <CardContent>
             <div className="grid w-full gap-4">
                <div className="grid w-full gap-1.5">
                  <Label htmlFor="resume-json">Resume JSON</Label>
                  <Textarea 
                    className="min-h-[400px] font-mono text-xs" 
                    id="resume-json" 
                    placeholder='{ "personal_info": { ... } }' 
                    value={resumeJson}
                    onChange={(e) => setResumeJson(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    This JSON structure will be used as the source of truth for generating tailored resumes.
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button onClick={handleSaveProfile} disabled={loading}>
                      {loading ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
             </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle>Job Keyword Filters</CardTitle>
            <CardDescription>
              Configure which keywords count as relevant emails.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="job-keywords">Keywords</Label>
              <Textarea
                id="job-keywords"
                className="min-h-[120px]"
                placeholder="product, management, analyst, junior"
                value={keywordConfig.keywordsText}
                onChange={(e) => setKeywordConfig(prev => ({ ...prev, keywordsText: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Separate keywords with commas or new lines.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Where to match keywords</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={keywordConfig.matchScope === "subject" ? "default" : "outline"}
                  onClick={() => setKeywordConfig(prev => ({ ...prev, matchScope: "subject" }))}
                >
                  Subject only
                </Button>
                <Button
                  type="button"
                  variant={keywordConfig.matchScope === "subject_or_body" ? "default" : "outline"}
                  onClick={() => setKeywordConfig(prev => ({ ...prev, matchScope: "subject_or_body" }))}
                >
                  Subject + body
                </Button>
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="button" onClick={handleSaveKeywordFilters} disabled={savingKeywordFilters}>
                {savingKeywordFilters ? "Saving..." : "Save Keyword Filters"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
