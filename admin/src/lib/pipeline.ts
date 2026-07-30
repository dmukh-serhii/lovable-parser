/**
 * Helpers for shelling out to the local pipeline (crawler + python scripts).
 * These only ever run on the local machine (the deployed read-only Worker
 * has no write DB creds and returns 501 before reaching them). The
 * `child_process` import is dynamic so this module can still be bundled for
 * Cloudflare Workers, where `child_process` does not exist.
 */
import { PROJECT_ROOT } from "./db";

export const PYTHON =
  process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");

async function spawnFn() {
  const { spawn } = await import("node:child_process");
  return spawn;
}

export async function runCapture(
  cmd: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const spawn = await spawnFn();
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: PROJECT_ROOT,
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/**
 * Spawn a pipeline step and forward each output line to `onLine`.
 * Carriage-return progress updates (the crawler uses \r bars) are split
 * like newlines so the log view sees them as discrete lines.
 */
export async function runStreaming(
  cmd: string,
  args: string[],
  onLine: (line: string) => void,
  signal?: AbortSignal,
  extraEnv?: Record<string, string>
): Promise<number> {
  const spawn = await spawnFn();
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: PROJECT_ROOT,
      shell: false,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONIOENCODING: "utf-8",
        FORCE_COLOR: "0",
        ...extraEnv,
      },
    });

    const abort = () => child.kill();
    signal?.addEventListener("abort", abort, { once: true });

    let buf = "";
    const feed = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const parts = buf.split(/\r\n|\n|\r/);
      buf = parts.pop() ?? "";
      for (const line of parts) {
        if (line.trim()) onLine(line);
      }
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("error", (err) => {
      signal?.removeEventListener("abort", abort);
      reject(err);
    });
    child.on("close", (code) => {
      if (buf.trim()) onLine(buf);
      signal?.removeEventListener("abort", abort);
      resolve(code ?? -1);
    });
  });
}
