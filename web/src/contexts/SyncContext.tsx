import {
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { toast } from "sonner"
import { SyncContext, type SyncProgress } from "./syncContextDef"

const POLLER_BASE = "http://localhost:54350"
const POLL_INTERVAL_MS = 1_500
const TIMEOUT_MS = 15 * 60 * 1_000 // 15 minutes

const EMPTY_PROGRESS: SyncProgress = {
  running: false,
  totalToProcess: 0,
  currentEmailIndex: 0,
  emailsScanned: 0,
  emailsKeywordMatched: 0,
  jobsInserted: 0,
  duplicateJobs: 0,
  resumesGenerated: 0,
  resumesFailed: 0,
  errors: [],
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<SyncProgress>(EMPTY_PROGRESS)
  const abortRef = useRef<AbortController | null>(null)

  const triggerSync = useCallback(async (options?: { syncAll?: boolean }) => {
    if (syncing) {
      toast.warning("A sync is already in progress.")
      return
    }

    setSyncing(true)
    setProgress({ ...EMPTY_PROGRESS, running: true })
    const controller = new AbortController()
    abortRef.current = controller
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      // Health check
      try {
        const health = await fetch(`${POLLER_BASE}/health`, {
          signal: AbortSignal.timeout(3000),
        })
        if (!health.ok) throw new Error("unhealthy")
      } catch {
        throw new Error(
          "Could not reach the poller server.\n\nIt should start automatically when you run `npm run dev` in `web/`.\nTry restarting the dev server.",
        )
      }

      // Start the poll
      const res = await fetch(`${POLLER_BASE}/poll`, {
        method: "POST",
        headers: options?.syncAll
          ? { "Content-Type": "application/json" }
          : undefined,
        body: options?.syncAll ? JSON.stringify({ syncAll: true }) : undefined,
        signal: controller.signal,
      })

      if (res.status === 409) {
        // Already running on the server — attach to it
        toast.info("A sync is already running on the server. Tracking progress…")
      } else if (res.status !== 202 && !res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `Server returned ${res.status}`)
      }

      // Poll /status until done
      while (true) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        if (controller.signal.aborted) throw new Error("Aborted")

        const statusRes = await fetch(`${POLLER_BASE}/status`, {
          signal: controller.signal,
        })
        if (!statusRes.ok) throw new Error("Failed to check status")
        const status = await statusRes.json()

        const current: SyncProgress = {
          running: !!status.running,
          totalToProcess: status.totalToProcess ?? 0,
          currentEmailIndex: status.currentEmailIndex ?? 0,
          emailsScanned: status.emailsScanned ?? 0,
          emailsKeywordMatched: status.emailsKeywordMatched ?? 0,
          jobsInserted: status.jobsInserted ?? 0,
          duplicateJobs: status.duplicateJobs ?? 0,
          resumesGenerated: status.resumesGenerated ?? 0,
          resumesFailed: status.resumesFailed ?? 0,
          errors: Array.isArray(status.errors) ? status.errors : [],
        }
        setProgress(current)

        if (!current.running) {
          // Done
          const errs = current.errors
          if (errs.length > 0) {
            toast.error("Sync completed with errors", {
              description: errs.join("\n"),
              duration: 8000,
            })
          } else if (current.jobsInserted > 0) {
            toast.success(
              `Sync complete: imported ${current.jobsInserted} new job${current.jobsInserted === 1 ? "" : "s"}.`,
              { duration: 6000 },
            )
          } else {
            toast.info("Sync complete: no new matching emails found.")
          }
          break
        }
      }
    } catch (err) {
      console.error(err)
      if (controller.signal.aborted) {
        toast.error(
          "Sync timed out after 15 minutes. The poller may still be processing in the background.",
          { duration: 8000 },
        )
      } else {
        const message = err instanceof Error ? err.message : "Unknown error"
        toast.error("Sync failed: " + message, { duration: 8000 })
      }
    } finally {
      clearTimeout(timeoutId)
      abortRef.current = null
      setSyncing(false)
    }
  }, [syncing])

  return (
    <SyncContext.Provider value={{ syncing, progress, triggerSync }}>
      {children}
    </SyncContext.Provider>
  )
}
