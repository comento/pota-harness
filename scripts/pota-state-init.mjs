import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertNoSymlinkComponents, safeMkdir, safeWriteFile } from "./pota-safe-fs.mjs";

const memoryTemplate = `# MEMORY

Index of repository knowledge. Each line under Domain Knowledge locates one note in \`docs/memory/\`; the knowledge itself lives in the note. Maintain with \`pota memory index\` and \`pota memory check\`.

## Domain Knowledge

## Policy

- Prefer precise repository exploration before implementation.
- Preserve proper nouns, file names, variable names, service names, alert names, MCP tool names, and agent names exactly as written.
- Read only the detailed memory files needed for the current task.
- Write user-visible responses and generated or updated documentation, plans, and memory artifacts in the OS locale unless the user asks for another language.
`;

const memoryTemplateKo = `# MEMORY

저장소 지식의 색인입니다. Domain Knowledge 아래의 각 줄은 \`docs/memory/\`의 노트 하나를 가리키며, 지식 자체는 노트에 있습니다. \`pota memory index\`와 \`pota memory check\`로 관리합니다.

## Domain Knowledge

## Policy

- 구현 전에는 저장소를 정확히 탐색합니다.
- 고유명사, 파일 이름, 변수 이름, 서비스 이름, 알림 이름, MCP 도구 이름, 에이전트 이름은 쓰인 그대로 보존합니다.
- 현재 작업에 필요한 상세 메모리 파일만 읽습니다.
- 사용자가 다른 언어를 요청하지 않는 한, 사용자에게 보이는 응답과 생성 또는 갱신하는 문서, 계획, 메모리 산출물은 OS locale 언어로 작성합니다.
`;

const planTemplate = `# PLAN

Index of work plans. Each line locates one plan in \`docs/plan/\`; details and evidence live in the plan. Planning rules live in the \`pota-plan\` skill. Maintain with \`pota plan index\` and \`pota plan check\`.

## Active Plans

## Completed Plans

Newest first; one line per plan. \`pota plan index --archive\` moves older entries to \`docs/plan/ARCHIVE.md\`.
`;

const planTemplateKo = `# PLAN

작업 계획의 색인입니다. 각 줄은 \`docs/plan/\`의 계획 하나를 가리키며, 상세 내용과 증거는 계획에 있습니다. 계획 규칙은 \`pota-plan\` 스킬에 있습니다. \`pota plan index\`와 \`pota plan check\`로 관리합니다.

## Active Plans

## Completed Plans

최신 항목이 위에 오며 계획당 한 줄입니다. \`pota plan index --archive\`는 오래된 항목을 \`docs/plan/ARCHIVE.md\`로 옮깁니다.
`;

export const INDEX_TEMPLATES = Object.freeze({
  memory: Object.freeze({ en: memoryTemplate, ko: memoryTemplateKo }),
  plan: Object.freeze({ en: planTemplate, ko: planTemplateKo }),
});

export async function initializeProject(root, ko) {
  await safeMkdir(root, "docs/memory");
  await safeMkdir(root, "docs/plan");
  await writeIfMissing(root, join(root, "MEMORY.md"), ko ? memoryTemplateKo : memoryTemplate);
  await writeIfMissing(root, join(root, "PLAN.md"), ko ? planTemplateKo : planTemplate);
}

async function writeIfMissing(root, path, content) {
  await assertNoSymlinkComponents(root, path);
  try {
    await readFile(path, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    try {
      await safeWriteFile(root, path, content, { encoding: "utf8", flag: "wx" });
    } catch (writeError) {
      if (writeError?.code !== "EEXIST") throw writeError;
      await assertNoSymlinkComponents(root, path, { allowMissing: false });
    }
  }
}
