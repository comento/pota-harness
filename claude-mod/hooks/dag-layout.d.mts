import type { DagEdge, DagModel } from "./dag-model.mjs";

export type DagLayout = {
  orientation: "row" | "column";
  width: number;
  height: number;
  card: { w: number; h: number };
  headers: { wave: number; x: number; y: number; w: number }[];
  boxes: { id: string; x: number; y: number; w: number; h: number }[];
  paths: { from: string; to: string; state: DagEdge["state"]; d: string; x1: number; y1: number; x2: number; y2: number }[];
};

export declare const PAD: number;
export declare const CARD_MIN_W: number;
export declare const CARD_MAX_W: number;
export declare const GAP_MAIN: number;
export declare const GAP_MAIN_MAX: number;
export declare const GAP_CROSS: number;
export declare const HEADER_H: number;
export declare const CARD_H: readonly [number, number, number];
export declare function isWide(cp: number): boolean;
export declare function textWidth(text: string, fontSize: number): number;
export declare function truncateText(text: string, maxWidth: number, fontSize: number): string;
export declare function panelWidth(bodyColumns: number): number;
export declare function layoutDag(model: DagModel, options: { width: number; density: 0 | 1 | 2 }): DagLayout;
