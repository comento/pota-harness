import type { DagModel } from "./dag-model.mjs";
import type { TextContext } from "./dag-text.mjs";

export declare const SVG_LIMIT: number;
export declare function escapeXml(text: unknown): string;
export declare function renderDagSvg(
  model: DagModel,
  options: { width: number; epoch: number; ctx: TextContext },
): { source: string; alt: string; density: 0 | 1 | 2; omitted: number };
