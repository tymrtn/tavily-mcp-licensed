![GitHub Repo stars](https://img.shields.io/github/stars/tymrtn/tavily-mcp-licensed?style=social)
![npm](https://img.shields.io/npm/dt/tavily-mcp-licensed)
![smithery badge](https://smithery.ai/badge/@tymrtn/tavily-mcp-licensed)

# Tavily MCP (Licensed Fork)

Fork of `tavily-ai/tavily-mcp` with Copyright.sh licensing:
- automatic `ai-license` discovery
- optional x402-aware fetch (402 + `payment-required: x402`)
- usage logging to the Copyright.sh ledger

Tool names remain `tavily-*`. When following upstream install instructions, replace `tavily-mcp` with `tavily-mcp-licensed` and add the ledger env vars below.

Original repository: https://github.com/tavily-ai/tavily-mcp

## Why this fork?
This fork adds compliant licensing checks, optional x402 payment handling, and usage logging so developers can fetch content with clear rights and auditability.

## Quickstart
1. Get a Tavily API key: https://app.tavily.com/home
2. Get a Copyright.sh ledger key: https://portal.copyright.sh
   - Sign up → complete onboarding → open API Keys → create a key (shown once)
3. Run:
```bash
env TAVILY_API_KEY=your_tavily_key COPYRIGHTSH_LEDGER_API_KEY=your_ledger_key npx -y tavily-mcp-licensed
```
4. Configure your MCP client:
```json
{
  "mcpServers": {
    "tavily-licensed": {
      "command": "npx",
      "args": ["-y", "tavily-mcp-licensed"],
      "env": {
        "TAVILY_API_KEY": "your_tavily_key",
        "COPYRIGHTSH_LEDGER_API_KEY": "your_ledger_key"
      }
    }
  }
}
```

## Configuration
Required:
- `TAVILY_API_KEY`
- `COPYRIGHTSH_LEDGER_API_KEY` (needed for license acquisition + usage logging)

Optional:
- `COPYRIGHTSH_LEDGER_API` (default: `https://ledger.copyright.sh`)
- `ENABLE_LICENSE_TRACKING` (default: `true`)
- `ENABLE_LICENSE_CACHE` (default: `false`)

License-aware options (search/extract/crawl):
- `fetch`, `stage`, `distribution`, `estimated_tokens`, `max_chars`, `payment_method`

Unavailable policy:
- License denied or HTTP 401/403/402 results are returned with an `unavailable` reason and redacted content
- Unknown license remains best-effort

Note: Tavily's hosted MCP (`https://mcp.tavily.com/mcp`) does not include licensing. Use this fork locally for compliant licensing behavior.

## Upstream docs
- https://github.com/tavily-ai/tavily-mcp
