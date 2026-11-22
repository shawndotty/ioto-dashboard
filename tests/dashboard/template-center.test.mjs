import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const tc = await load('../../src/dashboard/template-center.ts');

const envelope = {
	kind: 'ioto-dashboard-page',
	source: { pageNames: ['团队总览'], dashboardName: 'Alpha' },
};
const bundled = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');

function makeFetch(giteeName = '团队总览') {
	const calls = [];
	const data = {
		'https://gitee.com/api/v5/repos/johnnylearns/ioto-dashboard/git/trees/master?recursive=1':
			{
				truncated: false,
				tree: [
					{ type: 'blob', mode: '100644', path: 'templates/team-overview/dashboard.json', sha: 'sha-gitee' },
					{ type: 'blob', mode: '100644', path: 'templates/dashboard-only/dashboard.json', sha: 'sha-dash' },
					{ type: 'blob', mode: '100644', path: 'templates/backup-only/dashboard.json', sha: 'sha-backup' },
					{ type: 'blob', mode: '100644', path: 'templates/team-overview/README.md', sha: 'sha-readme' },
				],
			},
		'https://api.github.com/repos/shawndotty/ioto-dashboard/git/trees/master?recursive=1':
			{
				truncated: false,
				tree: [
					{ type: 'blob', mode: '100644', path: 'templates/team-overview/dashboard.json', sha: 'sha-github' },
				],
			},
		'https://gitee.com/api/v5/repos/johnnylearns/ioto-dashboard/contents/templates?ref=master':
			[
				{ type: 'dir', name: 'team-overview' },
				{ type: 'dir', name: 'dashboard-only' },
				{ type: 'dir', name: 'backup-only' },
				{ type: 'file', name: 'README.md' },
			],
		'https://api.github.com/repos/shawndotty/ioto-dashboard/contents/templates?ref=master':
			[{ type: 'dir', name: 'team-overview' }],
		'https://gitee.com/api/v5/repos/johnnylearns/ioto-dashboard/contents/templates/team-overview':
			[{ name: 'dashboard.json', sha: 'sha-gitee' }],
		'https://gitee.com/api/v5/repos/johnnylearns/ioto-dashboard/contents/templates/dashboard-only':
			[{ name: 'dashboard.json', sha: 'sha-dash' }],
		'https://gitee.com/api/v5/repos/johnnylearns/ioto-dashboard/contents/templates/backup-only':
			[{ name: 'dashboard.json', sha: 'sha-backup' }],
		'https://api.github.com/repos/shawndotty/ioto-dashboard/contents/templates/team-overview':
			[{ name: 'dashboard.json', sha: 'sha-github' }],
		'https://gitee.com/api/v5/repos/johnnylearns/ioto-dashboard/git/blobs/sha-gitee':
			{
				content: Buffer.from(
					JSON.stringify({
						...envelope,
						source: { pageNames: [giteeName], dashboardName: 'Alpha' },
					}),
					'utf8',
				).toString('base64'),
			},
		'https://gitee.com/api/v5/repos/johnnylearns/ioto-dashboard/git/blobs/sha-dash':
			{ content: Buffer.from(JSON.stringify({ kind: 'ioto-dashboard' })).toString('base64') },
		'https://gitee.com/api/v5/repos/johnnylearns/ioto-dashboard/git/blobs/sha-backup':
			{ content: Buffer.from(JSON.stringify({ kind: 'ioto-dashboard-backup' })).toString('base64') },
		'https://api.github.com/repos/shawndotty/ioto-dashboard/git/blobs/sha-github':
			{ content: bundled },
	};
	const fetchImpl = async (url) => {
		const key = String(url);
		calls.push(key);
		if (!(key in data)) return { ok: false, status: 404, json: async () => ({}) };
		return { ok: true, status: 200, json: async () => data[key] };
	};
	return { fetchImpl, calls, data };
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
	const { fetchImpl } = makeFetch();
	const text = await tc.fetchTemplateJson('github', 'team-overview', { fetchImpl });
	assert.equal(JSON.parse(text).kind, 'ioto-dashboard-page');
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

test('tree path costs 1+N; truncated tree falls back to contents (1+2N)', async () => {
	tc.clearTemplateCache();
	const good = makeFetch();
	const treeList = await tc.listTemplates('gitee', { fetchImpl: good.fetchImpl, now: 1000 });
	assert.deepEqual(treeList.map((item) => item.key).sort(), ['dashboard-only', 'team-overview']);
	assert.equal(good.calls.length, 4, '1 tree request + 3 blob requests');
	assert.equal(good.calls[0], tc.treeUrl('gitee'));

	tc.clearTemplateCache();
	const fallbackCalls = [];
	const fallbackFetch = async (url) => {
		fallbackCalls.push(url);
		if (url === tc.treeUrl('gitee')) {
			return { ok: true, status: 200, json: async () => ({ truncated: true, tree: [] }) };
		}
		if (!(url in good.data)) return { ok: false, status: 404, json: async () => ({}) };
		return { ok: true, status: 200, json: async () => good.data[url] };
	};
	const fallbackList = await tc.listTemplates('gitee', { fetchImpl: fallbackFetch, now: 1000 });
	assert.deepEqual(fallbackList.map((item) => item.key).sort(), ['dashboard-only', 'team-overview']);
	assert.equal(fallbackCalls.length, 8, '1 tree + 1 contents + 3 dirs + 3 blobs');
	assert.equal(fallbackCalls[1], tc.listTemplatesUrl('gitee'));
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
	assert.equal(good.calls.length, 4);
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
