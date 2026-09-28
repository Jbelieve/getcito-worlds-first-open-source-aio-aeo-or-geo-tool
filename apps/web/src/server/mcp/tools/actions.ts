/**
 * Las acciones del MCP: lo que **escribe**.
 *
 * Regla que no se negocia: una acción por el MCP es la misma acción de la UI. `generate_agent_assets` y
 * `publish_agent_assets` llaman a `agent-assets-core`, así que si el guardián de claims bloquea una
 * publicación, el bloqueo también aparece acá —no hay una puerta más permisiva para los agentes—.
 * `start_aps_run` llama a `agent-aps-core`, que es lo que corre cuando el operador aprieta el botón, con
 * el mismo guardián de presupuesto. `sync_brand_dna` llama a `agent-maasy-core`.
 *
 * Las herramientas de "asegurar" (`ensure_brand`, `ensure_entity`, `ensure_prompt_library`) son las
 * únicas que crean filas, y son idempotentes a propósito: un consumidor que reintenta no duplica una
 * marca, no rompe una jerarquía ni quema una generación de biblioteca.
 */

import { db } from "@workspace/lib/db/db";
import { brands, type NewBrand } from "@workspace/lib/db/schema";
import { eq } from "drizzle-orm";
import { hostOf } from "@/lib/report-agent";
import { ensurePromptLibraryForEntity, PromptLibraryError, startApsRunForBrand } from "@/server/agent-aps-core";
import { generateAssetsForEntity, setEntityPublished } from "@/server/agent-assets-core";
import { EnsureEntityError, ensureEntity as ensureEntityCore } from "@/server/agent-entities-core";
import { syncAgentDnaForEntity } from "@/server/agent-maasy-core";
import { ClaimNotFoundError, setClaimInheritable as setClaimInheritableCore } from "@/server/claims-core";
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

		// La lógica vive en `agent-entities-core` para que la UI cree entidades por la misma puerta.
		// El mensaje de error se traduce a `ToolInputError` para no cambiar el contrato del tool.
		let result: Awaited<ReturnType<typeof ensureEntityCore>>;
		try {
			result = await ensureEntityCore({
				brandId,
				name,
				entityType,
				websiteUrl,
				parentEntityId,
				maasyProjectId,
				isPrimary,
			});
		} catch (error) {
			if (error instanceof EnsureEntityError) throw new ToolInputError(error.message);
			throw error;
		}

		// El payload sigue siendo `{ entityId, created }`: `updated` es información nueva del núcleo,
		// no un cambio de contrato para los consumidores que ya están en producción.
		const payload = { entityId: result.entityId, created: result.created };
		const text = result.created
			? `Entidad "${result.entityId}" creada para la marca "${brandId}".`
			: `La entidad "${result.entityId}" ya existía; se actualizó.`;
		return textResult(text, payload);
	},
};

const startApsRun: McpTool = {
	name: "start_aps_run",
	title: "Encolar una corrida APS",
	description:
		"Encola una medición APS real para una entidad: los modelos responden la biblioteca de prompts activa y el worker la puntúa. Es la misma corrida que dispara el botón de la UI, con el mismo guardián de presupuesto. Si la entidad **no tiene biblioteca activa, la genera y sigue**: el resultado trae `libraryGenerated: true` para que el consumidor sepa que la medición usa una biblioteca recién creada. Si la generación falla, falla con el motivo y no encola nada. Usalo solo cuando el consumidor quiera medir de nuevo; para leer una corrida ya hecha está list_aps_runs y get_aps_score_detail.",
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

		// Antes esto trababa la corrida; ahora la biblioteca se asegura acá. La generación no es silenciosa:
		// si falla, no se encola nada y el motivo viaja en la respuesta.
		let libraryGenerated = false;
		try {
			const library = await ensurePromptLibraryForEntity({ brandId, entityId, force: false });
			libraryGenerated = library.created;
		} catch (error) {
			if (error instanceof PromptLibraryError) {
				const text = `No se encoló la corrida APS: la biblioteca de prompts no se pudo preparar.\n- ${error.message}`;
				return errorResult(text, { ok: false, reasons: [error.message], libraryGenerated: false });
			}
			throw error;
		}

		const result = await startApsRunForBrand({ brandId, entityId, models, repetitions });
		if (result.ok === false) {
			const text = [
				"No se encoló la corrida APS. Motivos:",
				...result.reasons.map((reason) => `- ${reason}`),
				result.libraryVersion === null
					? "La entidad quedó sin biblioteca de prompts activa."
					: `Biblioteca activa v${result.libraryVersion} con ${result.prompts} prompts habilitados.`,
			].join("\n");
			return errorResult(text, {
				ok: false,
				reasons: result.reasons,
				libraryVersion: result.libraryVersion,
				prompts: result.prompts,
				models: result.models,
				libraryGenerated,
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
			libraryGenerated,
		};
		return textResult(json(payload), payload);
	},
};

/**
 * La biblioteca de prompts APS: se genera sola **y** se puede revisar.
 *
 * Es la puerta simétrica de `ensure_entity`: idempotente por entidad y explícita cuando se fuerza. No
 * marca nada como "aprobada" porque ese concepto no existe en el modelo: una biblioteca nace `active` y
 * la anterior pasa a `superseded`, que es el mecanismo de versión que ya usa el worker.
 */
const ensurePromptLibrary: McpTool = {
	name: "ensure_prompt_library",
	title: "Asegurar la biblioteca de prompts APS",
	description:
		"Genera la biblioteca de prompts APS de una entidad si no tiene una activa, y devuelve los prompts (id, texto, categoría y etapa de funnel). Si ya tiene una activa y no mandás `force`, devuelve esa tal cual con `created: false`: es idempotente y no gasta una generación. Con `force: true` genera una versión nueva, que supersede a la anterior aunque esté dentro del bloqueo de 90 días —cambiar el instrumento arranca una serie nueva—. No existe el estado 'aprobada': la biblioteca queda `active` y la anterior `superseded`. Usala antes de start_aps_run si querés revisar los prompts primero.",
	inputSchema: {
		type: "object",
		properties: {
			brandId: { type: "string", description: "Id de la marca dueña de la entidad." },
			entityId: { type: "string", description: "UUID de la entidad (ver get_brand)." },
			force: {
				type: "boolean",
				description: "true para generar una versión nueva aunque ya haya una activa. Por defecto false.",
			},
		},
		required: ["brandId", "entityId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const entityId = requireUuid(args, "entityId");
		const force = optionalBoolean(args, "force") ?? false;

		let library: Awaited<ReturnType<typeof ensurePromptLibraryForEntity>>;
		try {
			library = await ensurePromptLibraryForEntity({ brandId, entityId, force });
		} catch (error) {
			if (error instanceof PromptLibraryError) {
				return errorResult(`No se pudo asegurar la biblioteca de prompts: ${error.message}`, {
					ok: false,
					reasons: [error.message],
				});
			}
			throw error;
		}

		const payload = {
			entityId,
			libraryId: library.libraryId,
			version: library.version,
			created: library.created,
			rejected: library.rejected,
			promptCount: library.prompts.length,
			prompts: library.prompts.map((prompt) => ({
				id: prompt.id,
				text: prompt.text,
				category: prompt.kind,
				funnelStage: prompt.funnelStage,
				enabled: prompt.enabled,
			})),
		};
		const text = library.created
			? `Biblioteca v${library.version} generada para la entidad "${entityId}": ${library.prompts.length} prompts (${library.rejected} descartados).`
			: `La entidad "${entityId}" ya tenía la biblioteca v${library.version} activa: se devuelve tal cual (${library.prompts.length} prompts).`;
		return textResult(text, payload);
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

/**
 * La marca de heredable, por MCP.
 *
 * Es la misma acción de la pantalla de Pruebas, contra el mismo núcleo: si un consumidor marca un caso de
 * cliente como heredable, cada sub-entidad lo va a firmar como propio. El tool devuelve el estado nuevo
 * para que el consumidor no tenga que releer, y no crea filas: una prueba que no existe no se inventa.
 */
const setClaimInheritable: McpTool = {
	name: "set_claim_inheritable",
	title: "Marcar una prueba como heredable",
	description:
		"Cambia si las sub-entidades de la marca pueden heredar una prueba. Marcala solo si la prueba es de la marca y no de un cliente: una prueba heredada viaja al perfil de cada sub-entidad como propia en la práctica, y un caso de cliente heredado hace que la sub-entidad afirme algo que no hizo. Es la misma acción de la pantalla de Pruebas. Devuelve el estado nuevo; si la prueba no existe en esa entidad, lo dice y no crea nada.",
	inputSchema: {
		type: "object",
		properties: {
			brandId: { type: "string", description: "Id de la marca dueña de la entidad." },
			entityId: { type: "string", description: "UUID de la entidad dueña de la prueba (ver get_brand)." },
			claimId: { type: "string", description: "Id estable de la prueba, por ejemplo CLM-MARCA-100-PROYECTOS." },
			inheritable: { type: "boolean", description: "true para que las sub-entidades la hereden; false para que no." },
		},
		required: ["brandId", "entityId", "claimId", "inheritable"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const entityId = requireUuid(args, "entityId");
		const claimId = requireString(args, "claimId");
		const inheritable = requireBoolean(args, "inheritable");
		try {
			const claim = await setClaimInheritableCore({ brandId, entityId, claimId, inheritable });
			const payload = {
				entityId,
				claimId: claim.claimId,
				inheritable: claim.inheritable,
				status: claim.status,
				updatedAt: claim.updatedAt,
			};
			const text = claim.inheritable
				? `La prueba "${claim.claimId}" quedó heredable por las sub-entidades. Regenerá los assets de cada una para que su perfil la declare.`
				: `La prueba "${claim.claimId}" dejó de ser heredable.`;
			return textResult(text, payload);
		} catch (error) {
			if (error instanceof ClaimNotFoundError) return errorResult(error.message, { ok: false, reason: error.message });
			throw error;
		}
	},
};

export const actionTools: McpTool[] = [
	ensureBrand,
	ensureEntity,
	ensurePromptLibrary,
	startApsRun,
	syncBrandDna,
	generateAgentAssetsTool,
	publishAgentAssets,
	setClaimInheritable,
];
