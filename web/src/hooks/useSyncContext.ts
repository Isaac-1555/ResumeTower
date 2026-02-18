import { useContext } from "react"
import { SyncContext } from "@/contexts/syncContextDef"

export function useSyncContext() {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error("useSyncContext must be used within SyncProvider")
  return ctx
}
