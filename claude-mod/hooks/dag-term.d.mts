import type { DagModel } from "./dag-model.mjs";
import type { TextContext, Tone } from "./dag-text.mjs";

export type TermSpan = { text: string; tone: Tone; bold?: boolean };
/** One terminal line; never empty. */
export type TermRow = TermSpan[];
export type TermGraph = { mode: "boxes" | "list"; rows: TermRow[] };

export declare const BOX_MIN_W: 24;
export declare const BOX_MAX_W: 40;
export declare const BOX_GAP: 2;
export declare function termBoxLayout(columns: number, widestWave: number): { per: number; boxWidth: number } | null;
export declare function termGraph(model: DagModel, ctx: TextContext, options: { columns: number }): TermGraph;
