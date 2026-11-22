/**
 * Remote template browsing for the template center.
 *
 * Reads the two public repository APIs plus their quota-free raw gateways;
 * it never writes settings, never reads local `templates/`, and never touches
 * ioto-update. Gitee/GitHub share the same API shape, so the source switch
 * only changes the base URL. Three fetch paths, in priority order:
 *   1. one raw GET of `templates/index.json` (0 API requests),
 *   2. one tree API call + one raw GET per template (1 API request),
 *   3. the original contents API walk (the legacy fallback).
 * Success is cached in memory (L1) and, when injected, in `data.json` (L2).
 */

import { requestUrl } from "obsidian";

export type TemplateSource = "gitee" | "github";

export interface TemplateMeta {
	/** Stable key: the folder slug under `templates/`. */
	key: string;
	name: string;
	subtitle: string;
	/** Optional template introduction from `source.description`. */
	description: string;
	kind: string;
	/** Whether this kind can be imported (page bundles only in v1). */
	supported: boolean;
}

/** Minimal response shape shared by `requestUrl` and injected test doubles. */
export interface TemplateResponse {
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
	/** Raw body; a firewall 403 is plain text, not JSON. Optional for test doubles. */
	text?: string;
	/** Lower-cased by Obsidian; optional for test doubles. */
	headers?: Record<string, string>;
}

/** A non-2xx API response, carrying enough detail for the UI to classify it. */
export class TemplateHttpError extends Error {
	readonly status: number;
	readonly retryAfterSec: number | null;
	readonly rateLimited: boolean;

	constructor(
		status: number,
		message: string,
		retryAfterSec: number | null,
		rateLimited: boolean,
	) {
		super(message);
		this.name = "TemplateHttpError";
		this.status = status;
		this.retryAfterSec = retryAfterSec;
		this.rateLimited = rateLimited;
	}
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

/** Same repo/branch as REPO_API, but on the quota-free raw gateway. */
const RAW_BASE: Record<TemplateSource, string> = {
	gitee: "https://gitee.com/johnnylearns/ioto-dashboard/raw/master",
	github: "https://raw.githubusercontent.com/shawndotty/ioto-dashboard/master",
};

export const TEMPLATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface TemplateCacheEntry {
	at: number;
	templates: TemplateMeta[];
}

export interface TemplateCacheStore {
	read(): Promise<Record<TemplateSource, TemplateCacheEntry> | null>;
	write(data: Record<TemplateSource, TemplateCacheEntry>): Promise<void>;
}

interface ApiEntry {
	type?: string;
	name?: string;
	sha?: string;
}

const cache = new Map<TemplateSource, TemplateCacheEntry>();

/** L2 store injected by `main.ts`; null in tests that don't need persistence. */
let cacheStore: TemplateCacheStore | null = null;

/** Bundles preloaded from the aggregate index, keyed by `source::slug`. */
const bundleByKey = new Map<string, string>();

/** Failure state is kept apart from the success cache so `reload()` cannot clear it. */
const cooldowns = new Map<
	TemplateSource,
	{ until: number; error: TemplateHttpError }
>();
const failStreaks = new Map<TemplateSource, number>();

/** Obsidian forbids raw `fetch`; adapt requestUrl into a response with diagnostics. */
const defaultFetcher: TemplateFetcher = async (url) => {
	// Without `throw: false` a 4xx rejects before we can read status/headers/text.
	const response = await requestUrl({ url, throw: false });
	return {
		ok: response.status >= 200 && response.status < 300,
		status: response.status,
		text: response.text,
		headers: response.headers,
		// `json` is a getter that parses the body. Reading it here would throw
		// on a plain-text firewall response before readJson can classify it.
		json: async (): Promise<unknown> => response.json as unknown,
	};
};

/** Case-insensitive header lookup; test doubles may use any casing. */
function headerValue(
	headers: Record<string, string> | undefined,
	name: string,
): string | undefined {
	if (!headers) return undefined;
	const key = Object.keys(headers).find(
		(candidate) => candidate.toLowerCase() === name.toLowerCase(),
	);
	return key ? headers[key] : undefined;
}

/**
 * Seconds until a retry is useful: Retry-After (delta seconds or HTTP date),
 * then X-RateLimit-Reset (epoch seconds or delta), else null.
 */
export function parseRetryAfter(
	headers: Record<string, string> | undefined,
	now: number = Date.now(),
): number | null {
	const retryAfter = headerValue(headers, "Retry-After");
	if (retryAfter) {
		const seconds = Number(retryAfter.trim());
		if (Number.isFinite(seconds) && seconds >= 0) {
			return Math.ceil(seconds);
		}
		const date = Date.parse(retryAfter);
		if (Number.isFinite(date)) {
			return Math.max(0, Math.ceil((date - now) / 1000));
		}
	}
	const reset = headerValue(headers, "X-RateLimit-Reset");
	if (reset) {
		const value = Number(reset.trim());
		if (Number.isFinite(value) && value >= 0) {
			// Both Gitee and GitHub use epoch seconds; small values are deltas.
			const seconds = value > 1e9 ? value - now / 1000 : value;
			if (seconds >= 0) return Math.ceil(seconds);
		}
	}
	return null;
}

function looksLikeJson(text: string): boolean {
	const trimmed = text.trim();
	return trimmed.startsWith("{") || trimmed.startsWith("[");
}

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

/** Raw dashboard.json for one template — bypasses `/api/v5/` entirely. */
export function rawUrl(source: TemplateSource, slug: string): string {
	return `${RAW_BASE[source]}/templates/${encodeURIComponent(slug)}/dashboard.json`;
}

/** Raw aggregate index: all template metadata and bundles in one GET. */
export function indexUrl(source: TemplateSource): string {
	return `${RAW_BASE[source]}/templates/index.json`;
}

/** One recursive request lists every template blob on both platforms. */
export function treeUrl(source: TemplateSource): string {
	return `${apiBase(source)}/git/trees/master?recursive=1`;
}

/**
 * Slug → dashboard.json sha from a git tree. Entries are classified by `type`,
 * never by `mode` (Gitee writes `40000`, GitHub writes `040000`). A truncated
 * tree returns null so the caller falls back to the contents API.
 */
export function extractTemplateShas(
	envelope: unknown,
): Map<string, string> | null {
	if (!isRecord(envelope) || envelope.truncated === true) return null;
	if (!isUnknownArray(envelope.tree)) return null;
	const shas = new Map<string, string>();
	for (const item of envelope.tree) {
		if (!isRecord(item) || item.type !== "blob") continue;
		if (typeof item.path !== "string" || typeof item.sha !== "string") {
			continue;
		}
		const match = /^templates\/([^/]+)\/dashboard\.json$/.exec(item.path);
		if (match && item.sha) shas.set(match[1]!, item.sha);
	}
	return shas;
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
	const description =
		source && typeof source.description === "string"
			? source.description
			: "";
	return {
		key: slug,
		name,
		subtitle,
		description,
		kind: typeof kind === "string" ? kind : "",
		supported: isSupportedKind(kind),
	};
}

function makeHttpError(response: TemplateResponse): TemplateHttpError {
	const text = response.text ?? "";
	const retryAfterSec = parseRetryAfter(response.headers);
	const rateLimited =
		response.status === 429 ||
		(response.status === 403 &&
			(retryAfterSec !== null || !looksLikeJson(text)));
	const detail = text.trim() ? text.trim().slice(0, 200) : "";
	const message = rateLimited
		? `Template API rate limited (${response.status})`
		: `Template API responded ${response.status}${detail ? `: ${detail}` : ""}`;
	return new TemplateHttpError(
		response.status,
		message,
		retryAfterSec,
		rateLimited,
	);
}

async function readJson(response: TemplateResponse): Promise<unknown> {
	if (!response.ok) throw makeHttpError(response);
	// A firewall may answer 200 with plain text. Surface a readable error
	// instead of a raw JSON.parse SyntaxError that hides the status and body.
	if (response.text !== undefined && !looksLikeJson(response.text)) {
		throw makeHttpError(response);
	}
	return await response.json();
}

/**
 * Reads a raw JSON document (dashboard.json / index.json). The raw gateway
 * returns the file verbatim, so `looksLikeJson` classifies a 404 HTML page or
 * a plain-text firewall reply as a NON-rate-limit failure — callers fall back
 * to the API path instead of misreading it as a rate limit. A genuine 429/403
 * still surfaces through `makeHttpError` and is never retried via API.
 */
async function readRawText(fetcher: TemplateFetcher, url: string): Promise<string> {
	const response = await fetcher(url);
	if (!response.ok) throw makeHttpError(response);
	const text = response.text;
	if (text === undefined || !looksLikeJson(text)) {
		throw new Error("Template raw response is not JSON");
	}
	return text;
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

/** Keeps a small, fixed number of blob requests in flight. */
async function mapLimited<T, R>(
	items: T[],
	limit: number,
	worker: (item: T) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let cursor = 0;
	const runners = Array.from(
		{ length: Math.min(limit, items.length) },
		async () => {
			while (cursor < items.length) {
				const index = cursor++;
				results[index] = await worker(items[index]!);
			}
		},
	);
	await Promise.all(runners);
	return results;
}

function isRateLimitError(error: unknown): error is TemplateHttpError {
	return error instanceof TemplateHttpError && error.rateLimited;
}

function noteSuccess(source: TemplateSource): void {
	failStreaks.delete(source);
	cooldowns.delete(source);
}

/** Remembers a failed source until its retry window slides past. */
function noteRateLimit(
	source: TemplateSource,
	error: TemplateHttpError,
	now: number,
): void {
	const streak = (failStreaks.get(source) ?? 0) + 1;
	failStreaks.set(source, streak);
	const backoffSec = Math.min(2 ** streak, 60);
	const retrySec = error.retryAfterSec ?? backoffSec;
	cooldowns.set(source, { until: now + retrySec * 1000, error });
}

/** Reads one template's dashboard.json as parsed JSON via the raw gateway. */
async function readRawJson(
	source: TemplateSource,
	slug: string,
	fetcher: TemplateFetcher,
): Promise<unknown> {
	return JSON.parse(await readRawText(fetcher, rawUrl(source, slug))) as unknown;
}

/** Validates the pre-extracted `meta` object stored in the aggregate index. */
function metaFromIndex(raw: unknown, key: string): TemplateMeta | null {
	if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.kind !== "string") {
		return null;
	}
	return {
		key,
		name: raw.name,
		subtitle: typeof raw.subtitle === "string" ? raw.subtitle : "",
		description: typeof raw.description === "string" ? raw.description : "",
		kind: raw.kind,
		supported: isSupportedKind(raw.kind),
	};
}

/**
 * Aggregated-index path: a single raw GET returns every template's metadata
 * and full bundle. Returns null for a missing/malformed index so the caller
 * silently degrades to A1; a genuine rate limit propagates (never deepen it).
 */
async function listViaIndex(
	source: TemplateSource,
	fetcher: TemplateFetcher,
): Promise<TemplateMeta[] | null> {
	let response: TemplateResponse;
	try {
		response = await fetcher(indexUrl(source));
	} catch {
		return null;
	}
	if (!response.ok) {
		const error = makeHttpError(response);
		if (error.rateLimited) throw error;
		return null;
	}
	const raw = response.text;
	if (raw === undefined || !looksLikeJson(raw)) return null;
	let index: unknown;
	try {
		index = JSON.parse(raw) as unknown;
	} catch {
		return null;
	}
	if (
		!isRecord(index) ||
		index.version !== 1 ||
		!isUnknownArray(index.templates)
	) {
		return null;
	}

	const metas: TemplateMeta[] = [];
	for (const item of index.templates) {
		if (!isRecord(item) || typeof item.key !== "string") continue;
		const meta = metaFromIndex(item.meta, item.key);
		if (!meta) continue;
		metas.push(meta);
		if (isRecord(item.bundle)) {
			bundleByKey.set(
				`${source}::${item.key}`,
				JSON.stringify(item.bundle),
			);
		}
	}
	return metas.filter((meta) => isVisibleKind(meta.kind));
}

/**
 * One tree API request + one raw GET per template (1 API + N raw). A raw
 * failure that is not a rate limit falls back to that template's blob API.
 */
async function listViaTree(
	source: TemplateSource,
	fetcher: TemplateFetcher,
): Promise<TemplateMeta[]> {
	const shas = extractTemplateShas(
		await readJson(await fetcher(treeUrl(source))),
	);
	if (!shas) throw new Error("Template tree is truncated or malformed");

	const settled = await mapLimited(
		[...shas.entries()],
		3,
		async ([slug, sha]) => {
			try {
				let text: string;
				try {
					const data = await readRawJson(source, slug, fetcher);
					text = JSON.stringify(data);
				} catch (rawError) {
					if (isRateLimitError(rawError)) throw rawError;
					text = await fetchBlobText(source, sha, fetcher);
				}
				return extractTemplateMeta(JSON.parse(text) as unknown, slug);
			} catch (error) {
				// A rate limit mid-batch must abort the whole list, not yield a
				// partial success that would hide the cooldown from the UI.
				if (isRateLimitError(error)) throw error;
				console.warn("IOTO Dashboard: skipped template", slug, error);
				return null;
			}
		},
	);
	return settled.filter(
		(meta): meta is TemplateMeta =>
			meta !== null && isVisibleKind(meta.kind),
	);
}

/** Fallback: original contents-per-directory enumeration (1 + 2N). */
async function listViaContents(
	source: TemplateSource,
	fetcher: TemplateFetcher,
): Promise<TemplateMeta[]> {
	const entries = asEntries(
		await readJson(await fetcher(listTemplatesUrl(source))),
	);
	if (!entries) throw new Error("Template list is not an array");
	const slugs = entries
		.filter((entry) => entry.type === "dir" && !!entry.name)
		.map((entry) => entry.name!);

	const settled = await mapLimited(slugs, 3, async (slug) => {
		try {
			return await fetchTemplateMeta(source, slug, fetcher);
		} catch (error) {
			if (isRateLimitError(error)) throw error;
			console.warn("IOTO Dashboard: skipped template", slug, error);
			return null;
		}
	});
	return settled.filter(
		(meta): meta is TemplateMeta =>
			meta !== null && isVisibleKind(meta.kind),
	);
}

/** Validates a persisted L2 entry before trusting it. */
function isValidCacheEntry(value: unknown): value is TemplateCacheEntry {
	if (!isRecord(value) || typeof value.at !== "number") return false;
	if (!isUnknownArray(value.templates)) return false;
	return value.templates.every(
		(item) =>
			isRecord(item) &&
			typeof item.key === "string" &&
			typeof item.kind === "string",
	);
}

/**
 * Lists visible templates. Order: cooldown → L1 cache → L2 persistent cache
 * → aggregate index (1 raw, 0 API) → tree+raw (1 API + N raw) → contents.
 */
export async function listTemplates(
	source: TemplateSource,
	options: TemplateFetchOptions = {},
): Promise<TemplateMeta[]> {
	const fetcher = options.fetchImpl ?? defaultFetcher;
	const now = options.now ?? Date.now();

	const cooldown = cooldowns.get(source);
	if (cooldown) {
		if (now < cooldown.until) throw cooldown.error;
		cooldowns.delete(source);
	}

	const cached = cache.get(source);
	if (cached && now - cached.at < TEMPLATE_CACHE_TTL_MS) {
		return cached.templates;
	}

	// L2: a fresh persisted entry is promoted to L1 and returned with 0 requests.
	const store = cacheStore;
	if (store) {
		try {
			const persisted = await store.read();
			const entry = persisted?.[source];
			if (
				isValidCacheEntry(entry) &&
				now - entry.at < TEMPLATE_CACHE_TTL_MS
			) {
				cache.set(source, entry);
				return entry.templates;
			}
		} catch (error) {
			console.warn("IOTO Dashboard: failed to read template cache", error);
		}
	}

	let templates: TemplateMeta[];
	try {
		// Prefer one raw index GET; null means missing/malformed → A1 fallback.
		templates = (await listViaIndex(source, fetcher)) ?? [];
		if (templates.length === 0) templates = await listViaTree(source, fetcher);
	} catch (error) {
		if (isRateLimitError(error)) {
			noteRateLimit(source, error, now);
			throw error;
		}
		// A non-rate-limit failure falls back to the legacy contents walk.
		try {
			templates = await listViaContents(source, fetcher);
		} catch (fallbackError) {
			if (isRateLimitError(fallbackError)) {
				noteRateLimit(source, fallbackError, now);
			}
			throw fallbackError;
		}
	}

	noteSuccess(source);
	cache.set(source, { at: now, templates });
	// Persist to L2 best-effort: a write failure must never block the list.
	if (store) {
		try {
			const persisted =
				(await store.read()) ??
				({} as Record<TemplateSource, TemplateCacheEntry>);
			persisted[source] = { at: now, templates };
			await store.write(persisted);
		} catch (error) {
			console.warn("IOTO Dashboard: failed to persist template cache", error);
		}
	}
	return templates;
}

/**
 * Fetches the raw bundle JSON for one template. Prefers the index-preloaded
 * bundle (0 requests), then the raw gateway (0 API), then the original two
 * API calls. A rate limit on raw propagates; other failures fall back.
 */
export async function fetchTemplateJson(
	source: TemplateSource,
	slug: string,
	options: TemplateFetchOptions = {},
): Promise<string> {
	const fetcher = options.fetchImpl ?? defaultFetcher;
	const key = `${source}::${slug}`;
	const preloaded = bundleByKey.get(key);
	if (preloaded !== undefined) return preloaded;

	try {
		return await readRawText(fetcher, rawUrl(source, slug));
	} catch (rawError) {
		if (isRateLimitError(rawError)) throw rawError;
		// Non-rate-limit raw failure (404/malformed) → original API path.
	}

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

/** Clears one source so the next list call re-fetches (both cache levels). */
export function reload(source: TemplateSource): void {
	cache.delete(source);
	for (const key of [...bundleByKey.keys()]) {
		if (key.startsWith(`${source}::`)) bundleByKey.delete(key);
	}
	const store = cacheStore;
	if (store) {
		void store
			.read()
			.then((persisted) => {
				if (!persisted || !persisted[source]) return;
				const next = { ...persisted };
				delete next[source];
				return store.write(next);
			})
			.catch((error: unknown) => {
				console.warn("IOTO Dashboard: failed to clear template cache", error);
			});
	}
}

/** Test helper: clears both sources, including failure state and persistence. */
export function clearTemplateCache(): void {
	cache.clear();
	cooldowns.clear();
	failStreaks.clear();
	bundleByKey.clear();
	const store = cacheStore;
	if (store) {
		void store
			.write({} as Record<TemplateSource, TemplateCacheEntry>)
			.catch((error: unknown) => {
				console.warn("IOTO Dashboard: failed to clear template cache", error);
			});
	}
}

/** Test helper: clears only cooldown/streak state, keeping success cache. */
export function clearTemplateCooldown(): void {
	cooldowns.clear();
	failStreaks.clear();
}

/** Injects the persistent L2 store from `main.ts`; null disables persistence. */
export function setTemplateCacheStore(store: TemplateCacheStore | null): void {
	cacheStore = store;
}
