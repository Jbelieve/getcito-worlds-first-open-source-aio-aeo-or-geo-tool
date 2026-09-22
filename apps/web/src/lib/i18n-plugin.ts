import type { Plugin } from "vite";
import { ES_TEXT, ES_UI } from "./i18n-es";

function escapeRegExp(value: string): string {
return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string): string {
return value.replace(/\s+/g, " ").trim();
}

export function beaosI18nEs(): Plugin {
return {
name: "beaos-i18n-es",
enforce: "pre",
transform(code, id) {
const cleanId = id.split("?")[0];
if (cleanId.endsWith(".ts") === false && cleanId.endsWith(".tsx") === false) return null;
if (cleanId.includes("/apps/web/src/") === false && cleanId.includes("/packages/ui/src/") === false) return null;
if (cleanId.endsWith("/lib/i18n-es.ts")) return null;
if (cleanId.endsWith("/lib/i18n-plugin.ts")) return null;

let out = code;
for (const [en, es] of Object.entries(ES_UI)) {
if (en === es || en.trim() === "") continue;
out = out.split(JSON.stringify(en)).join(JSON.stringify(es));
const textRe = new RegExp(">(\\s*)" + escapeRegExp(en) + "(\\s*)<", "g");
out = out.replace(textRe, ">$1" + es + "$2<");
}
for (const [en, es] of Object.entries(ES_TEXT)) {
if (en === es || en.trim() === "") continue;
const beforeTag = new RegExp(">(\\s*)" + escapeRegExp(en) + "(\\s*)<", "g");
out = out.replace(beforeTag, ">$1" + es + "$2<");
const beforeExpr = new RegExp(">(\\s*)" + escapeRegExp(en) + "(\\s*)\\{", "g");
out = out.replace(beforeExpr, ">$1" + es + "$2{");
}
if (cleanId.endsWith(".tsx")) {
out = out.replace(/>([\s\S]*?)</g, (match, inner) => {
const es = ES_UI[normalizeText(inner)] ?? ES_TEXT[normalizeText(inner)];
return es ? ">" + es + "<" : match;
});
out = out.replace(/>([\s\S]*?)\{/g, (match, inner) => {
const es = ES_UI[normalizeText(inner)] ?? ES_TEXT[normalizeText(inner)];
return es ? ">" + es + " {" : match;
});
}
return out === code ? null : out;
},
};
}
