/**
 * Los tools de BeAOS: lo que la plataforma mide sobre una marca y sus entidades.
 *
 * Es la mitad propia. `list_brands` y `get_brand` son la puerta de entrada (dan el `brandId` y el
 * `entityId` que piden los demás); `get_aos_audit` y `list_aps_runs` son los dos scores —lo que el sitio
 * declara y lo que los modelos responden—; `get_agent_bundle` y `get_agent_asset` entregan el bundle
 * publicado, siempre por el mismo gate que la API de entrega; `get_aps_score_detail` abre el detalle
 * competitivo que se medía pero no se exponía; y `list_claims` y `get_claim` leen las pruebas, que son la
 * evidencia que BeAOS firma y que Maasy no manda.
 *
 * Regla de diseño: **la lectura pasa por el mismo gate que la API de entrega**. `loadAssetBundle`
 * devuelve `null` mientras la entidad no esté publicada, así que el MCP no puede filtrar un bundle que
 * un operador todavía no aprobó. Ningún tool arma el bundle por su cuenta.
 */

import {
	agentAosAudits,
	agentApsObservations,
	agentApsRuns,
	agentApsScores,
	agentBrandEntities,
} from "@workspace/aos-aps/db/schema";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { loadAssetBundle } from "@/server/agent-bundle";
import {
	ClaimEntityNotFoundError,
	getClaim as getClaimCore,
	inheritedClaimsOf,
	loadClaimsContext,
	serializeClaim,
} from "@/server/claims-core";
import type { McpTool } from "../jsonrpc";
import { optionalInteger, optionalUuid, requireString, requireUuid, textResult } from "../jsonrpc";
import { json, MAX_LIMIT, rankCounts, readCompetitorNames } from "./helpers";

const listBrands: McpTool = {
	name: "list_brands",
	title: "Listar marcas",
	description:
		"Lista las marcas de BeAOS con su id, nombre, web y dominios adicionales. Empezá por acá si no sabés el id de una marca.",
	inputSchema: {
		type: "object",
		properties: {
			limit: {
				type: "integer",
				minimum: 1,
				maximum: MAX_LIMIT,
				description: "Cuántas marcas devolver (por defecto 20).",
			},
		},
		additionalProperties: false,
	},
	handler: async (args) => {
		const limit = optionalInteger(args, "limit", { min: 1, max: MAX_LIMIT, fallback: 20 });
		const rows = await db
			.select({
				id: brands.id,
				name: brands.name,
				website: brands.website,
				additionalDomains: brands.additionalDomains,
				targetMarket: brands.targetMarket,
				targetLanguage: brands.targetLanguage,
			})
			.from(brands)
			.orderBy(desc(brands.createdAt))
			.limit(limit);
		return textResult(json({ brands: rows, count: rows.length }), { brands: rows });
	},
};

const getBrand: McpTool = {
	name: "get_brand",
	title: "Leer una marca",
	description:
		"Devuelve una marca y sus entidades (la marca paraguas y sus productos), con el id de cada entidad, su web y si su bundle está publicado. El `entityId` que piden los demás tools sale de acá.",
	inputSchema: {
		type: "object",
		properties: { brandId: { type: "string", description: "Id de la marca (ver list_brands)." } },
		required: ["brandId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const [brand] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
		if (brand === undefined) return textResult(`No existe la marca "${brandId}".`, { found: false });
		const entities = await db
			.select({
				id: agentBrandEntities.id,
				name: agentBrandEntities.name,
				entityType: agentBrandEntities.entityType,
				websiteUrl: agentBrandEntities.websiteUrl,
				parentEntityId: agentBrandEntities.parentEntityId,
				isPrimary: agentBrandEntities.isPrimary,
				maasyProjectId: agentBrandEntities.maasyProjectId,
				isPublished: agentBrandEntities.isPublished,
				publishedAt: agentBrandEntities.publishedAt,
			})
			.from(agentBrandEntities)
			.where(eq(agentBrandEntities.brandId, brandId))
			.orderBy(agentBrandEntities.createdAt);
		const payload = {
			brand: {
				id: brand.id,
				name: brand.name,
				website: brand.website,
				additionalDomains: brand.additionalDomains,
				aliases: brand.aliases,
				targetMarket: brand.targetMarket,
				targetLanguage: brand.targetLanguage,
			},
			entities: entities.map((entity) => ({
				...entity,
				publishedAt: entity.publishedAt?.toISOString() ?? null,
			})),
		};
		return textResult(json(payload), payload);
	},
};

const getAosAudit: McpTool = {
	name: "get_aos_audit",
	title: "Leer el AOS de una entidad",
	description:
		"Devuelve la última auditoría AOS de una entidad: el score, la banda, el tipo de negocio y el detalle requisito por requisito con qué pasó y qué no. Incluye el APS declarado (el que sale de los Claims & Proofs que el sitio sirve) cuando se pudo leer.",
	inputSchema: {
		type: "object",
		properties: { entityId: { type: "string", description: "UUID de la entidad (ver get_brand)." } },
		required: ["entityId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const entityId = requireUuid(args, "entityId");
		const [audit] = await db
			.select()
			.from(agentAosAudits)
			.where(eq(agentAosAudits.entityId, entityId))
			.orderBy(desc(agentAosAudits.createdAt))
			.limit(1);
		if (audit === undefined) {
			return textResult(`La entidad ${entityId} todavía no tiene ninguna auditoría AOS.`, { found: false });
		}
		const payload = {
			id: audit.id,
			url: audit.url,
			score: audit.score,
			band: audit.band,
			businessType: audit.businessType,
			declaredAps: audit.apsScore,
			declaredApsBreakdown: audit.apsBreakdown,
			scoringVersion: audit.scoringVersion,
			auditedAt: audit.createdAt.toISOString(),
			error: audit.error,
			requirements: audit.requirements,
		};
		return textResult(json(payload), payload);
	},
};

const listApsRuns: McpTool = {
	name: "list_aps_runs",
	title: "Listar las mediciones APS",
	description:
		"Lista las corridas de APS medido de una entidad, con el score por modelo, su banda, cuántas observaciones hay, si la corrida salió parcial y el intervalo P10–P90. APS es distinto del AOS: esto es lo que respondieron modelos reales, no lo que el sitio declara.",
	inputSchema: {
		type: "object",
		properties: {
			entityId: { type: "string", description: "UUID de la entidad (ver get_brand)." },
			limit: {
				type: "integer",
				minimum: 1,
				maximum: MAX_LIMIT,
				description: "Cuántas corridas devolver (por defecto 10).",
			},
		},
		required: ["entityId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const entityId = requireUuid(args, "entityId");
		const limit = optionalInteger(args, "limit", { min: 1, max: MAX_LIMIT, fallback: 10 });
		const runs = await db
			.select()
			.from(agentApsRuns)
			.where(eq(agentApsRuns.entityId, entityId))
			.orderBy(desc(agentApsRuns.createdAt))
			.limit(limit);
		if (runs.length === 0) {
			return textResult(`La entidad ${entityId} todavía no tiene corridas de APS.`, { runs: [] });
		}
		const scores = await db
			.select({
				runId: agentApsScores.runId,
				model: agentApsScores.model,
				aps: agentApsScores.aps,
				band: agentApsScores.band,
				observations: agentApsScores.observations,
				partial: agentApsScores.partial,
				p10: agentApsScores.p10,
				p50: agentApsScores.p50,
				p90: agentApsScores.p90,
				recommendationProbability: agentApsScores.recommendationProbability,
			})
			.from(agentApsScores)
			.where(
				inArray(
					agentApsScores.runId,
					runs.map((run) => run.id),
				),
			);
		const payload = {
			runs: runs.map((run) => ({
				id: run.id,
				status: run.status,
				models: run.models,
				createdAt: run.createdAt.toISOString(),
				finishedAt: run.finishedAt?.toISOString() ?? null,
				partial: run.partial,
				partialReason: run.partialReason,
				scores: scores
					.filter((score) => score.runId === run.id)
					.map((score) => ({
						model: score.model,
						aps: score.aps,
						band: score.band,
						observations: score.observations,
						partial: score.partial,
						p10: score.p10,
						p50: score.p50,
						p90: score.p90,
						recommendationProbability: score.recommendationProbability,
					})),
			})),
		};
		return textResult(json(payload), payload);
	},
};

const MAX_OBSERVATIONS = 200;

const getApsScoreDetail: McpTool = {
	name: "get_aps_score_detail",
	title: "Leer el detalle competitivo de una corrida APS",
	description:
		"Devuelve el detalle completo de una corrida de APS medido, modelo por modelo: las 5 dimensiones (descubribilidad, inteligencia estructurada, capacidad de acción, autoridad de fuente y reputación agéntica), los sub-métricas que las componen, el APS con su banda y su intervalo P10–P90, y cuántas observaciones lo sostienen. Además agrega qué competidores aparecieron en las respuestas y cuántas veces. Usalo cuando el score solo no alcanza y hay que explicar por qué. Pasá `runId` para una corrida concreta; sin él devuelve la última corrida terminada de la entidad.",
	inputSchema: {
		type: "object",
		properties: {
			entityId: { type: "string", description: "UUID de la entidad (ver get_brand)." },
			runId: {
				type: "string",
				description: "UUID de la corrida (ver list_aps_runs). Si falta, se usa la última corrida `done`.",
			},
		},
		required: ["entityId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const entityId = requireUuid(args, "entityId");
		const runId = optionalUuid(args, "runId");

		const [run] = runId
			? await db
					.select()
					.from(agentApsRuns)
					.where(and(eq(agentApsRuns.id, runId), eq(agentApsRuns.entityId, entityId)))
					.limit(1)
			: await db
					.select()
					.from(agentApsRuns)
					.where(and(eq(agentApsRuns.entityId, entityId), eq(agentApsRuns.status, "done")))
					.orderBy(desc(agentApsRuns.createdAt))
					.limit(1);

		if (run === undefined) {
			const detail = runId === undefined ? "todavía no tiene corridas terminadas" : `no tiene la corrida ${runId}`;
			return textResult(`La entidad ${entityId} ${detail}.`, { found: false });
		}

		const scores = await db
			.select({
				model: agentApsScores.model,
				aps: agentApsScores.aps,
				band: agentApsScores.band,
				dimensions: agentApsScores.dimensions,
				subMetrics: agentApsScores.subMetrics,
				p10: agentApsScores.p10,
				p50: agentApsScores.p50,
				p90: agentApsScores.p90,
				recommendationProbability: agentApsScores.recommendationProbability,
				observations: agentApsScores.observations,
				partial: agentApsScores.partial,
			})
			.from(agentApsScores)
			.where(eq(agentApsScores.runId, run.id));

		// Nunca `full_response`: la respuesta cruda pesa cientos de KB y el detalle no la necesita.
		const observations = await db
			.select({
				model: agentApsObservations.model,
				promptId: agentApsObservations.promptId,
				promptText: agentApsObservations.promptText,
				runIndex: agentApsObservations.runIndex,
				appeared: agentApsObservations.appeared,
				recommended: agentApsObservations.recommended,
				position: agentApsObservations.position,
				sentiment0to100: agentApsObservations.sentiment0to100,
				competitorsMentioned: agentApsObservations.competitorsMentioned,
			})
			.from(agentApsObservations)
			.where(eq(agentApsObservations.runId, run.id))
			.orderBy(agentApsObservations.model, agentApsObservations.runIndex);

		const overall = new Map<string, number>();
		const perModel = new Map<string, Map<string, number>>();
		for (const observation of observations) {
			const names = readCompetitorNames(observation.competitorsMentioned);
			const modelCounts = perModel.get(observation.model) ?? new Map<string, number>();
			for (const name of names) {
				overall.set(name, (overall.get(name) ?? 0) + 1);
				modelCounts.set(name, (modelCounts.get(name) ?? 0) + 1);
			}
			perModel.set(observation.model, modelCounts);
		}

		const payload = {
			run: {
				id: run.id,
				status: run.status,
				models: run.models,
				partial: run.partial,
				partialReason: run.partialReason,
				plannedCalls: run.plannedCalls,
				completedCalls: run.completedCalls,
				promptLibraryVersion: run.promptLibraryVersion,
				scoringVersion: run.scoringVersion,
				measurementVersion: run.measurementVersion,
				judgeModelAlias: run.judgeModelAlias,
				judgeModelVersion: run.judgeModelVersion,
				createdAt: run.createdAt.toISOString(),
				finishedAt: run.finishedAt?.toISOString() ?? null,
			},
			scores: scores.map((score) => ({
				model: score.model,
				aps: score.aps,
				band: score.band,
				p10: score.p10,
				p50: score.p50,
				p90: score.p90,
				recommendationProbability: score.recommendationProbability,
				observations: score.observations,
				partial: score.partial,
				dimensions: score.dimensions,
				subMetrics: score.subMetrics,
			})),
			competitors: {
				mentionedOverall: rankCounts(overall, 25),
				byModel: [...perModel.entries()].map(([model, counts]) => ({
					model,
					mentioned: rankCounts(counts, 15),
				})),
			},
			observationSummary: {
				total: observations.length,
				appeared: observations.filter((row) => row.appeared === true).length,
				recommended: observations.filter((row) => row.recommended === true).length,
				withCompetitors: observations.filter((row) => readCompetitorNames(row.competitorsMentioned).length > 0).length,
			},
			observations: observations.slice(0, MAX_OBSERVATIONS).map((row) => ({
				...row,
				competitorsMentioned: readCompetitorNames(row.competitorsMentioned),
			})),
			observationsTruncated: observations.length > MAX_OBSERVATIONS,
		};
		return textResult(json(payload), payload);
	},
};

/**
 * Las pruebas de una entidad, con la marca de heredable y las que hereda del paraguas.
 *
 * Es la lectura que necesita un consumidor para decidir qué marcar: Autex tiene ~40 dealers bajo un
 * mismo importador y no puede confirmar 40 veces la misma prueba de marca. La herencia se resuelve con
 * la misma regla pura que el generador (`inheritedRowsFor`), así que lo que este tool lista es lo que el
 * bundle va a declarar, ni más ni menos.
 */
const listClaims: McpTool = {
	name: "list_claims",
	title: "Listar las pruebas de una entidad",
	description:
		"Devuelve las pruebas guardadas de una entidad —id, afirmación, número, estado, si es heredable y de qué entidad es copia— y, si la entidad **no es el paraguas**, las pruebas heredables del paraguas que efectivamente hereda. Las heredadas viajan al perfil marcadas como heredadas: la sub-entidad nunca afirma como propio un caso de la marca. Solo las `confirmed` entran al bundle; un borrador se lista con su estado pero no entra. Para marcar una prueba como heredable está set_claim_inheritable.",
	inputSchema: {
		type: "object",
		properties: {
			brandId: { type: "string", description: "Id de la marca dueña (ver list_brands)." },
			entityId: { type: "string", description: "UUID de la entidad (ver get_brand)." },
		},
		required: ["brandId", "entityId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const entityId = requireUuid(args, "entityId");
		let context: Awaited<ReturnType<typeof loadClaimsContext>>;
		try {
			context = await loadClaimsContext(brandId, entityId);
		} catch (error) {
			if (error instanceof ClaimEntityNotFoundError) return textResult(error.message, { found: false });
			throw error;
		}
		const payload = {
			entityId,
			isUmbrella: context.isUmbrella,
			umbrella: context.umbrellaEntity,
			claims: context.rows.map((row) => serializeClaim(row)),
			// Las heredadas se declaran con la entidad de la que vienen: en una fila del paraguas la columna
			// viene null —es propia del paraguas—, así que la fuente se completa con el paraguas mismo.
			inheritedClaims: inheritedClaimsOf(context).map((row) => ({
				...serializeClaim(row),
				inheritedFrom: row.inheritedFromEntityId ?? context.umbrellaEntity.id,
				inheritedFromName: context.umbrellaEntity.name,
			})),
		};
		return textResult(json(payload), payload);
	},
};

/**
 * Una sola prueba, por su id.
 *
 * La lectura puntual que faltaba: `list_claims` trae todo —propias y heredadas—, y para editar hace falta
 * el estado exacto de una. Es el mismo objeto que `list_claims` devuelve dentro de `claims[]`, así que no
 * hay dos serializadores que puedan divergir.
 */
const getClaim: McpTool = {
	name: "get_claim",
	title: "Leer una prueba",
	description:
		"Devuelve una prueba de una entidad por su claimId —afirmación, número, categoría, límites, documento, estado, si es heredable y de qué entidad es copia—, o `found: false` si esa entidad no tiene ninguna con ese id. Es el mismo objeto que list_claims devuelve dentro de `claims[]`. Usala para leer el estado actual antes de editar, porque upsert_claim es un alta completa —los campos opcionales que no mandás quedan vacíos—, y para confirmar que una prueba existe antes de borrarla. Solo mira las filas propias de esa entidad: una prueba que la entidad **hereda** del paraguas no es suya y no se devuelve acá; para verla con su origen está list_claims. El claim vive en BeAOS: si lo que buscás es la evidencia en prosa que mandó Maasy, esa está en el snapshot del DNA, no en esta tabla.",
	inputSchema: {
		type: "object",
		properties: {
			brandId: { type: "string", description: "Id de la marca dueña (ver list_brands)." },
			entityId: { type: "string", description: "UUID de la entidad dueña de la prueba (ver get_brand)." },
			claimId: { type: "string", description: "Id de la prueba, por ejemplo CLM-MARCA-100-PROYECTOS." },
		},
		required: ["brandId", "entityId", "claimId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const entityId = requireUuid(args, "entityId");
		const claimId = requireString(args, "claimId");
		let claim: Awaited<ReturnType<typeof getClaimCore>>;
		try {
			claim = await getClaimCore({ brandId, entityId, claimId });
		} catch (error) {
			if (error instanceof ClaimEntityNotFoundError) return textResult(error.message, { found: false });
			throw error;
		}
		if (claim === null) {
			return textResult(
				`La entidad "${entityId}" no tiene una prueba propia con el id "${claimId}". Puede no existir o venir heredada del paraguas: list_claims dice cuál de las dos.`,
				{ found: false, entityId, claimId },
			);
		}
		const payload = { found: true, entityId, claim };
		return textResult(json(payload), payload);
	},
};

const getAgentBundle: McpTool = {
	name: "get_agent_bundle",
	title: "Leer el bundle de assets agénticos",
	description:
		"Devuelve el manifiesto del bundle que un agente de entrega puede montar en el sitio: cada ruta con su sha256 y su tamaño, más la identidad que firma. No devuelve el contenido — para eso está get_agent_asset. Solo responde si un operador publicó la entidad: el gate está cerrado por defecto.",
	inputSchema: {
		type: "object",
		properties: { entityId: { type: "string", description: "UUID de la entidad (ver get_brand)." } },
		required: ["entityId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const entityId = requireUuid(args, "entityId");
		const bundle = await loadAssetBundle(entityId);
		if (bundle === null) {
			return textResult(
				`La entidad ${entityId} no tiene bundle publicado. Se genera con generate_agent_assets y se publica con publish_agent_assets.`,
				{ published: false },
			);
		}
		const payload = {
			entityId: bundle.entityId,
			bundleSha256: bundle.bundleSha256,
			assets: bundle.assets.map((asset) => ({
				path: asset.path,
				type: asset.type,
				sha256: asset.sha256,
				bytes: Buffer.byteLength(asset.content, "utf8"),
			})),
		};
		return textResult(json(payload), payload);
	},
};

const getAgentAsset: McpTool = {
	name: "get_agent_asset",
	title: "Leer un archivo del bundle",
	description:
		"Devuelve el contenido exacto de un archivo del bundle publicado, con su sha256. Se usa un archivo por vez cuando el agente solo necesita montar o comparar un archivo. El contenido no se re-serializa: si cambia un byte, la firma Ed25519 deja de verificar.",
	inputSchema: {
		type: "object",
		properties: {
			entityId: { type: "string", description: "UUID de la entidad (ver get_brand)." },
			path: { type: "string", description: "Ruta exacta del archivo, por ejemplo /.well-known/brand.json." },
		},
		required: ["entityId", "path"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const entityId = requireUuid(args, "entityId");
		const path = requireString(args, "path");
		const bundle = await loadAssetBundle(entityId);
		if (bundle === null) {
			return textResult(`La entidad ${entityId} no tiene bundle publicado.`, { published: false });
		}
		const asset = bundle.assets.find((entry) => entry.path === path);
		if (asset === undefined) {
			const available = bundle.assets.map((entry) => entry.path).join(", ");
			return textResult(`El archivo "${path}" no está en este bundle. Hay: ${available}.`, { found: false });
		}
		return textResult(asset.content, {
			path: asset.path,
			type: asset.type,
			sha256: asset.sha256,
			bundleSha256: bundle.bundleSha256,
		});
	},
};

export const agentTools: McpTool[] = [
	listBrands,
	getBrand,
	getAosAudit,
	listApsRuns,
	getApsScoreDetail,
	listClaims,
	getClaim,
	getAgentBundle,
	getAgentAsset,
];
