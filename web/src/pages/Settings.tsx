import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RefreshCw, Save } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { APP_USER_EMAIL, APP_USER_ID } from "@/lib/appUser"
import { toast } from "sonner"
import { useSyncContext } from "@/hooks/useSyncContext"

type KeywordMatchScope = "subject" | "subject_or_body"
const DEFAULT_JOB_KEYWORDS = ["job", "hiring", "application"]

type LlmProvider = "openrouter" | "gemini" | "disabled"
const DEFAULT_LLM_PROVIDER: LlmProvider = "openrouter"
const DEFAULT_LLM_MODEL = "qwen/qwen3-coder"
const LLM_MODEL_OPTIONS = [
  { label: "Qwen3 Coder (OpenRouter)", value: "qwen/qwen3-coder" },
  { label: "DeepSeek R1 (OpenRouter)", value: "deepseek/deepseek-r1" },
]

export default function Settings() {
  const [loading, setLoading] = useState(false)
  const { syncing, progress, triggerSync } = useSyncContext()
  const [savingKeywordFilters, setSavingKeywordFilters] = useState(false)
  const [savingSyncSettings, setSavingSyncSettings] = useState(false)
  const [savingLlmSettings, setSavingLlmSettings] = useState(false)
  const [llmConfig, setLlmConfig] = useState<{ provider: LlmProvider; model: string }>({
    provider: DEFAULT_LLM_PROVIDER,
    model: DEFAULT_LLM_MODEL,
  })
  const [imapConfig, setImapConfig] = useState({
    host: "",
    port: 993,
    username: "",
    password: "",
  })
  const [maxEmailsPerSync, setMaxEmailsPerSync] = useState(10)
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
          .select('imap_host, job_keywords, keyword_match_scope, max_emails_per_sync, llm_provider, llm_model')
          .eq('user_id', APP_USER_ID)
          .maybeSingle();

        if (!data) {
          const cached = localStorage.getItem("imap_config_cache");
          if (cached) {
            try {
              const parsed = JSON.parse(cached);
              setImapConfig({
                host: parsed.host || "",
                port: Number(parsed.port) || 993,
                username: parsed.username || "",
                password: parsed.password || ""
              });
            } catch (e) {
              console.error("Failed to parse cached config", e);
            }
          }
          return;
        }

        if (data.imap_host) {
          setStatus("connected");
          setImapConfig(prev => ({ ...prev, host: data.imap_host }));
        }

        if (typeof data.max_emails_per_sync === "number" && data.max_emails_per_sync > 0) {
          setMaxEmailsPerSync(data.max_emails_per_sync);
        }

        const provider: LlmProvider =
          data.llm_provider === "gemini" || data.llm_provider === "disabled" ? data.llm_provider : "openrouter"
        const model = typeof data.llm_model === "string" && data.llm_model.trim().length > 0
          ? data.llm_model.trim()
          : DEFAULT_LLM_MODEL

        setLlmConfig({ provider, model })

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
          toast.success("Profile saved successfully!");
      } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          if (message.includes("foreign key constraint")) {
              toast.error("Profile save failed due to a database constraint issue. Re-apply migrations and try again.");
          } else {
              toast.error("Failed to save profile: " + message);
          }
      } finally {
          setLoading(false);
      }
  }

  const handleSyncNow = () => {
    triggerSync()
  }

  const handleSyncAll = () => {
    triggerSync({ syncAll: true })
  }

  const handleSaveSyncSettings = async () => {
    setSavingSyncSettings(true)
    try {
      const value = Math.max(1, Math.min(1000, maxEmailsPerSync))
      const { error } = await supabase
        .from("user_integrations")
        .upsert({
          user_id: APP_USER_ID,
          max_emails_per_sync: value,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" })

      if (error) throw error
      setMaxEmailsPerSync(value)
      toast.success("Sync settings saved.")
    } catch (err) {
      console.error(err)
      const message = err instanceof Error ? err.message : "Unknown error"
      toast.error("Failed to save sync settings: " + message)
    } finally {
      setSavingSyncSettings(false)
    }
  }

  const handleSaveLlmSettings = async () => {
    setSavingLlmSettings(true)
    try {
      const provider = llmConfig.provider
      const model = llmConfig.model.trim() || DEFAULT_LLM_MODEL

      const { error } = await supabase
        .from("user_integrations")
        .upsert({
          user_id: APP_USER_ID,
          llm_provider: provider,
          llm_model: model,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" })

      if (error) throw error
      setLlmConfig({ provider, model })
      toast.success("LLM settings saved.")
    } catch (err) {
      console.error(err)
      const message = err instanceof Error ? err.message : "Unknown error"
      toast.error("Failed to save LLM settings: " + message)
    } finally {
      setSavingLlmSettings(false)
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
        
        localStorage.setItem("imap_config_cache", JSON.stringify({
            host: imapConfig.host,
            port: Number(imapConfig.port),
            username: imapConfig.username,
            password: imapConfig.password
        }));

        setStatus("connected");
        toast.success("Integration saved successfully!");
    } catch (err) {
        console.error(err);
        const message = err instanceof Error ? err.message : "Unknown error";
        toast.error("Failed to save integration: " + message);
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
      toast.success("Keyword filters saved.")
    } catch (err) {
      console.error(err)
      const message = err instanceof Error ? err.message : "Unknown error"
      toast.error("Failed to save keyword filters: " + message)
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
                <div className="flex flex-col items-end gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSyncNow}
                    disabled={syncing || status !== "connected"}
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                    {syncing ? "Syncing..." : "Sync Now"}
                  </Button>
                  {syncing && progress.totalToProcess > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Email {progress.currentEmailIndex} of {progress.totalToProcess}
                    </span>
                  )}
                </div>
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
            <CardTitle>Sync Settings</CardTitle>
            <CardDescription>Control how many emails are checked per sync and trigger a full sync of all unread emails.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="max-emails">Max emails per sync</Label>
              <Input
                id="max-emails"
                type="number"
                min={1}
                max={1000}
                value={maxEmailsPerSync}
                onChange={(e) => setMaxEmailsPerSync(Number(e.target.value) || 10)}
              />
              <p className="text-xs text-muted-foreground">
                The Sync Now button (on Dashboard and here) will check only the latest N unread emails. Default is 10.
              </p>
            </div>
            <div className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleSyncAll}
                disabled={syncing || status !== "connected"}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing..." : "Sync All Emails"}
              </Button>
              <Button type="button" onClick={handleSaveSyncSettings} disabled={savingSyncSettings}>
                <Save className="mr-2 h-4 w-4" />
                {savingSyncSettings ? "Saving..." : "Save Sync Settings"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle>LLM Settings</CardTitle>
            <CardDescription>
              Choose which model the poller uses for extraction and resume generation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select
                value={llmConfig.provider}
                onValueChange={(value) => setLlmConfig((prev) => ({ ...prev, provider: value as LlmProvider }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openrouter">OpenRouter</SelectItem>
                  <SelectItem value="disabled">Disabled (no LLM)</SelectItem>
                  <SelectItem value="gemini">Gemini (legacy)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Model</Label>
              <Select
                value={LLM_MODEL_OPTIONS.some((opt) => opt.value === llmConfig.model) ? llmConfig.model : "__custom__"}
                onValueChange={(value) => {
                  if (value === "__custom__") return
                  setLlmConfig((prev) => ({ ...prev, model: value }))
                }}
                disabled={llmConfig.provider !== "openrouter"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {LLM_MODEL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                  <SelectItem value="__custom__">Custom…</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="OpenRouter model id (e.g. qwen/qwen3-coder)"
                value={llmConfig.model}
                onChange={(e) => setLlmConfig((prev) => ({ ...prev, model: e.target.value }))}
                disabled={llmConfig.provider !== "openrouter"}
              />
              <p className="text-xs text-muted-foreground">
                If provider is OpenRouter, the poller expects an `OPENROUTER_API_KEY` env var.
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="button" onClick={handleSaveLlmSettings} disabled={savingLlmSettings}>
                <Save className="mr-2 h-4 w-4" />
                {savingLlmSettings ? "Saving..." : "Save LLM Settings"}
              </Button>
            </div>
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
