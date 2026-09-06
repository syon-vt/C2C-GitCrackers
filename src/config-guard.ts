import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to compiled proxy.js
export const PROXY_PATH = path.resolve(__dirname, 'proxy.js');

/**
 * Returns candidate MCP configuration file paths across Antigravity, Claude Desktop, Cursor, and Cline.
 */
export function getKnownConfigPaths(): string[] {
  const home = os.homedir();
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  const candidates: string[] = [
    // Antigravity global
    path.join(home, '.gemini', 'config', 'mcp_config.json'),
    // Antigravity local workspace (current directory)
    path.resolve(process.cwd(), '.agents', 'mcp_config.json')
  ];

  // Claude Desktop config
  if (isWin) {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push(path.join(appData, 'Claude', 'claude_desktop_config.json'));
    // Cursor config
    candidates.push(path.join(appData, 'Cursor', 'User', 'globalStorage', 'mcp.json'));
  } else if (isMac) {
    candidates.push(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'));
    candidates.push(path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'mcp.json'));
  } else {
    // Linux
    candidates.push(path.join(home, '.config', 'Claude', 'claude_desktop_config.json'));
    candidates.push(path.join(home, '.config', 'Cursor', 'User', 'globalStorage', 'mcp.json'));
  }

  return candidates;
}

/**
 * Checks whether a server configuration is already wrapped by MCP Sentinel.
 */
export function isServerWrapped(serverConfig: any): boolean {
  if (!serverConfig || typeof serverConfig !== 'object') return false;

  // Remote/SSE servers using serverUrl without a command should not be wrapped
  if (serverConfig.serverUrl && !serverConfig.command) {
    return true;
  }

  const command = String(serverConfig.command || '');
  const args = Array.isArray(serverConfig.args) ? serverConfig.args.map(String) : [];

  if (command.includes('mcp-sentinel') || args.some((a: string) => a.includes('mcp-sentinel') || a.includes('proxy.js'))) {
    return true;
  }

  return false;
}

/**
 * Wraps an individual server configuration with MCP Sentinel.
 */
export function wrapServerConfig(serverConfig: any): { modified: boolean; config: any } {
  if (!serverConfig || typeof serverConfig !== 'object') {
    return { modified: false, config: serverConfig };
  }

  // If this is a remote / HTTP / SSE server without a local executable command, do not wrap
  if (!serverConfig.command || (serverConfig.serverUrl && !serverConfig.command)) {
    return { modified: false, config: serverConfig };
  }

  if (isServerWrapped(serverConfig)) {
    return { modified: false, config: serverConfig };
  }

  const originalCommand = serverConfig.command;
  const originalArgs = Array.isArray(serverConfig.args) ? serverConfig.args : [];

  const updatedConfig = {
    ...serverConfig,
    command: 'node',
    args: [PROXY_PATH, originalCommand, ...originalArgs]
  };

  return { modified: true, config: updatedConfig };
}

/**
 * Unwraps an individual server configuration.
 */
export function unwrapServerConfig(serverConfig: any): { modified: boolean; config: any } {
  if (!isServerWrapped(serverConfig)) {
    return { modified: false, config: serverConfig };
  }

  const args: string[] = Array.isArray(serverConfig.args) ? serverConfig.args : [];
  const proxyIndex = args.findIndex((a) => a.includes('proxy.js') || a.includes('mcp-sentinel'));

  if (proxyIndex === -1 || proxyIndex + 1 >= args.length) {
    return { modified: false, config: serverConfig };
  }

  const unwrappedCommand = args[proxyIndex + 1];
  const unwrappedArgs = args.slice(proxyIndex + 2);

  const updatedConfig = {
    ...serverConfig,
    command: unwrappedCommand,
    args: unwrappedArgs
  };

  return { modified: true, config: updatedConfig };
}

/**
 * Patches a configuration file by wrapping all unwrapped MCP servers with MCP Sentinel.
 */
export function patchConfigFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  try {
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(rawContent);

    if (!json || typeof json !== 'object' || !json.mcpServers || typeof json.mcpServers !== 'object') {
      return false;
    }

    let modifiedAny = false;
    for (const [serverKey, serverVal] of Object.entries(json.mcpServers)) {
      const { modified, config } = wrapServerConfig(serverVal);
      if (modified) {
        json.mcpServers[serverKey] = config;
        modifiedAny = true;
        console.log(`[MCP Sentinel Auto-Armor] 🛡️ Shielded server '${serverKey}' in ${filePath}`);
      }
    }

    if (modifiedAny) {
      // Create backup
      fs.writeFileSync(`${filePath}.backup`, rawContent, 'utf-8');
      fs.writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf-8');
      console.log(`[MCP Sentinel Auto-Armor] ✅ Successfully updated ${filePath}`);
      return true;
    }
  } catch (err: any) {
    console.error(`[MCP Sentinel Auto-Armor] Failed to patch ${filePath}:`, err.message);
  }

  return false;
}

/**
 * Unpatches a configuration file by restoring original unwrapped commands.
 */
export function unpatchConfigFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  try {
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(rawContent);

    if (!json?.mcpServers) return false;

    let modifiedAny = false;
    for (const [serverKey, serverVal] of Object.entries(json.mcpServers)) {
      const { modified, config } = unwrapServerConfig(serverVal);
      if (modified) {
        json.mcpServers[serverKey] = config;
        modifiedAny = true;
        console.log(`[MCP Sentinel] Unwrapped server '${serverKey}' in ${filePath}`);
      }
    }

    if (modifiedAny) {
      fs.writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf-8');
      console.log(`[MCP Sentinel] Restored original config for ${filePath}`);
      return true;
    }
  } catch (err: any) {
    console.error(`[MCP Sentinel] Failed to unpatch ${filePath}:`, err.message);
  }

  return false;
}

/**
 * Watches all MCP config files in real-time. Whenever a new server is added, automatically wraps it.
 */
export function watchAndAutoArmor(): void {
  const paths = getKnownConfigPaths();
  console.log('[MCP Sentinel Auto-Armor] 🛡️ Active Background Guard started.');
  console.log('[MCP Sentinel Auto-Armor] Monitoring configuration files for newly added servers...\n');

  // Initial patch
  for (const p of paths) {
    if (fs.existsSync(p)) {
      console.log(`[MCP Sentinel Auto-Armor] Found active config: ${p}`);
      patchConfigFile(p);
    }
  }

  // Watch for changes
  for (const p of paths) {
    if (!fs.existsSync(p)) {
      // Watch directory in case file is created later
      const dir = path.dirname(p);
      if (fs.existsSync(dir)) {
        try {
          fs.watch(dir, (_event, filename) => {
            if (filename === path.basename(p)) {
              setTimeout(() => patchConfigFile(p), 500);
            }
          });
        } catch {}
      }
      continue;
    }

    try {
      let debounceTimer: NodeJS.Timeout | null = null;
      fs.watch(p, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          patchConfigFile(p);
        }, 600);
      });
      console.log(`[MCP Sentinel Auto-Armor] 👁️ Watching ${p}`);
    } catch (err: any) {
      console.error(`[MCP Sentinel Auto-Armor] Could not watch ${p}:`, err.message);
    }
  }

  // Keep process event loop active indefinitely
  setInterval(() => {}, 1000 * 60 * 60);
}

