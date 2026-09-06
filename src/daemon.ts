import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PID_FILE = path.join(os.homedir(), '.mcp-sentinel.pid');
const LOG_FILE = path.join(os.homedir(), '.mcp-sentinel.log');
const PROXY_SCRIPT = path.resolve(__dirname, 'proxy.js');

/**
 * Checks if a process with given PID is actively running.
 */
export function isProcessRunning(pid: number): boolean {
  if (process.platform === 'win32') {
    try {
      const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf-8', windowsHide: true });
      return output.includes(pid.toString());
    } catch {
      return false;
    }
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Starts the watchdog in a detached background process (Always-On Watchdog).
 */
export function startDaemon(): void {
  if (fs.existsSync(PID_FILE)) {
    const existingPid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'), 10);
    if (!isNaN(existingPid) && isProcessRunning(existingPid)) {
      console.log(`[MCP Sentinel Watchdog] 🛡️ Watchdog is already running in background (PID: ${existingPid}).`);
      console.log(`[MCP Sentinel Watchdog] Logs: ${LOG_FILE}`);
      return;
    }
  }

  const outStream = fs.openSync(LOG_FILE, 'a');
  const errStream = fs.openSync(LOG_FILE, 'a');

  const child = spawn(process.execPath, [PROXY_SCRIPT, 'watch'], {
    detached: true,
    stdio: ['ignore', outStream, errStream],
    windowsHide: true
  });

  if (child.pid) {
    fs.writeFileSync(PID_FILE, child.pid.toString(), 'utf-8');
    child.unref();
    console.log(`[MCP Sentinel Watchdog] 🚀 Always-On Watchdog started successfully in background!`);
    console.log(`[MCP Sentinel Watchdog] PID: ${child.pid}`);
    console.log(`[MCP Sentinel Watchdog] Log output: ${LOG_FILE}`);
    console.log(`[MCP Sentinel Watchdog] Run 'mcp-sentinel daemon stop' to stop.`);
  } else {
    console.error('[MCP Sentinel Watchdog] Failed to start background daemon.');
  }
}

/**
 * Stops the running background watchdog.
 */
export function stopDaemon(): void {
  if (!fs.existsSync(PID_FILE)) {
    console.log('[MCP Sentinel Watchdog] No active background watchdog found.');
    return;
  }

  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'), 10);
  if (!isNaN(pid) && isProcessRunning(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`[MCP Sentinel Watchdog] 🛑 Stopped background watchdog (PID: ${pid}).`);
    } catch (err: any) {
      console.error(`[MCP Sentinel Watchdog] Failed to stop process ${pid}:`, err.message);
    }
  } else {
    console.log('[MCP Sentinel Watchdog] Watchdog process was not running.');
  }

  try {
    fs.unlinkSync(PID_FILE);
  } catch {}
}

/**
 * Displays status of the background watchdog.
 */
export function statusDaemon(): void {
  if (!fs.existsSync(PID_FILE)) {
    console.log('[MCP Sentinel Watchdog] Status: STOPPED (No background daemon running).');
    return;
  }

  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'), 10);
  if (!isNaN(pid) && isProcessRunning(pid)) {
    console.log(`[MCP Sentinel Watchdog] Status: RUNNING 🟢 (PID: ${pid})`);
    console.log(`[MCP Sentinel Watchdog] Log file: ${LOG_FILE}`);
  } else {
    console.log('[MCP Sentinel Watchdog] Status: STOPPED 🔴 (Stale PID file cleaned).');
    try {
      fs.unlinkSync(PID_FILE);
    } catch {}
  }
}
