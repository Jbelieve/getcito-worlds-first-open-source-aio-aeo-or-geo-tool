/**
 * Las acciones del MCP: lo que **escribe**.
 *
 * Regla que no se negocia: una acción por el MCP es la misma acción de la UI. `generate_agent_assets` y
 * `publish_agent_assets` llaman a `agent-assets-core`, así que si el guardián de claims bloquea una
 * publicación, el bloqueo también aparece acá —no hay una puerta más permisiva para los agentes—.
 * `start_aps_run` llama a `agent-aps-core`, que es lo que corre cuando el operador aprieta el botón, con
 * el mismo guardián de presupuesto. `sync_brand_dna` llama a `agent-maasy-core`.
 *
 * Las herramientas de "asegurar" (`ensure_brand`, `ensure_entity`) son las únicas que crean filas, y son
 * idempotentes a propósito: un consumidor que reintenta no duplica una marca ni rompe una jerarquía.
 */

import { agentBrandEntities, type NewAgentBrandEntity } from "@workspace/aos-aps/db/schema";
import { findUmbrellaEntity } from "@workspace/aos-aps/provenance";
import { db } from "@workspace/lib/db/db";
import { brands, type NewBrand } from "@workspace/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { hostOf } from "@/lib/report-agent";
import { startApsRunForBrand } from "@/server/agent-aps-core";
import { generateAssetsForEntity, setEntityPublished } from "@/server/agent-assets-core";
import { syncAgentDnaForEntity } from "@/server/agent-maasy-core";
import type { McpTool } from "../jsonrpc";
import {
	optionalBoolean,
	optionalInteger,
	optionalString,
	optionalStringArray,
	optionalUuid,
	requireBoolean,
	requireEnum,
	requireString,
	requireUuid,
	ToolInputError,
	textResult,
} from "../jsonrpc";
import { errorResult, json } from "./helpers";

const ENTITY_TYPES = ["umbrella", "product"] as const;

/** Un id legible a partir del host: `autex.porsche.com` → `autex-porsche-com`. Nunca un uuid. */
function brandIdFromHost(host: string): string {
	const slug = host
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug.length > 0 ? slug : "brand";
}

function uniqueBrandId(base: string, taken: Set<string>): string {
	if (taken.has(base) === false) return base;
	let suffix = 2;
	while (taken.has(`${base}-${suffix}`)) suffix += 1;
	return `${base}-${suffix}`;
}

/**
 * Valida la jerarquía antes de escribir. Un padre de otra marca o un ciclo hacen que la generación de
 * assets falle más tarde, cuando el error ya es caro de rastrear; acá se dice en el momento.
 */
function assertEntityHierarchy(
	rows: Array<{ id: string; parentEntityId: string | null }>,
	entityId: string | null,
	parentEntityId: string | undefined,
): void {
	if (parentEntityId === undefined) return;
	const parent = rows.find((row) => row.id === parentEntityId);
	if (parent === undefined) {
		throw new ToolInputError(`"parentEntityId" ${parentEntityId} no pertenece a esta marca.`);
	}
	if (findUmbrellaEntity(rows, parentEntityId) === null) {
		throw new ToolInputError(
			`La jerarquía de "${parentEntityId}" ya está rota o tiene un ciclo: hay que repararla antes.`,
		);
	}
	if (entityId === null) return;
	if (entityId === parentEntityId) throw new ToolInputError("Una entidad no puede ser su propio padre.");
	const proposed = rows.map((row) => (row.id === entityId ? { ...row, parentEntityId } : row));
	if (findUmbrellaEntity(proposed, entityId) === null) {
		throw new ToolInputError(
			`Ese padre crearía un ciclo: "${parentEntityId}" desciende de la entidad que se está editando.`,
		);
	}
}

const ensureBrand: McpTool = {
	name: "ensure_brand",
	title: "Asegurar una marca",
	description:
		"Crea una marca o actualiza la que ya existe, de forma idempotente: si hay una marca con el mismo host de `website` (o de `additionalDomains`) devuelve esa en vez de crear un duplicado. Usalo antes de cualquier otra acción cuando el consumidor conoce la marca por su web y no por su id. Si mandás `id`, se respeta tal cual; si no, se genera uno legible desde el host (ej. `autex-porsche-com`). Los campos que no mandás no se tocan.",
	inputSchema: {
		type: "object",
		properties: {
			id: {
				type: "string",
				description: "Id estable a imponer como dueño del consumidor. Si ya existe, se actualiza esa marca.",
			},
			name: { type: "string", description: "Nombre de la marca." },
			website: { type: "string", description: "Web principal. El host es la clave de idempotencia." },
			additionalDomains: {
				type: "array",
				items: { type: "string" },
				description: "Otros dominios de la misma marca, si los hay.",
			},
			aliases: { type: "array", items: { type: "string" }, description: "Alias y variantes de escritura del nombre." },
			targetMarket: { type: "string", description: "Mercado objetivo (por ejemplo `España`)." },
			targetLanguage: { type: "string", description: "Idioma objetivo (por ejemplo `es`)." },
			shortDescription: { type: "string", description: "Descripción corta de qué hace la marca." },
			productsAndServices: {
				type: "array",
				items: { type: "string" },
				description: "Productos y servicios, que alimentan la generación de bibliotecas de prompts.",
			},
			keywords: { type: "array", items: { type: "string" }, description: "Palabras clave de la marca." },
		},
		required: ["name", "website"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const name = requireString(args, "name");
		const website = requireString(args, "website");
		const host = hostOf(website);
		if (host === null) throw new ToolInputError(`"website" no es una URL usable: ${website}`);
		const providedId = optionalString(args, "id");
		const additionalDomains = optionalStringArray(args, "additionalDomains");
		const aliases = optionalStringArray(args, "aliases");
		const targetMarket = optionalString(args, "targetMarket");
		const targetLanguage = optionalString(args, "targetLanguage");
		const shortDescription = optionalString(args, "shortDescription");
		const productsAndServices = optionalStringArray(args, "productsAndServices");
		const keywords = optionalStringArray(args, "keywords");

		const existing = await db
			.select({ id: brands.id, website: brands.website, additionalDomains: brands.additionalDomains })
			.from(brands);
		const byHost = existing.find(
			(row) => hostOf(row.website) === host || row.additionalDomains.some((domain) => hostOf(domain) === host),
		);
		const byId = providedId === undefined ? undefined : existing.find((row) => row.id === providedId);

		if (byId !== undefined && byHost !== undefined && byId.id !== byHost.id) {
			throw new ToolInputError(
				`El host "${host}" ya pertenece a la marca "${byHost.id}"; no se reasigna a "${byId.id}".`,
			);
		}

		const target = byId ?? byHost;
		if (target !== undefined) {
			const patch: Partial<NewBrand> = { name, website };
			if (additionalDomains !== undefined) patch.additionalDomains = additionalDomains;
			if (aliases !== undefined) patch.aliases = aliases;
			if (targetMarket !== undefined) patch.targetMarket = targetMarket;
			if (targetLanguage !== undefined) patch.targetLanguage = targetLanguage;
			if (shortDescription !== undefined) patch.shortDescription = shortDescription;
			if (productsAndServices !== undefined) patch.productsAndServices = productsAndServices;
			if (keywords !== undefined) patch.keywords = keywords;
			await db.update(brands).set(patch).where(eq(brands.id, target.id));
			const payload = { brandId: target.id, created: false };
			return textResult(`La marca "${target.id}" ya existía para el host ${host}; se actualizó.`, payload);
		}

		const brandId = providedId ?? uniqueBrandId(brandIdFromHost(host), new Set(existing.map((row) => row.id)));
		const values: NewBrand = { id: brandId, name, website };
		if (additionalDomains !== undefined) values.additionalDomains = additionalDomains;
		if (aliases !== undefined) values.aliases = aliases;
		if (targetMarket !== undefined) values.targetMarket = targetMarket;
		if (targetLanguage !== undefined) values.targetLanguage = targetLanguage;
		if (shortDescription !== undefined) values.shortDescription = shortDescription;
		if (productsAndServices !== undefined) values.productsAndServices = productsAndServices;
		if (keywords !== undefined) values.keywords = keywords;
		await db.insert(brands).values(values);
		const payload = { brandId, created: true };
		return textResult(`Marca "${brandId}" creada para el host ${host}.`, payload);
	},
};

const ensureEntity: McpTool = {
	name: "ensure_entity",
	title: "Asegurar una entidad de marca",
	description:
		"Crea o actualiza una entidad (la marca paraguas o uno de sus productos) de forma idempotente: busca por `maasyProjectId` si lo mandás, y si no por el host de `websiteUrl`. Devuelve el `entityId` que usan los demás tools. Valida que el `parentEntityId` sea de la misma marca y que no se forme un ciclo, porque una jerarquía rota hace fallar la generación de assets. Los campos que no mandás no se tocan.",
	inputSchema: {
		type: "object",
		properties: {
			brandId: { type: "string", description: "Id de la marca dueña (ver ensure_brand o list_brands)." },
			name: { type: "string", description: "Nombre de la entidad." },
			websiteUrl: { type: "string", description: "Web de la entidad. Su host es clave de idempotencia." },
			entityType: {
				type: "string",
				enum: ["umbrella", "product"],
				description: "`umbrella` para la raíz que firma la jerarquía; `product` para lo que cuelga de ella.",
			},
			parentEntityId: {
				type: "string",
				description: "UUID de la entidad padre. Obligatorio en la práctica para un producto.",
			},
			maasyProjectId: {
				type: "string",
				description: "Id del proyecto en Maasy. Es la otra clave de idempotencia y lo que habilita sincronizar el DNA.",
			},
			isPrimary: { type: "boolean", description: "Marca esta entidad como la principal de la marca." },
		},
		required: ["brandId", "name", "entityType"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const name = requireString(args, "name");
		const entityType = requireEnum(args, "entityType", ENTITY_TYPES);
		const websiteUrl = optionalString(args, "websiteUrl");
		const parentEntityId = optionalUuid(args, "parentEntityId");
		const maasyProjectId = optionalString(args, "maasyProjectId");
		const isPrimary = optionalBoolean(args, "isPrimary");

		const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId)).limit(1);
		if (brand === undefined) {
			throw new ToolInputError(`No existe la marca "${brandId}". Creala primero con ensure_brand o mirá list_brands.`);
		}

		const siteHost = websiteUrl === undefined ? null : hostOf(websiteUrl);
		if (websiteUrl !== undefined && siteHost === null) {
			throw new ToolInputError(`"websiteUrl" no es una URL usable: ${websiteUrl}`);
		}

		const rows = await db
			.select({
				id: agentBrandEntities.id,
				parentEntityId: agentBrandEntities.parentEntityId,
				websiteUrl: agentBrandEntities.websiteUrl,
				maasyProjectId: agentBrandEntities.maasyProjectId,
			})
			.from(agentBrandEntities)
			.where(eq(agentBrandEntities.brandId, brandId));

		const byProject =
			maasyProjectId === undefined ? undefined : rows.find((row) => row.maasyProjectId === maasyProjectId);
		const byHost = siteHost === null ? undefined : rows.find((row) => hostOf(row.websiteUrl) === siteHost);
		const existing = byProject ?? byHost;

		assertEntityHierarchy(rows, existing?.id ?? null, parentEntityId);

		if (existing !== undefined) {
			const patch: Partial<NewAgentBrandEntity> = { name, entityType };
			if (websiteUrl !== undefined) patch.websiteUrl = websiteUrl;
			if (parentEntityId !== undefined) patch.parentEntityId = parentEntityId;
			if (maasyProjectId !== undefined) patch.maasyProjectId = maasyProjectId;
			if (isPrimary !== undefined) patch.isPrimary = isPrimary;
			await db
				.update(agentBrandEntities)
				.set(patch)
				.where(and(eq(agentBrandEntities.id, existing.id), eq(agentBrandEntities.brandId, brandId)));
			const payload = { entityId: existing.id, created: false };
			return textResult(`La entidad "${existing.id}" ya existía; se actualizó.`, payload);
		}

		const values: NewAgentBrandEntity = { brandId, name, entityType, websiteUrl: websiteUrl ?? null };
		if (parentEntityId !== undefined) values.parentEntityId = parentEntityId;
		if (maasyProjectId !== undefined) values.maasyProjectId = maasyProjectId;
		if (isPrimary !== undefined) values.isPrimary = isPrimary;
		const [inserted] = await db.insert(agentBrandEntities).values(values).returning({ id: agentBrandEntities.id });
		const payload = { entityId: inserted.id, created: true };
		return textResult(`Entidad "${inserted.id}" creada para la marca "${brandId}".`, payload);
	},
};

const startApsRun: McpTool = {
	name: "start_aps_run",
	title: "Encolar una corrida APS",
	description:
		"Encola una medición APS real para una entidad: los modelos responden la biblioteca de prompts activa y el worker la puntúa. Es la misma corrida que dispara el botón de la UI, con el mismo guardián de presupuesto. NO genera la biblioteca: si la entidad no tiene una activa, la corrida no se encola y el error dice exactamente qué falta, porque crear la biblioteca es una decisión de producto. Usalo solo cuando el consumidor quiera medir de nuevo; para leer una corrida ya hecha está list_aps_runs y get_aps_score_detail.",
	inputSchema: {
		type: "object",
		properties: {
			brandId: { type: "string", description: "Id de la marca dueña de la entidad." },
			entityId: { type: "string", description: "UUID de la entidad a medir." },
			models: {
				type: "array",
				items: { type: "string" },
				description: "Modelos de medición. Si falta, se usan los configurados en el servidor.",
			},
			repetitions: {
				type: "integer",
				minimum: 1,
				maximum: 5,
				description: "Repeticiones por prompt y modelo (por defecto 3). El presupuesto puede reducirlas.",
			},
		},
		required: ["brandId", "entityId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const entityId = requireUuid(args, "entityId");
		const models = optionalStringArray(args, "models");
		const repetitions = optionalInteger(args, "repetitions", { min: 1, max: 5, fallback: 3 });

		const result = await startApsRunForBrand({ brandId, entityId, models, repetitions });
		if (result.ok === false) {
			const missingLibrary = result.libraryVersion === null;
			const text = [
				"No se encoló la corrida APS. Motivos:",
				...result.reasons.map((reason) => `- ${reason}`),
				missingLibrary
					? "La entidad no tiene biblioteca de prompts activa: hay que generarla y guardarla desde la pantalla de APS (el MCP no la crea sola)."
					: `Biblioteca activa v${result.libraryVersion} con ${result.prompts} prompts habilitados.`,
			].join("\n");
			return errorResult(text, {
				ok: false,
				reasons: result.reasons,
				libraryVersion: result.libraryVersion,
				prompts: result.prompts,
				models: result.models,
			});
		}

		const payload = {
			runId: result.runId,
			status: result.status,
			models: result.models,
			plannedCalls: result.plannedCalls,
			estimate: result.estimate,
			libraryVersion: result.libraryVersion,
			prompts: result.prompts,
		};
		return textResult(json(payload), payload);
	},
};

const syncBrandDna: McpTool = {
	name: "sync_brand_dna",
	title: "Sincronizar el Brand DNA desde Maasy",
	description:
		"Trae el contexto de marca que Maasy tiene del proyecto vinculado a la entidad y lo guarda como snapshot; es el DNA del que se generan los assets agénticos. Usalo después de vincular el proyecto y antes de generar assets, para que el bundle no salga con el DNA viejo. Devuelve `hasClaims`, que dice si el DNA trazó afirmaciones verificables: hoy Maasy no las manda, así que un `false` es información, no un error.",
	inputSchema: {
		type: "object",
		properties: {
			brandId: { type: "string", description: "Id de la marca dueña de la entidad." },
			entityId: { type: "string", description: "UUID de la entidad a sincronizar (ver get_brand)." },
		},
		required: ["brandId", "entityId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const entityId = requireUuid(args, "entityId");
		const result = await syncAgentDnaForEntity(brandId, entityId);
		const payload = {
			synced: true as const,
			syncedAt: result.syncedAt.toISOString(),
			hasClaims: result.hasClaims,
			maasyProjectId: result.maasyProjectId,
			hash: result.hash,
		};
		return textResult(json(payload), payload);
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

export const actionTools: McpTool[] = [
	ensureBrand,
	ensureEntity,
	startApsRun,
	syncBrandDna,
	generateAgentAssetsTool,
	publishAgentAssets,
];
