import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const tc = await load('../../src/dashboard/template-center.ts');

const envelope = {
	kind: 'ioto-dashboard-page',
	source: { pageNames: ['团队总览'], dashboardName: 'Alpha' },
};

const okJson = (value) => ({
	ok: true,
	status: 200,
	text: JSON.stringify(value),
	json: async () => value,
});
const okText = (text) => ({
	ok: true,
	status: 200,
	text,
	json: async () => JSON.parse(text),
});
const notFound = () => ({
	ok: false,
	status: 404,
	text: 'not found',
	json: async () => ({}),
});
const base64 = (value) =>
	Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

/**
 * Full source simulator. By default the index is missing so the legacy
 * tree→raw path is exercised; flip `index` to 'hit'/'malformed' to test A2.
 */
function makeFetch(opts = {}) {
	const { index = 'missing', raw = 'hit', giteeName = '团队总览' } = opts;
	const calls = [];
	const giteeTeam = {
		...envelope,
		source: { pageNames: [giteeName], dashboardName: 'Alpha' },
	};
	const giteeDash = { kind: 'ioto-dashboard' };
	const giteeBackup = { kind: 'ioto-dashboard-backup' };

	const apiData = {
		[tc.treeUrl('gitee')]: {
			truncated: false,
			tree: [
				{ type: 'blob', mode: '100644', path: 'templates/team-overview/dashboard.json', sha: 'sha-gitee' },
				{ type: 'blob', mode: '100644', path: 'templates/dashboard-only/dashboard.json', sha: 'sha-dash' },
				{ type: 'blob', mode: '100644', path: 'templates/backup-only/dashboard.json', sha: 'sha-backup' },
				{ type: 'blob', mode: '100644', path: 'templates/team-overview/README.md', sha: 'sha-readme' },
			],
		},
		[tc.treeUrl('github')]: {
			truncated: false,
			tree: [
				{ type: 'blob', mode: '100644', path: 'templates/team-overview/dashboard.json', sha: 'sha-github' },
			],
		},
		[tc.listTemplatesUrl('gitee')]: [
			{ type: 'dir', name: 'team-overview' },
			{ type: 'dir', name: 'dashboard-only' },
			{ type: 'dir', name: 'backup-only' },
			{ type: 'file', name: 'README.md' },
		],
		[tc.listTemplatesUrl('github')]: [{ type: 'dir', name: 'team-overview' }],
		[tc.templateDirUrl('gitee', 'team-overview')]: [{ name: 'dashboard.json', sha: 'sha-gitee' }],
		[tc.templateDirUrl('gitee', 'dashboard-only')]: [{ name: 'dashboard.json', sha: 'sha-dash' }],
		[tc.templateDirUrl('gitee', 'backup-only')]: [{ name: 'dashboard.json', sha: 'sha-backup' }],
		[tc.templateDirUrl('github', 'team-overview')]: [{ name: 'dashboard.json', sha: 'sha-github' }],
		[tc.blobUrl('gitee', 'sha-gitee')]: { content: base64(giteeTeam) },
		[tc.blobUrl('gitee', 'sha-dash')]: { content: base64(giteeDash) },
		[tc.blobUrl('gitee', 'sha-backup')]: { content: base64(giteeBackup) },
		[tc.blobUrl('github', 'sha-github')]: { content: base64(envelope) },
	};

	const rawData = {
		[tc.rawUrl('gitee', 'team-overview')]: giteeTeam,
		[tc.rawUrl('gitee', 'dashboard-only')]: giteeDash,
		[tc.rawUrl('gitee', 'backup-only')]: giteeBackup,
		[tc.rawUrl('github', 'team-overview')]: envelope,
	};

	const indexData = (source) => {
		const items =
			source === 'gitee'
				? [
						{ key: 'team-overview', meta: { name: giteeName, subtitle: 'Alpha', kind: 'ioto-dashboard-page', supported: true }, bundle: giteeTeam },
						{ key: 'dashboard-only', meta: { name: 'dashboard-only', subtitle: '', kind: 'ioto-dashboard', supported: false }, bundle: giteeDash },
					]
				: [
						{ key: 'team-overview', meta: { name: '团队总览', subtitle: 'Alpha', kind: 'ioto-dashboard-page', supported: true }, bundle: envelope },
					];
		return { version: 1, generatedAt: '2026-11-22T00:00:00.000Z', templates: items };
	};

	const fetchImpl = async (url) => {
		const key = String(url);
		calls.push(key);
		if (key === tc.indexUrl('gitee') || key === tc.indexUrl('github')) {
			const source = key === tc.indexUrl('gitee') ? 'gitee' : 'github';
			if (index === 'missing') return notFound();
			if (index === 'malformed') return okJson({ version: 2, templates: 'bad' });
			return okText(JSON.stringify(indexData(source)));
		}
		if (key in rawData) {
			if (raw === 'missing') return notFound();
			return okText(JSON.stringify(rawData[key]));
		}
		if (key in apiData) return okJson(apiData[key]);
		return notFound();
	};
	return { fetchImpl, calls, apiData, rawData };
}

const apiCalls = (calls) => calls.filter((url) => url.includes('/api/v5/') || url.includes('api.github.com'));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeStore(initial = null) {
	let data = initial;
	const writes = [];
	return {
		read: async () => data,
		write: async (next) => {
			data = next;
			writes.push(next);
		},
		get data() { return data; },
		writes,
	};
}

test('source → list URL: Gitee never carries access_token', () => {
	const gitee = tc.listTemplatesUrl('gitee');
	const github = tc.listTemplatesUrl('github');
	assert.equal(
		gitee,
		'https://gitee.com/api/v5/repos/johnnylearns/ioto-dashboard/contents/templates?ref=master',
	);
	assert.equal(
		github,
		'https://api.github.com/repos/shawndotty/ioto-dashboard/contents/templates?ref=master',
	);
	assert.equal(gitee.includes('access_token'), false);
	assert.equal(tc.apiBase('gitee').startsWith('https://gitee.com/'), true);
	assert.equal(
		tc.blobUrl('github', 'sha/1'),
		'https://api.github.com/repos/shawndotty/ioto-dashboard/git/blobs/sha%2F1',
	);
});

test('rawUrl / indexUrl: both platforms, no /api/v5/ in path', () => {
	assert.equal(
		tc.rawUrl('gitee', 'team-overview'),
		'https://gitee.com/johnnylearns/ioto-dashboard/raw/master/templates/team-overview/dashboard.json',
	);
	assert.equal(
		tc.rawUrl('github', 'team-overview'),
		'https://raw.githubusercontent.com/shawndotty/ioto-dashboard/master/templates/team-overview/dashboard.json',
	);
	assert.equal(tc.rawUrl('gitee', 'a/b').includes('a%2Fb'), true, 'slug single-segment encoded');
	assert.equal(
		tc.indexUrl('gitee'),
		'https://gitee.com/johnnylearns/ioto-dashboard/raw/master/templates/index.json',
	);
	assert.equal(tc.indexUrl('github').includes('/api/v5/'), false);
	assert.equal(tc.rawUrl('gitee', 'team-overview').includes('/api/v5/'), false);
});

test('base64 → UTF-8 keeps multi-byte page names and tolerates whitespace', () => {
	const raw = Buffer.from('团队总览 A', 'utf8').toString('base64');
	assert.equal(tc.decodeBase64Utf8(raw), '团队总览 A');
	assert.equal(tc.decodeBase64Utf8(`${raw.slice(0, 8)}\n ${raw.slice(8)}`), '团队总览 A');
});

test('kind filters: page supported, dashboard/query greyed, backup & unknown dropped', () => {
	assert.equal(tc.isSupportedKind('ioto-dashboard-page'), true);
	assert.equal(tc.isSupportedKind('ioto-dashboard'), false);
	assert.equal(tc.isVisibleKind('ioto-dashboard'), true);
	assert.equal(tc.isVisibleKind('ioto-dashboard-query'), true);
	assert.equal(tc.isVisibleKind('ioto-dashboard-backup'), false);
	assert.equal(tc.isVisibleKind('unknown'), false);
});

test('extractTemplateMeta uses pageNames[0] / dashboardName / slug', () => {
	const meta = tc.extractTemplateMeta(envelope, 'team-overview');
	assert.deepEqual(meta, {
		key: 'team-overview',
		name: '团队总览',
		subtitle: 'Alpha',
		kind: 'ioto-dashboard-page',
		supported: true,
	});
	assert.equal(tc.extractTemplateMeta(null, 'x'), null);
	assert.equal(tc.extractTemplateMeta({ kind: 'x' }, 'x').name, 'x');
});

test('listTemplates filters hidden kinds and marks unsupported ones', async () => {
	tc.clearTemplateCache();
	const { fetchImpl } = makeFetch();
	const list = await tc.listTemplates('gitee', { fetchImpl, now: 1000 });
	const keys = list.map((item) => item.key).sort();
	assert.deepEqual(keys, ['dashboard-only', 'team-overview']);
	assert.equal(list.find((item) => item.key === 'team-overview').name, '团队总览');
	assert.equal(list.find((item) => item.key === 'dashboard-only').supported, false);
});

test('cache is keyed by source and expires after the TTL', async () => {
	tc.clearTemplateCache();
	const { fetchImpl, calls } = makeFetch();
	await tc.listTemplates('gitee', { fetchImpl, now: 1000 });
	const afterFirst = calls.length;
	await tc.listTemplates('gitee', { fetchImpl, now: 2000 });
	assert.equal(calls.length, afterFirst, 'same source within TTL hits cache');
	await tc.listTemplates('github', { fetchImpl, now: 2000 });
	assert.ok(calls.length > afterFirst, 'other source must re-fetch');
	const afterSwitch = calls.length;
	await tc.listTemplates('gitee', { fetchImpl, now: 3000 });
	assert.equal(calls.length, afterSwitch, 'switching back hits Gitee cache');
	await tc.listTemplates('gitee', { fetchImpl, now: 1000 + tc.TEMPLATE_CACHE_TTL_MS });
	assert.ok(calls.length > afterSwitch, 'expired cache re-fetches');
	tc.reload('gitee');
	await tc.listTemplates('gitee', { fetchImpl, now: 1000 + tc.TEMPLATE_CACHE_TTL_MS });
	assert.ok(calls.length > afterSwitch + 1, 'reload clears current source');
});

test('fetchTemplateJson decodes the bundle text directly', async () => {
	tc.clearTemplateCache();
	const { fetchImpl, calls } = makeFetch();
	const text = await tc.fetchTemplateJson('github', 'team-overview', { fetchImpl });
	assert.equal(JSON.parse(text).kind, 'ioto-dashboard-page');
	assert.equal(apiCalls(calls).length, 0, 'import via raw costs 0 API requests');
});

// ---- A1：raw 直链，列表/导入 0 API + 非限流失败回退 ----

test('raw-first list: 1 tree API + N raw, no blob API; TTL is 6h', async () => {
	tc.clearTemplateCache();
	const { fetchImpl, calls } = makeFetch();
	const list = await tc.listTemplates('gitee', { fetchImpl, now: 1000 });
	assert.deepEqual(list.map((item) => item.key).sort(), ['dashboard-only', 'team-overview']);
	assert.equal(tc.TEMPLATE_CACHE_TTL_MS, 6 * 60 * 60 * 1000);
	assert.equal(apiCalls(calls).length, 1, 'only the tree call hits /api/v5/');
	assert.equal(calls.includes(tc.rawUrl('gitee', 'team-overview')), true);
	assert.equal(calls.some((url) => url.includes('/git/blobs/')), false, 'no blob API on raw hit');
});

test('raw 404 HTML falls back to blob API without rate-limit misclassification', async () => {
	tc.clearTemplateCache();
	const { fetchImpl, apiData, calls } = makeFetch({ raw: 'missing' });
	const list = await tc.listTemplates('gitee', { fetchImpl, now: 1000 });
	assert.deepEqual(list.map((item) => item.key).sort(), ['dashboard-only', 'team-overview']);
	assert.equal(list.find((item) => item.key === 'team-overview').name, '团队总览');
	assert.ok(apiCalls(calls).length >= 3, 'blob API used as fallback');
	assert.equal(Object.keys(apiData).some((url) => url.includes('/git/blobs/')), true);
});

test('plain-text 403 on raw is rate-limited and never falls back', async () => {
	tc.clearTemplateCache();
	const limitedFetch = async (url) => ({
		ok: false,
		status: 403,
		text: 'forbidden by firewall',
		headers: {},
		json: async () => ({}),
	});
	await assert.rejects(
		() => tc.listTemplates('gitee', { fetchImpl: limitedFetch, now: 1000 }),
		(err) => err instanceof tc.TemplateHttpError && err.rateLimited === true,
	);
});

// ---- A2：聚合索引，0 API ----

test('index hit: list and import cost 0 API; bundleByKey serves fetchTemplateJson', async () => {
	tc.clearTemplateCache();
	const { fetchImpl, calls } = makeFetch({ index: 'hit' });
	const list = await tc.listTemplates('gitee', { fetchImpl, now: 1000 });
	assert.deepEqual(list.map((item) => item.key).sort(), ['dashboard-only', 'team-overview']);
	const afterList = calls.length;
	assert.equal(apiCalls(calls).length, 0, 'list via index = 0 API');
	assert.equal(calls.includes(tc.indexUrl('gitee')), true);

	const text = await tc.fetchTemplateJson('gitee', 'team-overview', { fetchImpl });
	assert.equal(JSON.parse(text).kind, 'ioto-dashboard-page');
	assert.equal(calls.length, afterList, 'bundle preloaded from index → 0 extra requests');
	assert.equal(apiCalls(calls).length, 0, 'import via index = 0 API');
});

test('malformed index silently degrades to A1', async () => {
	tc.clearTemplateCache();
	const { fetchImpl, calls } = makeFetch({ index: 'malformed' });
	const list = await tc.listTemplates('gitee', { fetchImpl, now: 1000 });
	assert.deepEqual(list.map((item) => item.key).sort(), ['dashboard-only', 'team-overview']);
	assert.equal(apiCalls(calls).length, 1, 'fell back to one tree API call');
	assert.equal(calls.includes(tc.rawUrl('gitee', 'team-overview')), true);
});

// ---- A3：持久化 L2 缓存 ----

test('persistent store: first fetch writes L2; restart hits store with 0 requests', async () => {
	tc.clearTemplateCache();
	const store = makeStore();
	tc.setTemplateCacheStore(store);
	try {
		const f1 = makeFetch();
		await tc.listTemplates('gitee', { fetchImpl: f1.fetchImpl, now: 1000 });
		assert.ok(store.data?.gitee, 'first fetch persisted L2 entry');
		assert.deepEqual(store.data.gitee.templates.map((item) => item.key).sort(), ['dashboard-only', 'team-overview']);

		// Simulate restart: clear L1 only, keep the persisted store.
		tc.setTemplateCacheStore(null);
		tc.clearTemplateCache();
		tc.setTemplateCacheStore(store);
		const f2 = makeFetch();
		const list = await tc.listTemplates('gitee', { fetchImpl: f2.fetchImpl, now: 2000 });
		assert.equal(list.length, 2);
		assert.equal(f2.calls.length, 0, 'restart with fresh L1 → 0 requests via L2');
	} finally {
		tc.setTemplateCacheStore(null);
		tc.clearTemplateCache();
	}
});

test('persistent store: expired L2 re-fetches; corrupted L2 ignored', async () => {
	tc.clearTemplateCache();
	const store = makeStore();
	tc.setTemplateCacheStore(store);
	try {
		const f1 = makeFetch();
		await tc.listTemplates('gitee', { fetchImpl: f1.fetchImpl, now: 1000 });

		tc.setTemplateCacheStore(null);
		tc.clearTemplateCache();
		tc.setTemplateCacheStore(store);
		const f2 = makeFetch();
		await tc.listTemplates('gitee', { fetchImpl: f2.fetchImpl, now: 1000 + tc.TEMPLATE_CACHE_TTL_MS });
		assert.equal(f2.calls.length > 0, true, 'expired L2 re-fetches');

		tc.setTemplateCacheStore(null);
		tc.clearTemplateCache();
		tc.setTemplateCacheStore(makeStore({ gitee: { at: 2000, templates: 'corrupt' } }));
		const f3 = makeFetch();
		const list = await tc.listTemplates('gitee', { fetchImpl: f3.fetchImpl, now: 3000 });
		assert.equal(list.length, 2, 'corrupted L2 ignored and re-fetched');
	} finally {
		tc.setTemplateCacheStore(null);
		tc.clearTemplateCache();
	}
});

test('reload clears both L1 and L2 so next list re-fetches', async () => {
	tc.clearTemplateCache();
	const store = makeStore();
	tc.setTemplateCacheStore(store);
	try {
		const f1 = makeFetch();
		await tc.listTemplates('gitee', { fetchImpl: f1.fetchImpl, now: 1000 });
		assert.ok(store.data?.gitee);

		tc.reload('gitee');
		await flush(); // reload clears L2 asynchronously via store.write
		assert.equal(store.data?.gitee, undefined, 'L2 entry removed');

		const f2 = makeFetch();
		await tc.listTemplates('gitee', { fetchImpl: f2.fetchImpl, now: 2000 });
		assert.ok(f2.calls.length > 0, 'next list re-fetches after reload');
	} finally {
		tc.setTemplateCacheStore(null);
		tc.clearTemplateCache();
	}
});

// ---- P0-1：错误诊断透出与分级 ----

function errorFetch(status, text, headers) {
	const calls = [];
	const fetchImpl = async (url) => {
		calls.push(url);
		return { ok: false, status, text, headers, json: async () => ({}) };
	};
	return { fetchImpl, calls };
}

test('403 diagnostics: firewall plain text is rate-limited, JSON 403 keeps detail', async () => {
	tc.clearTemplateCache();
	const firewall = errorFetch(403, 'forbidden by firewall', {});
	await assert.rejects(
		() => tc.listTemplates('gitee', { fetchImpl: firewall.fetchImpl, now: 1000 }),
		(err) => {
			assert.equal(err instanceof tc.TemplateHttpError, true);
			assert.equal(err.status, 403);
			assert.equal(err.rateLimited, true);
			assert.equal(err.retryAfterSec, null);
			assert.match(err.message, /rate limited/);
			return true;
		},
	);

	tc.clearTemplateCache();
	const permission = errorFetch(403, JSON.stringify({ message: 'no permission' }), {});
	await assert.rejects(
		() => tc.listTemplates('gitee', { fetchImpl: permission.fetchImpl, now: 1000 }),
		(err) => {
			assert.equal(err.rateLimited, false);
			assert.match(err.message, /no permission/);
			return true;
		},
	);
});

test('parseRetryAfter: delta seconds, HTTP date, reset header, missing', () => {
	const now = Date.parse('2026-11-22T12:00:00Z');
	assert.equal(tc.parseRetryAfter({ 'retry-after': '9' }, now), 9);
	assert.equal(tc.parseRetryAfter({ 'Retry-After': '6' }, now), 6);
	assert.equal(
		tc.parseRetryAfter({ 'Retry-After': new Date(now + 15000).toUTCString() }, now),
		15,
	);
	assert.equal(tc.parseRetryAfter({ 'X-RateLimit-Reset': String(now / 1000 + 20) }, now), 20);
	assert.equal(tc.parseRetryAfter({ 'X-RateLimit-Reset': '7' }, now), 7);
	assert.equal(tc.parseRetryAfter({}, now), null);
	assert.equal(tc.parseRetryAfter(undefined, now), null);
});

test('Retry-After header is carried into the error and the retry message', async () => {
	tc.clearTemplateCache();
	const limitedWithHeader = errorFetch(403, 'firewall', { 'Retry-After': '12' });
	await assert.rejects(
		() => tc.listTemplates('gitee', { fetchImpl: limitedWithHeader.fetchImpl, now: 1000 }),
		(err) => {
			assert.equal(err.rateLimited, true);
			assert.equal(err.retryAfterSec, 12);
			return true;
		},
	);
});

test('plain-text body is classified without touching the json getter', async () => {
	tc.clearTemplateCache();
	let jsonReads = 0;
	const fetchImpl = async () => ({
		ok: false,
		status: 403,
		text: 'denied by firewall',
		headers: { 'Retry-After': '15' },
		get json() {
			jsonReads += 1;
			throw new Error('json getter must not be read on an error response');
		},
	});
	await assert.rejects(
		() => tc.listTemplates('gitee', { fetchImpl, now: 1000 }),
		(err) => {
			assert.equal(err instanceof tc.TemplateHttpError, true);
			assert.equal(err.rateLimited, true);
			assert.equal(err.retryAfterSec, 15);
			return true;
		},
	);
	assert.equal(jsonReads, 0);
});

test('200 with a plain-text body reports a readable error', async () => {
	tc.clearTemplateCache();
	const fetchImpl = async () => ({
		ok: true,
		status: 200,
		text: 'access denied by gateway',
		headers: {},
		json: async () => { throw new SyntaxError('Unexpected token'); },
	});
	await assert.rejects(
		() => tc.listTemplates('gitee', { fetchImpl, now: 1000 }),
		(err) => {
			assert.equal(err instanceof tc.TemplateHttpError, true);
			assert.equal(err.status, 200);
			assert.match(err.message, /access denied by gateway/);
			return true;
		},
	);
});

// ---- P1-1：git/trees 转正 ----

test('tree URL + extractTemplateShas classify by type, not mode', () => {
	assert.equal(
		tc.treeUrl('gitee'),
		'https://gitee.com/api/v5/repos/johnnylearns/ioto-dashboard/git/trees/master?recursive=1',
	);
	const shas = tc.extractTemplateShas({
		truncated: false,
		tree: [
			{ type: 'blob', mode: '40000', path: 'templates/a/dashboard.json', sha: 'sha-a' },
			{ type: 'blob', mode: '040000', path: 'templates/b/dashboard.json', sha: 'sha-b' },
			{ type: 'tree', mode: '40000', path: 'templates/c/dashboard.json', sha: 'sha-c' },
			{ type: 'blob', path: 'templates/a/README.md', sha: 'sha-r' },
			{ type: 'blob', path: 'docs/dashboard.json', sha: 'sha-d' },
		],
	});
	assert.deepEqual([...shas.entries()], [['a', 'sha-a'], ['b', 'sha-b']]);
	assert.equal(tc.extractTemplateShas({ truncated: true, tree: [] }), null);
	assert.equal(tc.extractTemplateShas({ tree: 'oops' }), null);
	assert.equal(tc.extractTemplateShas(null), null);
});

test('tree path falls back to contents (1+2N) when tree is truncated', async () => {
	tc.clearTemplateCache();
	const good = makeFetch();
	const fallbackCalls = [];
	const fallbackFetch = async (url) => {
		fallbackCalls.push(url);
		if (url === tc.indexUrl('gitee')) {
			return { ok: false, status: 404, json: async () => ({}) };
		}
		if (url === tc.treeUrl('gitee')) {
			return { ok: true, status: 200, text: JSON.stringify({ truncated: true, tree: [] }), json: async () => ({ truncated: true, tree: [] }) };
		}
		if (!(url in good.apiData)) return notFound();
		return okJson(good.apiData[url]);
	};
	const fallbackList = await tc.listTemplates('gitee', { fetchImpl: fallbackFetch, now: 1000 });
	assert.deepEqual(fallbackList.map((item) => item.key).sort(), ['dashboard-only', 'team-overview']);
	assert.equal(fallbackCalls[1], tc.treeUrl('gitee'));
	assert.equal(fallbackCalls[2], tc.listTemplatesUrl('gitee'));
});

// ---- P1-2 / P1-3：负缓存与指数退避 ----

test('rate-limit cooldown suppresses repeat requests until cleared', async () => {
	tc.clearTemplateCache();
	let now = 1000;
	const limited = errorFetch(429, 'slow down', { 'Retry-After': '30' });
	await assert.rejects(() => tc.listTemplates('gitee', { fetchImpl: limited.fetchImpl, now }));
	assert.equal(limited.calls.length, 1);

	now += 1000;
	await assert.rejects(() => tc.listTemplates('gitee', { fetchImpl: limited.fetchImpl, now }));
	assert.equal(limited.calls.length, 1, 'cooldown must not send a request');

	tc.clearTemplateCooldown();
	const good = makeFetch();
	const restored = await tc.listTemplates('gitee', { fetchImpl: good.fetchImpl, now });
	assert.equal(restored.length, 2);
	assert.equal(good.calls.length > 0, true);
});

test('exponential backoff doubles the cooldown across consecutive failures', async () => {
	tc.clearTemplateCache();
	let now = 1000;
	const limited = errorFetch(403, 'firewall', {});
	await assert.rejects(() => tc.listTemplates('gitee', { fetchImpl: limited.fetchImpl, now }));
	assert.equal(limited.calls.length, 1, 'streak 1 → 2s cooldown');

	now += 2500;
	await assert.rejects(() => tc.listTemplates('gitee', { fetchImpl: limited.fetchImpl, now }));
	assert.equal(limited.calls.length, 2, 'streak 2 → 4s cooldown');

	now += 1000;
	await assert.rejects(() => tc.listTemplates('gitee', { fetchImpl: limited.fetchImpl, now }));
	assert.equal(limited.calls.length, 2, 'still inside the 4s window');
});
