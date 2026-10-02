#!/usr/bin/env node

/**
 * Cut a single GitHub Release for the current release-train version.
 *
 * Every workspace package shares one version (changesets `fixed: [["**"]]`), so
 * instead of one release per package we publish a single `v<version>` release
 * for the whole product. Run by the Release workflow as the changesets `publish`
 * step: it fires only once the "Version Packages" PR is merged (no pending
 * changesets), so `packages/lib` already holds the freshly-bumped version.
 *
 * Release notes: the section for this version in packages/lib/CHANGELOG.md is
 * used as the body when it holds real changeset entries (so the features you
 * describe in `pnpm changeset` show up on the release). If that section is empty
 * or only internal dep bumps, we fall back to GitHub's auto-generated notes
 * (merged PR / commit titles since the previous tag).
 *
 * Idempotent: skips if a release for the current version already exists, so the
 * re-runs the changesets action triggers on ordinary pushes are harmless.
 *
 * Requires `gh` and a GITHUB_TOKEN with `contents: write` (both provided by the
 * GitHub Actions runner). `gh release create` also creates the git tag.
 *
 * `--wp-plugin` corta el release del **plugin de WordPress de BeAOS**, que es otro tren: su versión vive
 * en la cabecera del plugin, su changelog es el del plugin y el release lleva el ZIP adjunto. Reusa esta
 * misma maquinaria —el chequeo de idempotencia, el tag, las notas del changelog— en vez de tener otra
 * parecida que se desincronice. La sección del changelog es obligatoria en este modo: las notas de un
 * plugin no se pueden generar de los PRs del producto, que son otra cosa.
 *
 *   node scripts/gh-release.mjs --wp-plugin              # tag beaos-aos-v<version> + el ZIP adjunto
 *   node scripts/gh-release.mjs --wp-plugin --dry-run    # imprime lo que haría y no toca GitHub
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readWpPluginVersion, wpPluginZipName } from "./beaos-wp-plugin.mjs";

const argv = process.argv.slice(2);
const wpPlugin = argv.includes("--wp-plugin");
const dryRun = argv.includes("--dry-run");

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

// El tren del plugin de WordPress no comparte versión con los paquetes del monorepo: la suya sale de la
// cabecera del plugin (`apps/beaos-wordpress/beaos-aos.php`) y el tag lleva el prefijo `beaos-aos-` para
// no confundirse con los `v9.x` del producto en la lista de releases.
const version = wpPlugin
  ? readWpPluginVersion()
  : JSON.parse(readFileSync(join(rootDir, "packages/lib/package.json"), "utf8")).version;
const tag = wpPlugin ? `beaos-aos-v${version}` : `v${version}`;
const changelogPath = wpPlugin
  ? join(rootDir, "apps/beaos-wordpress/CHANGELOG.md")
  : join(rootDir, "packages/lib/CHANGELOG.md");

// Lo que viaja adjunto al release. Hoy sólo el plugin tiene un archivo instalable.
const assets = wpPlugin ? [join(rootDir, "dist", wpPluginZipName(version))] : [];

function releaseExists(t) {
  try {
    execFileSync("gh", ["release", "view", t], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Pull the `## <version>` block out of the CHANGELOG (everything up to the next
// `## ` heading). Returns null when the section is missing or has no real entry
// (a bullet that isn't just an internal `@workspace/*` dependency bump).
function changelogSection(v, path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${v}`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start + 1, end).join("\n").trim();
  const hasRealEntry = body
    .split("\n")
    .some((l) => /^-\s+/.test(l.trim()) && !/@workspace\//.test(l));
  return hasRealEntry ? body : null;
}

if (!dryRun && releaseExists(tag)) {
  console.log(`Release ${tag} already exists; nothing to publish.`);
  process.exit(0);
}

if (!dryRun) {
  for (const asset of assets) {
    if (!existsSync(asset)) {
      console.error(
        `ERROR: falta ${asset}. Armá el paquete antes de cortar el release: node scripts/release-wordpress-plugin.mjs`,
      );
      process.exit(1);
    }
  }
}

const args = ["release", "create", tag, "--title", tag, ...assets];
if (process.env.GITHUB_SHA) args.push("--target", process.env.GITHUB_SHA);

const notes = changelogSection(version, changelogPath);
if (notes) {
  const notesFile = join(rootDir, ".release-notes.md");
  writeFileSync(notesFile, notes);
  args.push("--notes-file", notesFile);
} else if (wpPlugin) {
  // Sin sección no hay notas honestas: generar las del producto mezclaría PRs que no son de este release.
  console.error(
    `ERROR: apps/beaos-wordpress/CHANGELOG.md no tiene una sección "## ${version}" con entradas. Escribila antes de publicar.`,
  );
  process.exit(1);
} else {
  args.push("--generate-notes");
}

if (dryRun) {
  console.log(`[dry-run] gh ${args.join(" ")}`);
  process.exit(0);
}

execFileSync("gh", args, { stdio: "inherit" });
console.log(`Published GitHub Release ${tag}.`);
