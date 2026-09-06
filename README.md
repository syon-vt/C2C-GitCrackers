# MCP Sentinel 🛡️

**MCP Sentinel** is an inline, zero-dependency security proxy for the **Model Context Protocol (MCP)**. It acts as a man-in-the-middle stdio transport layer between your AI client/IDE (Claude Desktop, Cursor, Antigravity, Cline) and any target MCP server.

---

## ⚡ Auto-Armor & Real-Time Watcher (Zero-Configuration Mode)

Instead of manually editing config files, **MCP Sentinel Auto-Guard** can automatically scan, shield, and monitor all your MCP servers across Antigravity, Claude Desktop, and Cursor:

### 1. One-Click Scan & Patch
Scans all installed MCP servers and injects Sentinel protection automatically:
```bash
npm run patch
# or
node dist/proxy.js patch
```

### 2. Continuous Background Watcher
Watches configuration files in real time. **Whenever you connect to or add a new MCP server in your IDE, Sentinel automatically wraps it with zero manual steps**:
```bash
npm run watch
# or
node dist/proxy.js watch
```

### 3. Restore / Unpatch
Restores original configurations whenever needed:
```bash
npm run unpatch
# or
node dist/proxy.js unpatch
```

---

MCP Sentinel requires **no changes** to your MCP servers and **zero extra steps** for end users. Simply prefix your existing MCP server command in your client settings.

### Configuration Examples

#### 1. Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-sentinel",
        "npx",
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/username/Desktop"
      ]
    },
    "custom-python-server": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-sentinel",
        "python",
        "server.py"
      ]
    }
  }
}
```

#### 2. Local / Prebuilt Usage
```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": [
        "c:/path/to/mcp-sentinel/dist/proxy.js",
        "node",
        "c:/path/to/my-server/index.js"
      ]
    }
  }
}
```

---

## 🔒 Security Capabilities

### 1. Inbound Interception (`tools/list`)
- Inspects tool descriptions sent from the target server to the client.
- Automatically strips any tool containing `"SYSTEM OVERRIDE"` in its description before the client ever receives it (simulating advanced SLM checks).

### 2. Outbound Interception (`tools/call`)
- Recursively scans tool invocation arguments for sensitive credential leaks:
  - **SSH Private Keys**: `BEGIN RSA PRIVATE KEY`, `BEGIN ... PRIVATE KEY`
  - **API Tokens**: `sk-...`
  - **AWS Credentials**: `AWS_...`, `AKIA...`
- If sensitive data is detected, the request is **immediately blocked** and never forwarded to the server.
- Returns a standard JSON-RPC 2.0 error response with code `-32000` to the AI client:
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "error": {
      "code": -32000,
      "message": "Blocked by MCP Sentinel: Sensitive credential pattern detected in tool arguments."
    }
  }
  ```

### 3. Bidirectional Transparency
- Safe JSON-RPC traffic, notifications, standard error streams, and initialization handshakes flow seamlessly with zero overhead or disruption.

---

## 🛠️ Build & Test

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run build

# Run end-to-end verification tests
npm test
```
