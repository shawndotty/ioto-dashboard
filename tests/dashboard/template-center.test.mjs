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
	return { fetchImpl, calls };
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
