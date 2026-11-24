---
name: dag
description: Open the Pota DAG panel through the pota-dag MCP tool open_pota_dag; never plans or edits.
---

# Pota DAG

Use this only to open the Pota DAG panel. Never plan, edit files, or change goal state.

- On Antigravity and Codex/ChatGPT Desktop (only when `open_pota_dag` is available), call `open_pota_dag` once to open the Pota DAG panel, then stop.
- On Claude Code, do not call `open_pota_dag`. Tell the user to type `/dag` (the Pota mod command).
- If `open_pota_dag` is not available on Antigravity or Codex, say the `pota-dag` MCP server is not connected. On Antigravity, run `node "<pluginRoot>/scripts/pota-dag-mcp.mjs" ensure` once and retry `open_pota_dag` once, as in `pota://skills/pota-plan/planning-rules.md`; never block on it.
