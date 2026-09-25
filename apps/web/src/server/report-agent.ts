/**
 * El AOS y el APS que van dentro de un reporte.
 *
 * El reporte no guarda a qué entidad pertenece —la tabla `reports` solo tiene nombre y web—, así que el
 * vínculo se resuelve por host con `matchEntityForReport`, y cuando no se puede vincular se dice, en vez
 * de mostrar el AOS de otra marca.
 *
 * Es **aditivo**: no toca nada del reporte de Getcito. La ruta del reporte solo pide estos datos y los
 * pinta en secciones nuevas, con los tokens de Believe. Así el archivo del stream se puede seguir
 * mergeando desde el upstream sin conflictos.
 */
import { createServerFn } from "@tanstack/react-start";
import { agentAosAudits, agentApsRuns, agentApsScores, agentBrandEntities } from "@workspace/aos-aps/db/schema";
import { db } from "@workspace/lib/db/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { hasReportAccess, requireAuthSession } from "@/lib/auth/helpers";
import {
	type AosSummary,
	type ApsModelScore,
	matchEntityForReport,
	type ReportEntityRef,
	summarizeAos,
	summarizeAps,
} from "@/lib/report-agent";

export interface ReportAgentAudit {
	score: number | null;
	band: string | null;
	businessType: string | null;
	declaredAps: number | null;
	scoringVersion: string | null;
	auditedAt: string;
	summary: AosSummary;
}

export interface ReportAgentMeasurement {
	runId: string;
	capturedAt: string;
	status: string;
	partial: boolean;
	partialReason: string | null;
	declaredAps: number | null;
	scores: ApsModelScore[];
	summary: ReturnType<typeof summarizeAps>;
}

export interface ReportAgentContext {
	/** false cuando el reporte no se pudo vincular a una entidad de BeAOS. */
	linked: boolean;
	entity: { id: string; name: string; websiteUrl: string | null; published: boolean } | null;
	audit: ReportAgentAudit | null;
	measurement: ReportAgentMeasurement | null;
}

const EMPTY: ReportAgentContext = { linked: false, entity: null, audit: null, measurement: null };

export const getReportAgentContextFn = createServerFn({ method: "POST" })
	.validator(z.object({ website: z.string().nullable().optional(), name: z.string().nullable().optional() }))
	.handler(async ({ data }): Promise<ReportAgentContext> => {
		const session = await requireAuthSession();
		if (!hasReportAccess(session)) throw new Error("Access denied. Report generator access required.");

		const entities = await db
			.select({
				id: agentBrandEntities.id,
				name: agentBrandEntities.name,
				websiteUrl: agentBrandEntities.websiteUrl,
				entityType: agentBrandEntities.entityType,
				isPublished: agentBrandEntities.isPublished,
			})
			.from(agentBrandEntities);

		const match: ReportEntityRef | null = matchEntityForReport(entities, {
			website: data.website ?? null,
			name: data.name ?? null,
		});
		if (match === null) return EMPTY;

		const [audit] = await db
			.select()
			.from(agentAosAudits)
			.where(eq(agentAosAudits.entityId, match.id))
			.orderBy(desc(agentAosAudits.createdAt))
			.limit(1);

		const [run] = await db
			.select()
			.from(agentApsRuns)
			.where(and(eq(agentApsRuns.entityId, match.id), eq(agentApsRuns.status, "done")))
			.orderBy(desc(agentApsRuns.createdAt))
			.limit(1);

		let measurement: ReportAgentMeasurement | null = null;
		if (run !== undefined) {
			const rows = await db
				.select({
					model: agentApsScores.model,
					aps: agentApsScores.aps,
					band: agentApsScores.band,
					observations: agentApsScores.observations,
					partial: agentApsScores.partial,
					p10: agentApsScores.p10,
					p50: agentApsScores.p50,
					p90: agentApsScores.p90,
				})
				.from(agentApsScores)
				.where(inArray(agentApsScores.runId, [run.id]));
			const scores: ApsModelScore[] = rows;
			measurement = {
				runId: run.id,
				capturedAt: run.createdAt.toISOString(),
				status: run.status,
				partial: run.partial,
				partialReason: run.partialReason,
				declaredAps: audit?.apsScore ?? null,
				scores,
				summary: summarizeAps(scores),
			};
		}

		return {
			linked: true,
			entity: {
				id: match.id,
				name: match.name,
				websiteUrl: match.websiteUrl,
				published: match.isPublished,
			},
			audit:
				audit === undefined
					? null
					: {
							score: audit.score,
							band: audit.band,
							businessType: audit.businessType,
							declaredAps: audit.apsScore,
							scoringVersion: audit.scoringVersion,
							auditedAt: audit.createdAt.toISOString(),
							summary: summarizeAos(audit.requirements),
						},
			measurement,
		};
	});
