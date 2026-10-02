import { describe, expect, it } from "vitest";
import {
	describeReportedModelVersion,
	MODEL_VERSION_UNKNOWN,
	reportedModelVersion,
	resolveReportedModelVersion,
} from "./model-version";

describe("reportedModelVersion — lo que el proveedor informó, o nada", () => {
	it("devuelve la versión cuando el proveedor la informa", () => {
		expect(reportedModelVersion("gpt-5.5-2026-01-01")).toBe("gpt-5.5-2026-01-01");
		expect(reportedModelVersion("openai/gpt-5-mini-2025-08-07")).toBe("openai/gpt-5-mini-2025-08-07");
	});

	it("sin dato devuelve null: 'no lo sé' no es un modelo", () => {
		expect(reportedModelVersion(undefined)).toBeNull();
		expect(reportedModelVersion(null)).toBeNull();
		expect(reportedModelVersion("")).toBeNull();
		expect(reportedModelVersion("   ")).toBeNull();
	});

	it("un valor igual al pedido es un dato real, no un fallback", () => {
		// Le pedimos gpt-4o y contestó gpt-4o: es información, no una invención.
		expect(reportedModelVersion("gpt-4o")).toBe("gpt-4o");
	});

	it("no convierte el nombre pedido en la respuesta: eso lo decide el extractor", () => {
		// El bug de `result.model_name ?? modelName` se saca en el origen. Este módulo no
		// adivina: si le pasan undefined, no hay versión reportada.
		expect(reportedModelVersion(undefined)).not.toBe("chatgpt");
		expect(resolveReportedModelVersion(undefined)).toBeNull();
	});
});

describe("describeReportedModelVersion — cómo se muestra el 'no lo sé'", () => {
	it("declara `unknown` en vez de dejar el hueco vacío", () => {
		expect(describeReportedModelVersion(null)).toBe(MODEL_VERSION_UNKNOWN);
	});

	it("muestra la versión reportada cuando existe", () => {
		expect(describeReportedModelVersion("claude-sonnet-4-5-20250929")).toBe("claude-sonnet-4-5-20250929");
	});
});
