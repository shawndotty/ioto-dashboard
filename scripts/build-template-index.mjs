#!/usr/bin/env node
/**
 * Builds templates/index.json — the aggregate index consumed by the template
 * center's raw GET path. One raw request then returns every template's meta
 * and full bundle, so listing and importing cost 0 `/api/v5/` requests.
 *
 * Usage: node scripts/build-template-index.mjs
 * Run it whenever a template dashboard.json changes, then commit the
 * generated index.json — the release script pushes both remotes together.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATES_DIR = path.join(ROOT, "templates");
const INDEX_FILE = path.join(TEMPLATES_DIR, "index.json");

/** Mirrors `extractTemplateMeta` in src/dashboard/template-center.ts. */
function extractMeta(bundle, key) {
	const kind = bundle.kind;
	const source =
		bundle.source && typeof bundle.source === "object" && !Array.isArray(bundle.source)
			? bundle.source
			: null;
	const pageNames = source?.pageNames;
	const name =
		Array.isArray(pageNames) && typeof pageNames[0] === "string"
			? pageNames[0]
			: key;
	const subtitle =
		source && typeof source.dashboardName === "string"
			? source.dashboardName
			: "";
	const description =
		source && typeof source.description === "string"
			? source.description
			: "";
	return {
		name,
		subtitle,
		description,
		kind: typeof kind === "string" ? kind : "",
		supported: kind === "ioto-dashboard-page",
	};
}

const entries = await readdir(TEMPLATES_DIR, { withFileTypes: true });
const slugs = entries
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort();

const templates = [];
for (const key of slugs) {
	const file = path.join(TEMPLATES_DIR, key, "dashboard.json");
	let bundle;
	try {
		bundle = JSON.parse(await readFile(file, "utf8"));
	} catch (error) {
		console.warn(`跳过 ${key}: 无法读取 dashboard.json (${error.message})`);
		continue;
	}
	if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
		console.warn(`跳过 ${key}: dashboard.json 不是对象`);
		continue;
	}
	templates.push({ key, meta: extractMeta(bundle, key), bundle });
}

const index = {
	version: 1,
	generatedAt: new Date().toISOString(),
	templates,
};

await writeFile(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`已生成 ${path.relative(ROOT, INDEX_FILE)}：${templates.length} 个模板`);
