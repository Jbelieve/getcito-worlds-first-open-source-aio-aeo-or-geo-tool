/**
 * Los tools del MCP de BeAOS.
 *
 * Es la puerta que faltaba: hasta ahora lo único que BeAOS exponía para que otro producto lo consumiera
 * era una API REST, y "otro producto" en la práctica es un agente. Acá el mismo trabajo se ofrece como
 * tools, para que Maasy (o BeAds, o el agente de una marca) opere BeAOS sin escribir integraciones.
 *
 * Regla de diseño: **la lectura pasa por el mismo gate que la API de entrega**. `loadAssetBundle`
 * devuelve `null` mientras la entidad no esté publicada, así que el MCP no puede filtrar un bundle que
 * un operador todavía no aprobó. Ningún tool arma el bundle por su cuenta.
 *
 * Las acciones (`generate`, `publish`) delegan en `agent-assets-core`, que es exactamente lo que corre
 * cuando el operador aprieta el botón en la UI. Si el guardián de claims bloquea la publicación, el
 * bloqueo también aparece acá: no hay una puerta más permisiva.
 */

import { agentAosAudits, agentApsRuns, agentApsScores, agentBrandEntities } from "@workspace/aos-aps/db/schema";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { generateAssetsForEntity, setEntityPublished } from "@/server/agent-assets-core";
import { loadAssetBundle } from "@/server/agent-bundle";
import { type McpTool, optionalInteger, requireBoolean, requireString, requireUuid, textResult } from "./jsonrpc";

const MAX_LIMIT = 100;

function json(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

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

const generateAgentAssetsTool: McpTool = {
	name: "generate_agent_assets",
	title: "Generar el bundle de assets agénticos",
	description:
		"Genera (o regenera) el bundle de assets agénticos de una entidad a partir de su Brand DNA: llms.txt, AGENTS.md, robots.txt, sitemap.xml y los archivos de /.well-known, firmados. Deja el bundle guardado pero NO lo publica. Es la misma generación que corre desde la UI.",
	inputSchema: {
		type: "object",
		properties: {
			brandId: { type: "string", description: "Id de la marca dueña de la entidad." },
			entityId: { type: "string", description: "UUID de la entidad a generar." },
		},
		required: ["brandId", "entityId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const entityId = requireUuid(args, "entityId");
		const assets = await generateAssetsForEntity(brandId, entityId);
		const payload = {
			entityId,
			count: assets.length,
			assets: assets.map((asset) => ({ path: asset.path, type: asset.type, sha256: asset.hash })),
		};
		return textResult(json(payload), payload);
	},
};

const publishAgentAssets: McpTool = {
	name: "publish_agent_assets",
	title: "Publicar o despublicar el bundle",
	description:
		"Abre o cierra el gate de publicación de una entidad. Publicar tiene un guardián: si el bundle declara menos claims que el perfil que el sitio sirve hoy, la publicación se rechaza, porque degradaría en silencio la evidencia verificable de la marca. Un rechazo no es un error del tool: es la respuesta.",
	inputSchema: {
		type: "object",
		properties: {
			brandId: { type: "string", description: "Id de la marca dueña de la entidad." },
			entityId: { type: "string", description: "UUID de la entidad." },
			published: { type: "boolean", description: "true para publicar, false para despublicar." },
		},
		required: ["brandId", "entityId", "published"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const entityId = requireUuid(args, "entityId");
		const published = requireBoolean(args, "published");
		const result = await setEntityPublished(brandId, entityId, published);
		return textResult(json(result), result);
	},
};

export const BEAOS_MCP_TOOLS: McpTool[] = [
	listBrands,
	getBrand,
	getAosAudit,
	listApsRuns,
	getAgentBundle,
	getAgentAsset,
	generateAgentAssetsTool,
	publishAgentAssets,
];

export const BEAOS_MCP_SERVER = {
	name: "beaos",
	version: "1.0.0",
	instructions:
		"BeAOS mide si una marca y sus webs son operables y preferibles para agentes. AOS es el score de la web (qué declara y qué puede hacer un agente); APS medido es lo que modelos reales responden sobre la marca; APS declarado sale de los Claims & Proofs que el sitio firma. Para empezar: list_brands, después get_brand para obtener el entityId, y desde ahí get_aos_audit, list_aps_runs o get_agent_bundle.",
} as const;
