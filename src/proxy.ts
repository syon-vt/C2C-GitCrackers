#!/usr/bin/env node

import { spawn, ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const LIVE_LOG_FILE = path.join(os.homedir(), '.mcp-sentinel-live.log');

/**
 * Appends formatted log entry and optional payload to the live stream log file.
 */
function logLiveTraffic(direction: 'INBOUND' | 'OUTBOUND' | 'BLOCKED' | 'SANITIZED', summary: string, payload?: any): void {
  const timestamp = new Date().toLocaleTimeString();
  const symbol = direction === 'BLOCKED' ? '🛑 [BLOCKED]' : direction === 'SANITIZED' ? '🛡️ [STRIPPED]' : direction === 'OUTBOUND' ? '📤 [CLIENT->SERVER]' : '📥 [SERVER->CLIENT]';
  const payloadStr = payload !== undefined ? ` |||PAYLOAD|||${JSON.stringify(payload)}` : '';
  const entry = `[${timestamp}] ${symbol} ${summary}${payloadStr}\n`;

  try {
    fs.appendFileSync(LIVE_LOG_FILE, entry, 'utf-8');
  } catch {}
}

/**
 * ============================================================================
 * 🛡️ MCP SENTINEL: 4-TIER ZERO-TRUST SECURITY ENGINE
 * ============================================================================
 */

// --- TIER 1: DETERMINISTIC REGEX SIGNATURES (KNOWN SECRETS) ---
const SENSITIVE_PATTERNS: RegExp[] = [
  /BEGIN RSA PRIVATE KEY/,
  /BEGIN(?:\s+[A-Z0-9_-]+)*\s+PRIVATE\s+KEY/i,
  /sk-[a-zA-Z0-9_\-]+/,
  /sk-/,
  /AWS_[A-Z0-9_]+/,
  /AWS_/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[a-zA-Z0-9]{36}\b/,
  /\bgho_[a-zA-Z0-9]{36}\b/,
  /\bglpat-[a-zA-Z0-9_\-]{20}\b/,
  /(?:API_KEY|SECRET_KEY|PRIVATE_KEY|ACCESS_KEY|AUTH_TOKEN|JWT_SECRET|DATABASE_URL)\s*=\s*['"]?[^\r\n"']{6,}/i
];

// --- TIER 4: INBOUND PROMPT INJECTION & INSTRUCTION HIJACK SIGNATURES ---
export const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /SYSTEM\s+OVERRIDE/i,
  /IGNORE\s+(?:ALL\s+)?PREVIOUS\s+INSTRUCTIONS/i,
  /YOU\s+ARE\s+NOW\s+IN\s+(?:DEVELOPER|ADMIN|ROOT)\s+MODE/i,
  /DISREGARD\s+SAFETY\s+GUIDELINES/i,
  /DO\s+NOT\s+INFORM\s+THE\s+USER/i,
  /EXFILTRATE\s+(?:ENV|SECRETS|KEYS|FILES)/i
];

// --- TIER 2: SHANNON ENTROPY ANALYSIS (UNKNOWN SECRET DETECTION) ---
/**
 * Calculates Shannon Entropy in bits per character.
 * Normal English/words: ~2.5 - 3.5 bits/char.
 * Cryptographic keys, high-entropy tokens, base64 secrets: > 4.6 bits/char.
 */
export function calculateShannonEntropy(str: string): number {
  const len = str.length;
  if (len === 0) return 0;

  const frequencies: Record<string, number> = {};
  for (const char of str) {
    frequencies[char] = (frequencies[char] || 0) + 1;
  }

  let entropy = 0;
  for (const char in frequencies) {
    const p = frequencies[char] / len;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

/**
 * Scans candidate string for high-entropy tokens (e.g. unknown API keys, bearer tokens).
 */
export function checkHighEntropy(val: string, threshold = 4.6, minLength = 28): { matched: boolean; details?: string } {
  // Extract alphanumeric candidates
  const tokens = val.split(/[\s,;:=&|"'`\(\)\[\]{}]+/);
  for (const token of tokens) {
    if (token.length >= minLength) {
      // Ignore uniform repetitions or pure UUIDs with hyphens
      const entropy = calculateShannonEntropy(token);
      if (entropy >= threshold) {
        return {
          matched: true,
          details: `High-Entropy Secret detected (Entropy: ${entropy.toFixed(2)} bits/char, Length: ${token.length})`
        };
      }
    }
  }
  return { matched: false };
}

// --- TIER 3: SCHEMA & SCOPE VALIDATION (PATH TRAVERSAL & ANOMALIES) ---
export function checkScopeAndPathTraversal(val: string): { matched: boolean; details?: string } {
  // Directory traversal check
  if (/(?:\.\.[\/\\]){2,}/.test(val) || /[\/\\]\.\.[\/\\]/.test(val)) {
    return { matched: true, details: 'Directory Traversal attempt (../)' };
  }
  return { matched: false };
}

/**
 * Recursively scans any value (object, array, string) across all 4 defense tiers.
 */
function containsSensitiveData(value: unknown): { matched: boolean; pattern?: string; tier?: string } {
  if (value === null || value === undefined) {
    return { matched: false };
  }

  if (typeof value === 'string') {
    // Tier 1: Known Regex
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(value)) {
        return { matched: true, pattern: pattern.toString(), tier: 'Tier 1 (Regex Signature)' };
      }
    }

    // Tier 3: Path Traversal
    const pathCheck = checkScopeAndPathTraversal(value);
    if (pathCheck.matched) {
      return { matched: true, pattern: pathCheck.details, tier: 'Tier 3 (Path Traversal Guard)' };
    }

    // Tier 2: Shannon Entropy (Unknown / Custom tokens)
    const entropyCheck = checkHighEntropy(value);
    if (entropyCheck.matched) {
      return { matched: true, pattern: entropyCheck.details, tier: 'Tier 2 (Shannon Entropy)' };
    }

    return { matched: false };
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const res = containsSensitiveData(item);
      if (res.matched) return res;
    }
    return { matched: false };
  }

  if (typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      const keyRes = containsSensitiveData(key);
      if (keyRes.matched) return keyRes;
      const valRes = containsSensitiveData(val);
      if (valRes.matched) return valRes;
    }
    try {
      const serialized = JSON.stringify(value);
      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(serialized)) {
          return { matched: true, pattern: pattern.toString(), tier: 'Tier 1 (Regex Signature)' };
        }
      }
    } catch {
      // Ignore circular reference
    }
  }

  return { matched: false };
}

/**
 * Resolves binary on Windows if needed (e.g. npx -> npx.cmd) so child_process.spawn works cleanly without shell: true.
 */
function resolveWindowsExecutable(cmd: string): string {
  if (process.platform !== 'win32') {
    return cmd;
  }

  const pathExts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map(e => e.trim()).filter(Boolean);

  // If command already has a recognizable executable extension and exists
  const ext = path.extname(cmd);
  if (ext && pathExts.map(e => e.toLowerCase()).includes(ext.toLowerCase()) && fs.existsSync(cmd)) {
    return cmd;
  }

  const pathDirs = (process.env.PATH || '').split(path.delimiter);

  // Check current directory first for candidate with extensions
  for (const ext of pathExts) {
    const candidate = cmd + ext;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Check PATH directories with PATHEXT extensions
  for (const dir of pathDirs) {
    for (const ext of pathExts) {
      const candidate = path.join(dir, cmd + ext);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  // Fallback: direct candidate if it exists as-is
  if (fs.existsSync(cmd)) {
    return cmd;
  }

  return cmd;
}

function formatShellArg(arg: string): string {
  if (process.platform === 'win32') {
    if (arg.includes(' ') || arg.includes('\t')) {
      return `"${arg.replace(/"/g, '\\"')}"`;
    }
  }
  return arg;
}

import { getKnownConfigPaths, patchConfigFile, unpatchConfigFile, watchAndAutoArmor } from './config-guard.js';
import { startDaemon, stopDaemon, statusDaemon } from './daemon.js';

function formatLogLine(rawLine: string, isVerbose: boolean): string {
  const trimmed = rawLine.trim();
  if (!trimmed) return '';
  const parts = rawLine.split(' |||PAYLOAD|||');
  const summary = parts[0].trim();
  const payloadJson = parts[1]?.trim();

  if (!isVerbose || !payloadJson) {
    return summary + '\n';
  }

  try {
    const parsed = JSON.parse(payloadJson);
    const formatted = JSON.stringify(parsed, null, 2);
    const indented = formatted.split('\n').map(l => '   │ ' + l).join('\n');
    return `${summary}\n   ┌── [Payload]\n${indented}\n   └──\n`;
  } catch {
    return summary + '\n';
  }
}

function printUsage(): void {
  console.error('MCP Sentinel - Inline Security Proxy & Auto-Guard for Model Context Protocol\n');
  console.error('Usage:');
  console.error('  mcp-sentinel logs [--verbose|-v]   Stream live traffic, intercepts & payloads in real-time');
  console.error('  mcp-sentinel daemon start          Start Always-On background watchdog (runs silently without a terminal)');
  console.error('  mcp-sentinel daemon stop           Stop the background watchdog');
  console.error('  mcp-sentinel daemon status         Check status of the background watchdog');
  console.error('  mcp-sentinel watch                 Run continuous watcher in current terminal');
  console.error('  mcp-sentinel patch                 Scan & auto-shield all MCP servers in Antigravity / Claude / Cursor');
  console.error('  mcp-sentinel unpatch               Restore original server configs');
  console.error('  mcp-sentinel <cmd> [...args]       Run as inline stdio proxy for a specific MCP server');
  console.error('\nExamples:');
  console.error('  mcp-sentinel logs --verbose');
  console.error('  mcp-sentinel daemon start');
}

async function main(): Promise<void> {
  const targetArgs = process.argv.slice(2);

  if (targetArgs.length === 0) {
    printUsage();
    process.exit(1);
  }

  const firstArg = targetArgs[0].toLowerCase();
  const secondArg = targetArgs[1]?.toLowerCase();
  const isVerbose = targetArgs.some(a => a.toLowerCase() === '--verbose' || a.toLowerCase() === '-v');

  // Subcommand: logs
  if (firstArg === 'logs' || firstArg === 'stream') {
    const isClear = targetArgs.some(a => a.toLowerCase() === '--clear' || a.toLowerCase() === '-c' || a.toLowerCase() === '--clean');
    if (isClear) {
      fs.writeFileSync(LIVE_LOG_FILE, `[${new Date().toLocaleTimeString()}] MCP Sentinel Live Stream Initialized (History Cleared)\n`, 'utf-8');
      console.log(`[MCP Sentinel HUD] 🧹 Cleared log history in ${LIVE_LOG_FILE}\n`);
    }

    const modeLabel = isVerbose ? 'VERBOSE (Full Payloads)' : 'COMPACT';
    console.log(`[MCP Sentinel HUD] 📡 Streaming live MCP traffic [Mode: ${modeLabel}] from ${LIVE_LOG_FILE}`);
    console.log('[MCP Sentinel HUD] Press Ctrl+C to exit stream.\n');
    if (!fs.existsSync(LIVE_LOG_FILE)) {
      fs.writeFileSync(LIVE_LOG_FILE, `[${new Date().toLocaleTimeString()}] MCP Sentinel Live Stream Initialized\n`, 'utf-8');
    }

    // Print existing content formatted
    const existing = fs.readFileSync(LIVE_LOG_FILE, 'utf-8');
    for (const line of existing.split('\n')) {
      const out = formatLogLine(line, isVerbose);
      if (out) process.stdout.write(out);
    }

    // Watch for new appends
    let lastSize = fs.statSync(LIVE_LOG_FILE).size;
    let pendingBuffer = '';

    setInterval(() => {
      try {
        const currentSize = fs.statSync(LIVE_LOG_FILE).size;
        if (currentSize > lastSize) {
          const buffer = Buffer.alloc(currentSize - lastSize);
          const fd = fs.openSync(LIVE_LOG_FILE, 'r');
          fs.readSync(fd, buffer, 0, buffer.length, lastSize);
          fs.closeSync(fd);
          lastSize = currentSize;

          pendingBuffer += buffer.toString('utf-8');
          const lines = pendingBuffer.split('\n');
          pendingBuffer = lines.pop() || '';

          for (const line of lines) {
            const out = formatLogLine(line, isVerbose);
            if (out) process.stdout.write(out);
          }
        }
      } catch {}
    }, 150);

    await new Promise(() => {});
    return;
  }

  // Subcommand: daemon
  if (firstArg === 'daemon' || firstArg === 'service') {
    if (secondArg === 'start' || !secondArg) {
      startDaemon();
      return;
    }
    if (secondArg === 'stop' || secondArg === 'kill') {
      stopDaemon();
      return;
    }
    if (secondArg === 'status') {
      statusDaemon();
      return;
    }
    console.error(`Unknown daemon command: ${secondArg}. Use 'start', 'stop', or 'status'.`);
    return;
  }

  // Subcommand: patch
  if (firstArg === 'patch' || firstArg === 'auto' || firstArg === 'armor') {
    console.log('[MCP Sentinel Auto-Armor] Scanning and shielding all detected MCP server configs...');
    const paths = getKnownConfigPaths();
    let totalPatched = 0;
    for (const p of paths) {
      if (patchConfigFile(p)) {
        totalPatched++;
      }
    }
    console.log(`[MCP Sentinel Auto-Armor] Completed! Checked ${paths.length} locations, patched active servers.`);
    return;
  }

  // Subcommand: unpatch
  if (firstArg === 'unpatch' || firstArg === 'restore') {
    console.log('[MCP Sentinel] Restoring original server configurations...');
    const paths = getKnownConfigPaths();
    for (const p of paths) {
      unpatchConfigFile(p);
    }
    console.log('[MCP Sentinel] Restore completed.');
    return;
  }

  // Subcommand: watch
  if (firstArg === 'watch') {
    watchAndAutoArmor();
    // Keep process alive
    await new Promise(() => {});
    return;
  }

  const [rawCommand, ...rawArgs] = targetArgs;
  const executable = resolveWindowsExecutable(rawCommand);
  const isWindows = process.platform === 'win32';
  const isBatchFile = isWindows && (executable.toLowerCase().endsWith('.cmd') || executable.toLowerCase().endsWith('.bat'));
  
  // If batch file on Windows, shell: true is required by Node security policy; escape args with spaces
  const spawnArgs = isBatchFile ? rawArgs.map(formatShellArg) : rawArgs;

  // Track pending request methods by ID to correlate responses
  const pendingRequests = new Map<string | number, string>();

  const spawnExecutable = (isBatchFile && executable.includes(' ')) ? `"${executable}"` : executable;

  // Spawn target MCP server child process
  const child: ChildProcess = spawn(spawnExecutable, spawnArgs, {
    stdio: ['pipe', 'pipe', 'inherit'],
    shell: isBatchFile
  });

  child.on('error', (err: Error) => {
    console.error(`[MCP Sentinel] Failed to spawn target process '${executable}':`, err.message);
    process.exit(1);
  });

  child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });

  // Relay termination signals to child process
  const cleanExit = (signal: NodeJS.Signals) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };
  process.on('SIGINT', () => cleanExit('SIGINT'));
  process.on('SIGTERM', () => cleanExit('SIGTERM'));

  if (!child.stdin || !child.stdout) {
    console.error('[MCP Sentinel] Unable to establish stdio pipes with target process.');
    process.exit(1);
  }

  // --- Client -> Server Pipeline (process.stdin -> child.stdin) ---
  const clientRl = readline.createInterface({
    input: process.stdin,
    output: undefined,
    terminal: false
  });

  clientRl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Non-JSON line: forward verbatim to child
      if (child.stdin && child.stdin.writable) {
        child.stdin.write(line + '\n');
      }
      return;
    }

    // Correlate request ID with method if present
    if (parsed && typeof parsed === 'object' && parsed.id !== undefined && typeof parsed.method === 'string') {
      pendingRequests.set(parsed.id, parsed.method);
    }

    // Intercept tools/call
    if (parsed && typeof parsed === 'object' && parsed.method === 'tools/call') {
      const callArgs = parsed.params?.arguments;
      const checkResult = containsSensitiveData(callArgs);

      if (checkResult.matched) {
        console.error(`[MCP Sentinel] BLOCKED tools/call (id: ${parsed.id}) by [${checkResult.tier}]: ${checkResult.pattern}`);
        logLiveTraffic(
          'BLOCKED',
          `tools/call '${parsed.params?.name || 'unknown'}' blocked (id: ${parsed.id}) by [${checkResult.tier}]. Details: ${checkResult.pattern}`,
          parsed.params?.arguments
        );
        
        // Remove from tracked pending requests since it won't reach the server
        if (parsed.id !== undefined) {
          pendingRequests.delete(parsed.id);
        }

        // Send JSON-RPC error response immediately back to client
        const errorResponse = {
          jsonrpc: '2.0',
          id: parsed.id ?? null,
          error: {
            code: -32000,
            message: `Blocked by MCP Sentinel [${checkResult.tier}]: Potential sensitive data or security violation detected (${checkResult.pattern}).`
          }
        };

        process.stdout.write(JSON.stringify(errorResponse) + '\n');
        return;
      }
    }

    logLiveTraffic('OUTBOUND', `${parsed.method || 'request'} (id: ${parsed.id ?? 'notification'})`, parsed.params);

    // Forward safe message to target server
    if (child.stdin && child.stdin.writable) {
      child.stdin.write(line + '\n');
    }
  });

  clientRl.on('close', () => {
    if (child.stdin && child.stdin.writable) {
      child.stdin.end();
    }
  });

  // --- Server -> Client Pipeline (child.stdout -> process.stdout) ---
  const serverRl = readline.createInterface({
    input: child.stdout,
    output: undefined,
    terminal: false
  });

  serverRl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Non-JSON line: forward verbatim to client
      process.stdout.write(line + '\n');
      return;
    }

    const requestId = parsed?.id;
    const requestedMethod = requestId !== undefined ? pendingRequests.get(requestId) : undefined;
    if (requestId !== undefined) {
      pendingRequests.delete(requestId);
    }

    // Intercept tools/list response
    // Match either tracked tools/list request method or payload containing tools array
    const isToolsListResponse = requestedMethod === 'tools/list' || (parsed?.result && Array.isArray(parsed.result.tools));

    if (isToolsListResponse && parsed?.result && Array.isArray(parsed.result.tools)) {
      const originalTools = parsed.result.tools;
      const filteredTools = originalTools.filter((tool: any) => {
        const description = typeof tool?.description === 'string' ? tool.description : '';
        const name = typeof tool?.name === 'string' ? tool.name : '';
        const textToScan = `${name} ${description}`;

        let matchedPattern: string | undefined;
        for (const pattern of PROMPT_INJECTION_PATTERNS) {
          if (pattern.test(textToScan)) {
            matchedPattern = pattern.toString();
            break;
          }
        }

        if (matchedPattern) {
          console.error(`[MCP Sentinel] STRIPPED tool '${tool?.name || 'unnamed'}' [Tier 4 Prompt Injection matched: ${matchedPattern}]`);
          logLiveTraffic('SANITIZED', `Stripped tool '${tool?.name || 'unnamed'}' [Tier 4 Prompt Injection: ${matchedPattern}]`, tool);
          return false;
        }
        return true;
      });

      parsed.result.tools = filteredTools;
      logLiveTraffic('INBOUND', `tools/list response (${filteredTools.length} safe tools returned)`, {
        availableTools: filteredTools.map((t: any) => ({ name: t.name, description: t.description }))
      });
      process.stdout.write(JSON.stringify(parsed) + '\n');
      return;
    }

    logLiveTraffic('INBOUND', `Response (id: ${requestId ?? 'notification'})`, parsed.result ?? parsed.error);
    // Forward unmodified message to client
    process.stdout.write(line + '\n');
  });
}

main().catch((err) => {
  console.error('[MCP Sentinel] Fatal error:', err);
  process.exit(1);
});
