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
 * marca, no rompe una jerarquía ni quema una generación de biblioteca. `upsert_claim` y `delete_claim`
 * escriben la capa de pruebas con el mismo núcleo de la pantalla (`claims-core`), que es la única puerta
 * del alta: si el MCP validara por su cuenta, podría guardar lo que la pantalla rechaza.
 */

import { CONFIDENTIALITY, VERIFIABLE_BY } from "@workspace/aos-aps/preference";
import { db } from "@workspace/lib/db/db";
import { brands, type NewBrand } from "@workspace/lib/db/schema";
import { eq } from "drizzle-orm";
import { resolveBrandIdentity } from "@/lib/brand-id";
import { hostOf } from "@/lib/report-agent";
import { ensurePromptLibraryForEntity, PromptLibraryError, startApsRunForBrand } from "@/server/agent-aps-core";
import { generateAssetsForEntity, setEntityPublished } from "@/server/agent-assets-core";
import { EnsureEntityError, ensureEntity as ensureEntityCore } from "@/server/agent-entities-core";
import { syncAgentDnaForEntity } from "@/server/agent-maasy-core";
import {
	ClaimEntityNotFoundError,
	ClaimInputError,
	ClaimNotFoundError,
	deleteClaim as deleteClaimCore,
	setClaimInheritable as setClaimInheritableCore,
	upsertClaim as upsertClaimCore,
} from "@/server/claims-core";
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
			.select({
				id: brands.id,
				name: brands.name,
				website: brands.website,
				additionalDomains: brands.additionalDomains,
			})
			.from(brands);
		// El criterio vive en `@/lib/brand-id` y es el mismo que usa la UI
		// (`createBrandForCurrentUserFn`): un alta por MCP y un alta por `/admin` no pueden divergir.
		const identity = resolveBrandIdentity({
			website,
			existing,
			...(providedId === undefined ? {} : { providedId }),
		});
		if ("error" in identity) throw new ToolInputError(identity.error);

		if (identity.action === "reuse") {
			const target = existing.find((row) => row.id === identity.brandId);
			if (target === undefined) throw new ToolInputError(`No se pudo resolver la marca "${identity.brandId}".`);
			const byHost = identity.matchedBy === "host";
			// Un reuso por host actualiza la marca con lo que mandó el consumidor; un reuso por id
			// explícito también, porque el consumidor declaró que quiere escribir sobre esa marca.
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
			const reason = byHost ? `ya existía para el host ${host}` : `ya existía con el id "${target.id}"`;
			return textResult(`La marca "${target.id}" ${reason}; se actualizó.`, payload);
		}

		const values: NewBrand = { id: identity.brandId, name, website };
		if (additionalDomains !== undefined) values.additionalDomains = additionalDomains;
		if (aliases !== undefined) values.aliases = aliases;
		if (targetMarket !== undefined) values.targetMarket = targetMarket;
		if (targetLanguage !== undefined) values.targetLanguage = targetLanguage;
		if (shortDescription !== undefined) values.shortDescription = shortDescription;
		if (productsAndServices !== undefined) values.productsAndServices = productsAndServices;
		if (keywords !== undefined) values.keywords = keywords;
		await db.insert(brands).values(values);
		const payload = { brandId: identity.brandId, created: true };
		return textResult(`Marca "${identity.brandId}" creada para el host ${host}.`, payload);
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
			confirmMissingCategory: {
				type: "boolean",
				description:
					"true para generar la biblioteca aunque la marca no declare categoría (`industry` en el DNA). Por defecto false: sin categoría la generación se corta ANTES de gastar la llamada, porque una biblioteca calibrada con el marcador genérico «marketing/software» sale mal calibrada y se bloquea 90 días.",
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
		const confirmMissingCategory = optionalBoolean(args, "confirmMissingCategory") ?? false;

		// Antes esto trababa la corrida; ahora la biblioteca se asegura acá. La generación no es silenciosa:
		// si falla, no se encola nada y el motivo viaja en la respuesta.
		let libraryGenerated = false;
		try {
			const library = await ensurePromptLibraryForEntity({
				brandId,
				entityId,
				force: false,
				confirmMissingCategory,
			});
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
		"Genera la biblioteca de prompts APS de una entidad si no tiene una activa, y devuelve los prompts (id, texto, categoría y etapa de funnel). Si ya tiene una activa y no mandás `force`, devuelve esa tal cual con `created: false`: es idempotente y no gasta una generación. Con `force: true` genera una versión nueva, que supersede a la anterior aunque esté dentro del bloqueo de 90 días —cambiar el instrumento arranca una serie nueva—. La biblioteca se calibra con la categoría que la marca declara (`industry` del DNA sincronizado): si no la declara, la generación se corta ANTES de gastar la llamada con el aviso de que puede salir mal calibrada, y solo sigue con `confirmMissingCategory: true`. La respuesta trae `calibrationCategory` para que se sepa con qué se calibró. No existe el estado 'aprobada': la biblioteca queda `active` y la anterior `superseded`. Usala antes de start_aps_run si querés revisar los prompts primero.",
	inputSchema: {
		type: "object",
		properties: {
			brandId: { type: "string", description: "Id de la marca dueña de la entidad." },
			entityId: { type: "string", description: "UUID de la entidad (ver get_brand)." },
			force: {
				type: "boolean",
				description: "true para generar una versión nueva aunque ya haya una activa. Por defecto false.",
			},
			confirmMissingCategory: {
				type: "boolean",
				description:
					"true para generar aunque la marca no declare categoría (`industry` en el DNA). Por defecto false: sin categoría la generación se corta ANTES de gastar la llamada, porque una biblioteca calibrada con el marcador genérico «marketing/software» sale mal calibrada y se bloquea 90 días.",
			},
		},
		required: ["brandId", "entityId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const entityId = requireUuid(args, "entityId");
		const force = optionalBoolean(args, "force") ?? false;
		const confirmMissingCategory = optionalBoolean(args, "confirmMissingCategory") ?? false;

		let library: Awaited<ReturnType<typeof ensurePromptLibraryForEntity>>;
		try {
			library = await ensurePromptLibraryForEntity({ brandId, entityId, force, confirmMissingCategory });
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
			// Con qué categoría se calibró esta biblioteca. `null` cuando la marca no la declara y la
			// generación se confirmó igual: el consumidor tiene que poder saber que el instrumento salió
			// con el marcador genérico, no con la categoría real.
			calibrationCategory: library.category,
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
			? `Biblioteca v${library.version} generada para la entidad "${entityId}": ${library.prompts.length} prompts (${library.rejected} descartados).${
					library.category === null
						? " Se generó SIN categoría declarada: se usó el marcador genérico «marketing/software» como calibración, así que los prompts pueden ser demasiado generales."
						: ` Calibrada con la categoría "${library.category}".`
				}`
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
 * El alta de una prueba, por MCP.
 *
 * Es la pieza que faltaba: por acá se podía crear la marca y la entidad, pero no la prueba, que es lo que
 * decide si la marca puede publicar. Sin esto, un producto como Autex creaba la marca y se trababa en la
 * capa que BeAOS tiene y Maasy no.
 *
 * El claim **nace en BeAOS**: Maasy manda la evidencia en prosa y la estructura (id, límites, con qué
 * documento se verifica) la pone quien la afirma. El tool no deduce nada de un texto libre —no inventa
 * pruebas—, solo guarda lo que el consumidor ya decidió afirmar.
 */
const upsertClaim: McpTool = {
	name: "upsert_claim",
	title: "Dar de alta o editar una prueba",
	description:
		"Crea o actualiza una prueba de la marca —afirmación, número, límites y el documento que la prueba— y devuelve el claim guardado con el mismo serializador que list_claims, así el consumidor no tiene que volver a leerlo. Usala cuando haya evidencia concreta que ya se puede afirmar: un resultado medido, un testimonio, una metodología, un volumen de trabajo. **La prueba nace en BeAOS, no en Maasy**: Maasy manda la evidencia en prosa (client_results, testimonials, social_proof_count) y la estructura la pone acá quien la afirma, con el fragmento original en `sourceFragment` para que se lea qué se confirmó; BeAOS no convierte un texto en una prueba por su cuenta. El `claimId` es del operador y tiene que cumplir CLM-[A-Z0-9-]+: guardar dos veces el mismo id en la misma entidad **actualiza** esa prueba, no la duplica. Es un alta completa, no un parche: los campos opcionales que no mandás quedan vacíos, así que para editar leé primero con get_claim. Con `status: draft` la prueba se guarda pero **no entra al bundle**; recién con `status: confirmed` entra al perfil, y hay que regenerar los assets para que el bundle la declare. Devuelve si se creó o se actualizó, el claim entero y los avisos del estándar (por ejemplo, una prueba sin `verifiableBy` queda declarada como no verificable).",
	inputSchema: {
		type: "object",
		properties: {
			brandId: { type: "string", description: "Id de la marca dueña de la entidad." },
			entityId: { type: "string", description: "UUID de la entidad que firma la prueba (ver get_brand)." },
			claimId: {
				type: "string",
				description: "Id estable de la prueba, con el formato CLM-[A-Z0-9-]+ (ej. CLM-MARCA-100-PROYECTOS).",
			},
			statement: { type: "string", description: "La afirmación, redactada por el humano que la confirma." },
			status: {
				type: "string",
				enum: ["draft", "confirmed"],
				description: "`draft` no entra al bundle; `confirmed` sí, y es lo que el sitio va a firmar.",
			},
			proofType: {
				type: "string",
				description:
					"Tipo de prueba. El del estándar (case_study, testimonial, aggregate_metric, third_party_review, publication, credential) no genera avisos; los propios de BeAOS (document, audit, other) se guardan y el perfil los marca con un aviso APS-CLAIM-01.",
			},
			proofTitle: { type: "string", description: "Título del documento o de la fuente que prueba el claim." },
			metric: { type: "string", description: "El número tal como está en la evidencia (ej. `35%`). No se normaliza." },
			category: {
				type: "string",
				enum: ["outcome", "methodology", "experience", "scope", "performance"],
				description: "Categoría del claim, si el operador la declaró.",
			},
			boundaryApplicableFor: { type: "string", description: "Cuándo SÍ aplica el claim. El estándar lo exige." },
			boundaryNotApplicableFor: { type: "string", description: "Cuándo NO aplica el claim. El estándar lo exige." },
			proofSummary: { type: "string", description: "Resumen de la prueba, tal como se lee en el perfil." },
			proofClient: { type: "string", description: "Cliente de la prueba, si se puede nombrar." },
			verifiableBy: {
				type: "string",
				enum: VERIFIABLE_BY,
				description:
					"Cómo lo comprueba un agente: public_url, third_party_platform, signed_client o internal. Si no viene, la prueba queda declarada como no verificable.",
			},
			confidentiality: {
				type: "string",
				enum: CONFIDENTIALITY,
				description: "Nivel de confidencialidad de la evidencia: public, anonymized o nda.",
			},
			sourceFragment: {
				type: "string",
				description:
					"El texto original de Maasy que el operador confirmó. Copia literal, no un resumen: es la trazabilidad de la prueba.",
			},
			inheritable: {
				type: "boolean",
				description:
					"Si las sub-entidades pueden heredarla. Si no lo mandás, no se toca: heredar es una decisión del operador y editarlo una prueba no puede borrarla de rebote.",
			},
		},
		required: ["brandId", "entityId", "claimId", "statement", "status", "proofType", "proofTitle"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const entityId = requireUuid(args, "entityId");
		const inheritable = optionalBoolean(args, "inheritable");
		try {
			const result = await upsertClaimCore({
				brandId,
				entityId,
				claimId: requireString(args, "claimId"),
				statement: requireString(args, "statement"),
				status: requireString(args, "status"),
				proofType: requireString(args, "proofType"),
				proofTitle: requireString(args, "proofTitle"),
				metric: optionalString(args, "metric"),
				category: optionalString(args, "category"),
				boundaryApplicableFor: optionalString(args, "boundaryApplicableFor"),
				boundaryNotApplicableFor: optionalString(args, "boundaryNotApplicableFor"),
				proofSummary: optionalString(args, "proofSummary"),
				proofClient: optionalString(args, "proofClient"),
				verifiableBy: optionalString(args, "verifiableBy"),
				confidentiality: optionalString(args, "confidentiality"),
				sourceFragment: optionalString(args, "sourceFragment"),
				...(inheritable === undefined ? {} : { inheritable }),
			});
			const payload = {
				entityId,
				created: result.created,
				claim: result.claim,
				warnings: result.warnings,
			};
			const text = [
				result.created
					? `Prueba "${result.claim.claimId}" creada en la entidad "${entityId}".`
					: `La prueba "${result.claim.claimId}" ya existía en esa entidad; se actualizó.`,
				result.claim.status === "draft"
					? "Quedó como borrador: no entra al bundle hasta que se confirme."
					: "Quedó confirmada: regenerá los assets para que el bundle la declare.",
				...(result.warnings.length === 0 ? [] : ["Avisos del estándar:", ...result.warnings.map((w) => `- ${w}`)]),
			].join("\n");
			return textResult(text, payload);
		} catch (error) {
			// Un formulario inválido o una entidad de otra marca son errores que el llamador puede corregir:
			// el mensaje viaja tal cual, con el formato esperado.
			if (error instanceof ClaimInputError || error instanceof ClaimEntityNotFoundError) {
				throw new ToolInputError(error.message);
			}
			throw error;
		}
	},
};

/**
 * La contracara de `upsert_claim`, y con la misma puerta.
 *
 * Borra **de BeAOS**. Un bundle ya publicado sigue sirviendo la prueba hasta que se regenere y se vuelva a
 * publicar: no hay borrado en el sitio por este camino, y decirlo evita que un consumidor crea que
 * despublicó algo.
 */
const deleteClaim: McpTool = {
	name: "delete_claim",
	title: "Borrar una prueba",
	description:
		"Borra una prueba de una entidad por su claimId. Usala cuando la prueba ya no se puede sostener —el cliente retiró el permiso, el número quedó viejo, la afirmación era incorrecta—: una prueba que no se puede verificar es peor que su ausencia. Solo borra filas propias de esa entidad: una prueba que la entidad hereda del paraguas se edita o se borra en el paraguas, y una prueba de otra entidad no se toca. Borrar dos veces no es un error: devuelve `deleted: false` cuando ya no estaba. No despublica nada: si el bundle ya estaba publicado, sigue sirviendo la prueba hasta que regeneres los assets y vuelvas a publicar.",
	inputSchema: {
		type: "object",
		properties: {
			brandId: { type: "string", description: "Id de la marca dueña de la entidad." },
			entityId: { type: "string", description: "UUID de la entidad dueña de la prueba (ver get_brand)." },
			claimId: { type: "string", description: "Id de la prueba a borrar, por ejemplo CLM-MARCA-100-PROYECTOS." },
		},
		required: ["brandId", "entityId", "claimId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const entityId = requireUuid(args, "entityId");
		const claimId = requireString(args, "claimId");
		try {
			const result = await deleteClaimCore({ brandId, entityId, claimId });
			const payload = { entityId, claimId: result.claimId, deleted: result.deleted };
			const text = result.deleted
				? `Prueba "${result.claimId}" borrada de la entidad "${entityId}". Regenerá los assets para que el bundle deje de declararla.`
				: `No existía la prueba "${result.claimId}" en esa entidad: no había nada que borrar.`;
			return textResult(text, payload);
		} catch (error) {
			if (error instanceof ClaimInputError || error instanceof ClaimEntityNotFoundError) {
				throw new ToolInputError(error.message);
			}
			throw error;
		}
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
	upsertClaim,
	deleteClaim,
	generateAgentAssetsTool,
	publishAgentAssets,
	setClaimInheritable,
];
