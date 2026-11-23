#!/usr/bin/env node
// Antigravity Pota DAG MCP 서버 stdio(NDJSON) 엔트리포인트.
// stdout에는 JSON-RPC 응답 한 줄씩만 기록하며, 비-JSON 출력은 전면 금지한다.

import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDagMcpServer } from "./pota-dag-mcp-core.mjs";

export function runStdioServer({
  stdin = process.stdin,
  stdout = process.stdout,
  server = createDagMcpServer(),
} = {}) {
  return new Promise((resolveDone) => {
    let buffer = "";
    let brokenPipe = false;
    let settled = false;
    // 파이프라인으로 연속 수신된 요청·오류 응답이 도착 순서를 지키도록 직렬화 큐로 처리한다.
    let queue = Promise.resolve();
    const inFlight = new Set();

    const finish = () => {
      if (settled) return;
      settled = true;
      resolveDone();
    };

    const writeResponse = (response) => {
      if (!response || brokenPipe || stdout.destroyed || stdout.writableEnded) return;
      try {
        stdout.write(`${JSON.stringify(response)}\n`);
      } catch (error) {
        if (error?.code === "EPIPE" || error?.code === "ERR_STREAM_DESTROYED") {
          brokenPipe = true;
          return;
        }
        throw error;
      }
    };

    const handleStdoutError = (error) => {
      if (error?.code === "EPIPE" || error?.code === "ERR_STREAM_DESTROYED") {
        brokenPipe = true;
      }
    };

    const enqueue = (taskFn) => {
      const task = queue.then(taskFn, taskFn).finally(() => {
        inFlight.delete(task);
      });
      queue = task;
      inFlight.add(task);
    };

    const dispatchLine = (rawLine) => {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line.trim().length === 0) return;

      enqueue(async () => {
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          writeResponse({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
          });
          return;
        }

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          writeResponse({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "Invalid Request" },
          });
          return;
        }

        try {
          const response = await server.handleMessage(parsed);
          if (response !== null && response !== undefined) writeResponse(response);
        } catch {
          if (Object.hasOwn(parsed, "id") && parsed.id !== undefined) {
            const safeId = parsed.id === null || typeof parsed.id === "string" || (typeof parsed.id === "number" && Number.isFinite(parsed.id))
              ? parsed.id
              : null;
            writeResponse({
              jsonrpc: "2.0",
              id: safeId,
              error: { code: -32603, message: "Internal error" },
            });
          }
        }
      });
    };

    const onData = (chunk) => {
      buffer += chunk;
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        dispatchLine(line);
      }
    };

    const drainAndFinish = async () => {
      if (buffer.length > 0) {
        const remaining = buffer;
        buffer = "";
        dispatchLine(remaining);
      }
      while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight]);
      }
      stdout.off?.("error", handleStdoutError);
      stdin.off?.("data", onData);
      stdin.off?.("end", onEnd);
      stdin.off?.("error", onEnd);
      finish();
    };

    const onEnd = () => {
      void drainAndFinish();
    };

    stdout.on("error", handleStdoutError);
    if (typeof stdin.setEncoding === "function") stdin.setEncoding("utf8");
    stdin.on("data", onData);
    stdin.on("end", onEnd);
    stdin.on("error", onEnd);
    if (typeof stdin.resume === "function") stdin.resume();
  });
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}

if (isCliEntry()) {
  await runStdioServer();
}
