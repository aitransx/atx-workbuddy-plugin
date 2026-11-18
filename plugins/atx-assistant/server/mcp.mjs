// Minimal MCP (Model Context Protocol) server over stdio, zero dependencies.
// Messages are newline-delimited JSON-RPC 2.0, as required by the MCP stdio transport.
import { createInterface } from 'node:readline'

const PROTOCOL_VERSION = '2025-06-18'

export function createServer({ name, version, instructions, tools }) {
  const byName = new Map(tools.map(t => [t.name, t]))

  async function handle(msg) {
    const { id, method, params } = msg
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name, version },
          ...(instructions ? { instructions } : {}),
        }
      case 'ping':
        return {}
      case 'tools/list':
        return { tools: tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, ...(annotations ? { annotations } : {}) })) }
      case 'tools/call': {
        const tool = byName.get(params?.name)
        if (!tool) throw Object.assign(new Error(`Unknown tool: ${params?.name}`), { code: -32602 })
        try {
          const out = await tool.run(params.arguments || {})
          const content = typeof out === 'string' ? [{ type: 'text', text: out }]
            : Array.isArray(out) ? out : [{ type: 'text', text: JSON.stringify(out, null, 2) }]
          return { content }
        } catch (error) {
          // Tool failures are returned to the model as results, not protocol errors.
          return { content: [{ type: 'text', text: String(error?.message || error) }], isError: true }
        }
      }
      default:
        if (id === undefined) return undefined // notifications (e.g. notifications/initialized)
        throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 })
    }
  }

  async function dispatch(line, write) {
    let msg
    try { msg = JSON.parse(line) } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }
    try {
      const result = await handle(msg)
      if (msg.id !== undefined && result !== undefined) write({ jsonrpc: '2.0', id: msg.id, result })
    } catch (error) {
      if (msg.id !== undefined) write({ jsonrpc: '2.0', id: msg.id, error: { code: error.code || -32603, message: String(error.message || error) } })
    }
  }

  function listen(input = process.stdin, output = process.stdout) {
    const write = obj => output.write(JSON.stringify(obj) + '\n')
    const rl = createInterface({ input, crlfDelay: Infinity })
    rl.on('line', line => { if (line.trim()) dispatch(line, write) })
    return rl
  }

  return { handle, dispatch, listen }
}
