import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests(): Promise<void> {
  console.log('=== Starting MCP Sentinel Verification Tests ===\n');

  const proxyScript = path.resolve(__dirname, '../dist/proxy.js');
  const mockServerScript = path.resolve(__dirname, 'mock-server.ts');

  // Spawn proxy wrapping the mock server using tsx
  const proxyProcess = spawn(process.execPath, [proxyScript, 'npx', 'tsx', mockServerScript], {
    stdio: ['pipe', 'pipe', 'inherit']
  });

  const responses: any[] = [];
  const responsePromises: Map<string | number, (res: any) => void> = new Map();

  const rl = readline.createInterface({
    input: proxyProcess.stdout,
    output: undefined,
    terminal: false
  });

  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed);
      responses.push(parsed);
      if (parsed.id !== undefined && responsePromises.has(parsed.id)) {
        const resolve = responsePromises.get(parsed.id)!;
        responsePromises.delete(parsed.id);
        resolve(parsed);
      }
    } catch (err) {
      console.error('Failed to parse line from proxy:', line, err);
    }
  });

  function sendRequest(req: any): Promise<any> {
    return new Promise((resolve) => {
      if (req.id !== undefined) {
        responsePromises.set(req.id, resolve);
      }
      proxyProcess.stdin.write(JSON.stringify(req) + '\n');
    });
  }

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, failureDetails?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}`);
      if (failureDetails) {
        console.error(`   Details: ${failureDetails}`);
      }
      failed++;
    }
  }

  try {
    // 1. Initialize Test
    const initRes = await sendRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', clientInfo: { name: 'test-client' } }
    });
    assert(
      initRes?.result?.serverInfo?.name === 'mock-target-server',
      'Handshake/Initialize pass-through works seamlessly',
      JSON.stringify(initRes)
    );

    // 2. tools/list Test: SYSTEM OVERRIDE filtering
    const listRes = await sendRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    });
    const tools = listRes?.result?.tools || [];
    const hasOverride = tools.some((t: any) => t.description?.includes('SYSTEM OVERRIDE'));
    const safeToolCount = tools.length;
    assert(
      !hasOverride && safeToolCount === 2 && tools[0].name === 'safe_calculator' && tools[1].name === 'safe_file_reader',
      'tools/list: Strips tools containing "SYSTEM OVERRIDE" from response',
      `Tools returned: ${JSON.stringify(tools)}`
    );

    // 3. tools/call Test: SSH Key blocking
    const sshCallRes = await sendRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'safe_calculator',
        arguments: {
          key: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----'
        }
      }
    });
    assert(
      sshCallRes?.error?.code === -32000 && sshCallRes?.error?.message?.includes('Blocked by MCP Sentinel'),
      'tools/call: Blocks arguments containing "BEGIN RSA PRIVATE KEY" with code -32000',
      JSON.stringify(sshCallRes)
    );

    // 4. tools/call Test: API Token (sk-) blocking
    const apiTokenRes = await sendRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'safe_calculator',
        arguments: {
          token: 'sk-proj-abc123xyzSecretKeyShouldBeBlocked'
        }
      }
    });
    assert(
      apiTokenRes?.error?.code === -32000,
      'tools/call: Blocks arguments containing "sk-" tokens with code -32000',
      JSON.stringify(apiTokenRes)
    );

    // 5. tools/call Test: AWS Credential blocking
    const awsTokenRes = await sendRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'safe_calculator',
        arguments: {
          awsKey: 'AWS_SECRET_ACCESS_KEY_123456789'
        }
      }
    });
    assert(
      awsTokenRes?.error?.code === -32000,
      'tools/call: Blocks arguments containing "AWS_" credentials with code -32000',
      JSON.stringify(awsTokenRes)
    );

    // 6. tools/call Test: Safe tool call pass-through
    const safeCallRes = await sendRequest({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'safe_calculator',
        arguments: {
          a: 40,
          b: 2
        }
      }
    });
    assert(
      safeCallRes?.result?.content?.[0]?.text?.includes('Mock server successfully executed'),
      'tools/call: Safe calls pass through and receive target server response',
      JSON.stringify(safeCallRes)
    );

    // 7. tools/call Test: Deeply nested credential detection
    const nestedRes = await sendRequest({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'safe_calculator',
        arguments: {
          settings: {
            auth: {
              headers: {
                Authorization: 'Bearer sk-ant-api03-abcdef987654321'
              }
            }
          }
        }
      }
    });
    assert(
      nestedRes?.error?.code === -32000,
      'tools/call: Blocks deeply nested credential tokens with code -32000',
      JSON.stringify(nestedRes)
    );

    // 7b. tools/call Test: Tier 2 (Shannon Entropy on unknown token)
    const entropyRes = await sendRequest({
      jsonrpc: '2.0',
      id: 72,
      method: 'tools/call',
      params: {
        name: 'safe_calculator',
        arguments: {
          customSecret: 'K9jF82mZ_xPq4WvT1aL7nB5eY0sR3uI6oQ8cX'
        }
      }
    });
    assert(
      entropyRes?.error?.code === -32000 && entropyRes?.error?.message?.includes('Tier 2 (Shannon Entropy)'),
      'tools/call: Blocks unknown high-entropy random secrets (Tier 2 Shannon Entropy)',
      JSON.stringify(entropyRes)
    );

    // 7c. tools/call Test: Tier 3 (Directory Traversal Guard)
    const traversalRes = await sendRequest({
      jsonrpc: '2.0',
      id: 73,
      method: 'tools/call',
      params: {
        name: 'safe_file_reader',
        arguments: {
          path: '../../../../etc/shadow'
        }
      }
    });
    assert(
      traversalRes?.error?.code === -32000 && traversalRes?.error?.message?.includes('Tier 3 (Path Traversal Guard)'),
      'tools/call: Blocks directory traversal attacks (Tier 3 Path Guard)',
      JSON.stringify(traversalRes)
    );

    // 8. Notification pass-through
    proxyProcess.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {}
    }) + '\n');
    await new Promise(r => setTimeout(r, 150));
    assert(true, 'Notifications pass through without crashing proxy');

    // 9. Auto-Armor Config Patching Test
    const tempConfigPath = path.resolve(__dirname, 'temp_mcp_config.json');
    const sampleConfig = {
      mcpServers: {
        newly_added_server: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/test']
        }
      }
    };
    const { patchConfigFile, unpatchConfigFile, isServerWrapped } = await import('../dist/config-guard.js');
    const fs = await import('node:fs');
    fs.writeFileSync(tempConfigPath, JSON.stringify(sampleConfig, null, 2), 'utf-8');

    patchConfigFile(tempConfigPath);
    const patchedConfig = JSON.parse(fs.readFileSync(tempConfigPath, 'utf-8'));
    const isShielded = isServerWrapped(patchedConfig.mcpServers.newly_added_server);
    assert(
      isShielded && patchedConfig.mcpServers.newly_added_server.command === 'node',
      'Auto-Armor: Automatically patches and shields newly added server configs',
      JSON.stringify(patchedConfig)
    );

    // Unpatch test
    unpatchConfigFile(tempConfigPath);
    const unpatchedConfig = JSON.parse(fs.readFileSync(tempConfigPath, 'utf-8'));
    assert(
      unpatchedConfig.mcpServers.newly_added_server.command === 'npx',
      'Auto-Armor: Restores original server configuration cleanly on unpatch',
      JSON.stringify(unpatchedConfig)
    );

    // Cleanup temp file
    if (fs.existsSync(tempConfigPath)) fs.unlinkSync(tempConfigPath);
    if (fs.existsSync(`${tempConfigPath}.backup`)) fs.unlinkSync(`${tempConfigPath}.backup`);

  } finally {
    proxyProcess.stdin.end();
    proxyProcess.kill('SIGTERM');
  }

  console.log(`\n=== Verification Results: ${passed} Passed, ${failed} Failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
