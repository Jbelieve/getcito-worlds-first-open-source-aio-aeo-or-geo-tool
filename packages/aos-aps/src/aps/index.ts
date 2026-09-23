/**
 * The operational APS pipeline (Fase 0-6).
 *
 * The scoring math lives in `../preference/measurement` (Fase 2/3) and is re-exported here so a
 * consumer of the pipeline has one entry point.
 */

export * from "./library";
export * from "../worker/budget";
export * from "./runPlan";
export * from "./robustness";
export * from "./capture";
export * from "./judge";
export * from "./targets";
export * from "./gateway";
export * from "./startRun";
export * from "../preference/measurement";

/** The spec APS version is part of a run's identity too: the series records both. */
export { SCORING_VERSION } from "../preference/score";
