import type { DagModel, DagNode, DagTaskEnrichment } from "./dag-model.mjs";
import type { TextContext } from "./dag-text.mjs";

export type DagSvgNode = Omit<DagNode, "task"> & { task: DagNode["task"] & DagTaskEnrichment };
export type DagSvgModel = Omit<DagModel, "nodes"> & { nodes: readonly DagSvgNode[] };

export declare const SVG_LIMIT: number;
export declare function escapeXml(text: unknown): string;
export declare function renderDagSvg(
  model: DagModel | DagSvgModel,
  options: { width: number; epoch: number; ctx: TextContext },
): { source: string; alt: string; density: 0 | 1 | 2; omitted: number };
