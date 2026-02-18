import { createContext } from "react"

export type SyncProgress = {
  /** Is a sync currently running? */
  running: boolean
  /** Total emails fetched in Phase 1 (0 until Phase 1 completes) */
  totalToProcess: number
  /** Index of the email currently being processed in Phase 2 */
  currentEmailIndex: number
  /** Cumulative stats from the poller */
  emailsScanned: number
  emailsKeywordMatched: number
  jobsInserted: number
  duplicateJobs: number
  resumesGenerated: number
  resumesFailed: number
  errors: string[]
}

export type SyncContextValue = {
  syncing: boolean
  progress: SyncProgress
  triggerSync: (options?: { syncAll?: boolean }) => Promise<void>
}

export const SyncContext = createContext<SyncContextValue | null>(null)
