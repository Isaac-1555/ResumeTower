import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const thisFile = fileURLToPath(import.meta.url)
const scriptsDir = dirname(thisFile)
const webDir = dirname(scriptsDir)
const repoDir = dirname(webDir)
const pollerDir = resolve(repoDir, "scripts")
const functionsEnvPath = resolve(repoDir, "supabase/functions/.env")

function parseEnvFile(path) {
  if (!existsSync(path)) return {}

  const content = readFileSync(path, "utf-8")
  const parsed = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue

    const separatorIndex = line.indexOf("=")
    if (separatorIndex === -1) continue

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    parsed[key] = value
  }

  return parsed
}

const fileEnv = parseEnvFile(functionsEnvPath)
const pollerEnv = { ...process.env, ...fileEnv }

if (!pollerEnv.IMAP_SECRET_KEY) {
  console.warn(
    "[dev] IMAP_SECRET_KEY not found in process env or supabase/functions/.env. Poller may fail to decrypt credentials.",
  )
}

let shuttingDown = false

const pollerProcess = spawn("npm", ["--prefix", pollerDir, "start"], {
  env: pollerEnv,
  stdio: "inherit",
})

const webProcess = spawn("npm", ["run", "dev:web"], {
  cwd: webDir,
  env: process.env,
  stdio: "inherit",
})

function stopChild(child, signal) {
  if (!child || child.exitCode !== null || child.killed) return
  child.kill(signal)
}

function shutdown(signal = "SIGTERM") {
  if (shuttingDown) return
  shuttingDown = true

  stopChild(webProcess, signal)
  stopChild(pollerProcess, signal)

  setTimeout(() => {
    stopChild(webProcess, "SIGKILL")
    stopChild(pollerProcess, "SIGKILL")
    process.exit(0)
  }, 1500).unref()
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))

pollerProcess.on("exit", (code, signal) => {
  if (shuttingDown) return
  console.error(
    `[dev] IMAP poller exited unexpectedly (${signal ?? code ?? "unknown"}). Stopping web dev server.`,
  )
  shutdown("SIGTERM")
  process.exit(code ?? 1)
})

webProcess.on("exit", (code, signal) => {
  if (shuttingDown) return
  console.log(
    `[dev] Web dev server exited (${signal ?? code ?? "unknown"}). Stopping IMAP poller.`,
  )
  shutdown("SIGTERM")
  process.exit(code ?? 0)
})
