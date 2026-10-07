import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout } from "node:timers";
import { URL, fileURLToPath } from "node:url";
import process from "node:process";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const processes = new Map();
let stopping = false;
let exitCode = 0;

function signalChildren(signal) {
  for (const child of processes.values()) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  }
}

function stop(signal, code = 0) {
  if (stopping) {
    return;
  }
  stopping = true;
  exitCode = code;
  signalChildren(signal);

  const forceStop = setTimeout(() => signalChildren("SIGTERM"), 5_000);
  forceStop.unref();
}

function start(name, args) {
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: true,
  });
  processes.set(name, child);
  const stdout = createInterface({ input: child.stdout });
  const stderr = createInterface({ input: child.stderr });
  stdout.on("line", (line) => process.stdout.write(`[${name}] ${line}\n`));
  stderr.on("line", (line) => process.stderr.write(`[${name}] ${line}\n`));
  child.on("error", (error) => {
    processes.delete(name);
    process.stderr.write(`[${name}] Başlatılamadı: ${error.message}\n`);
    stop(process.platform === "win32" ? "SIGINT" : "SIGTERM", 1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      stop(process.platform === "win32" ? "SIGINT" : "SIGTERM", code ?? 1);
    }
    if (signal && exitCode === 0) {
      exitCode = 1;
    }
  });
  child.on("close", () => {
    stdout.close();
    stderr.close();
    processes.delete(name);
  });
}

process.once("SIGINT", () => stop("SIGINT", 130));
process.once("SIGTERM", () => stop("SIGTERM", 143));

start("API", [
  "--env-file-if-exists=.env",
  "--import",
  "tsx",
  "--watch",
  "apps/api/src/server.ts",
]);
start("WEB", [
  "node_modules/vite/bin/vite.js",
  "apps/web",
  "--host",
  "127.0.0.1",
  "--port",
  "5173",
  "--strictPort",
]);
