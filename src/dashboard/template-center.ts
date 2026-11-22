/**
 * Remote template browsing for the template center.
 *
 * Only reads the two public repository APIs; it never writes settings, never
 * reads local `templates/`, and never touches ioto-update. Gitee/GitHub share
 * the same API shape, so the source switch only changes the base URL.
 */

import { requestUrl } from "obsidian";

export type TemplateSource = "gitee" | "github";

export interface TemplateMeta {
	/** Stable key: the folder slug under `templates/`. */
	key: string;
	name: string;
	subtitle: string;
	kind: string;
	/** Whether this kind can be imported (page bundles only in v1). */
	supported: boolean;
}

/** Minimal response shape shared by `requestUrl` and injected test doubles. */
export interface TemplateResponse {
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
}

export type TemplateFetcher = (url: string) => Promise<TemplateResponse>;

export interface TemplateFetchOptions {
	/** Injected for tests; defaults to an Obsidian `requestUrl` adapter. */
	fetchImpl?: TemplateFetcher;
	/** Injected for cache TTL tests; defaults to Date.now(). */
	now?: number;
}

const REPO_API: Record<TemplateSource, string> = {
	gitee: "https://gitee.com/api/v5/repos/johnnylearns/ioto-dashboard",
	github: "https://api.github.com/repos/shawndotty/ioto-dashboard",
};

export const TEMPLATE_CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
	at: number;
	templates: TemplateMeta[];
}

interface ApiEntry {
	type?: string;
	name?: string;
	sha?: string;
}

const cache = new Map<TemplateSource, CacheEntry>();

/** Obsidian forbids raw `fetch`; adapt requestUrl into a JSON response. */
const defaultFetcher: TemplateFetcher = async (url) => {
	const response = await requestUrl({ url });
	const body: unknown = response.json;
	return {
		ok: response.status >= 200 && response.status < 300,
		status: response.status,
		json: async () => body,
	};
};

export function apiBase(source: TemplateSource): string {
	return REPO_API[source];
}

/** Gitee must never receive `access_token=` — even an empty value yields 401. */
export function listTemplatesUrl(source: TemplateSource): string {
	return `${apiBase(source)}/contents/templates?ref=master`;
}

export function templateDirUrl(source: TemplateSource, slug: string): string {
	return `${apiBase(source)}/contents/templates/${encodeURIComponent(slug)}`;
}

export function blobUrl(source: TemplateSource, sha: string): string {
	return `${apiBase(source)}/git/blobs/${encodeURIComponent(sha)}`;
}

/** base64 (API `content`) → UTF-8 text; keeps multi-byte page names intact. */
export function decodeBase64Utf8(content: string): string {
	const binary = atob(content.replace(/\s/g, ""));
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

export function isSupportedKind(kind: unknown): boolean {
	return kind === "ioto-dashboard-page";
}

/** Visible-but-disabled kinds get a greyed-out card; the rest are filtered. */
export function isVisibleKind(kind: unknown): boolean {
	return (
		kind === "ioto-dashboard-page" ||
		kind === "ioto-dashboard" ||
		kind === "ioto-dashboard-query"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

function asEntries(value: unknown): ApiEntry[] | null {
	if (!isUnknownArray(value)) return null;
	return value.filter(isRecord).map((item) => ({
		type: typeof item.type === "string" ? item.type : undefined,
		name: typeof item.name === "string" ? item.name : undefined,
		sha: typeof item.sha === "string" ? item.sha : undefined,
	}));
}

function asBlobContent(value: unknown): string | null {
	if (!isRecord(value) || typeof value.content !== "string") return null;
	return value.content;
}

export function extractTemplateMeta(
	envelope: unknown,
	slug: string,
): TemplateMeta | null {
	if (!isRecord(envelope)) return null;
	const kind = envelope.kind;
	const source = isRecord(envelope.source) ? envelope.source : null;
	const pageNames = source?.pageNames;
	const name =
		isUnknownArray(pageNames) && typeof pageNames[0] === "string"
			? pageNames[0]
			: slug;
	const subtitle =
		source && typeof source.dashboardName === "string"
			? source.dashboardName
			: "";
	return {
		key: slug,
		name,
		subtitle,
		kind: typeof kind === "string" ? kind : "",
		supported: isSupportedKind(kind),
	};
}

async function readJson(response: TemplateResponse): Promise<unknown> {
	if (!response.ok) {
		throw new Error(`Template API responded ${response.status}`);
	}
	return await response.json();
}

async function fetchBlobText(
	source: TemplateSource,
	sha: string,
	fetcher: TemplateFetcher,
): Promise<string> {
	const data = await readJson(await fetcher(blobUrl(source, sha)));
	const content = asBlobContent(data);
	if (!content) {
		throw new Error("Template blob has no content");
	}
	return decodeBase64Utf8(content);
}

async function fetchTemplateMeta(
	source: TemplateSource,
	slug: string,
	fetcher: TemplateFetcher,
): Promise<TemplateMeta | null> {
	const entries = asEntries(
		await readJson(await fetcher(templateDirUrl(source, slug))),
	);
	if (!entries) return null;
	const file = entries.find(
		(entry) => entry.name === "dashboard.json" && !!entry.sha,
	);
	if (!file?.sha) return null;
	const text = await fetchBlobText(source, file.sha, fetcher);
	return extractTemplateMeta(JSON.parse(text) as unknown, slug);
}

/** Lists visible templates for a source, using the 10-minute per-source cache. */
export async function listTemplates(
	source: TemplateSource,
	options: TemplateFetchOptions = {},
): Promise<TemplateMeta[]> {
	const fetcher = options.fetchImpl ?? defaultFetcher;
	const now = options.now ?? Date.now();
	const cached = cache.get(source);
	if (cached && now - cached.at < TEMPLATE_CACHE_TTL_MS) {
		return cached.templates;
	}

	const entries = asEntries(
		await readJson(await fetcher(listTemplatesUrl(source))),
	);
	if (!entries) {
		throw new Error("Template list is not an array");
	}
	const slugs = entries
		.filter((entry) => entry.type === "dir" && !!entry.name)
		.map((entry) => entry.name!);

	const settled = await Promise.all(
		slugs.map(async (slug) => {
			try {
				return await fetchTemplateMeta(source, slug, fetcher);
			} catch (error) {
				console.warn("IOTO Dashboard: skipped template", slug, error);
				return null;
			}
		}),
	);
	const templates = settled.filter(
		(meta): meta is TemplateMeta =>
			meta !== null && isVisibleKind(meta.kind),
	);
	cache.set(source, { at: now, templates });
	return templates;
}

/** Fetches the raw bundle JSON for one template; bypasses the list cache. */
export async function fetchTemplateJson(
	source: TemplateSource,
	slug: string,
	options: TemplateFetchOptions = {},
): Promise<string> {
	const fetcher = options.fetchImpl ?? defaultFetcher;
	const entries = asEntries(
		await readJson(await fetcher(templateDirUrl(source, slug))),
	);
	if (!entries) {
		throw new Error("Template directory is not an array");
	}
	const file = entries.find(
		(entry) => entry.name === "dashboard.json" && !!entry.sha,
	);
	if (!file?.sha) {
		throw new Error("Template has no dashboard.json");
	}
	return fetchBlobText(source, file.sha, fetcher);
}

/** Clears one source so the next list call re-fetches. */
export function reload(source: TemplateSource): void {
	cache.delete(source);
}

/** Test helper: clears both sources. */
export function clearTemplateCache(): void {
	cache.clear();
}
