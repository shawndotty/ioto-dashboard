import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { dashboardCommandId } = await load('../../src/dashboard/command-ids.ts');

test('command ids are stable and start with the shared prefix', () => {
	assert.equal(
		dashboardCommandId('dashboard:default'),
		dashboardCommandId('dashboard:default'),
	);
	assert.ok(dashboardCommandId('dashboard:default').startsWith('open-ioto-canvas-'));
});

test('command ids never contain the plugin id substring', () => {
	for (const id of [
		'dashboard:default',
		'dashboard:1794187273815',
		'dashboard:中文',
		'dashboard:UPPER',
	]) {
		assert.equal(
			dashboardCommandId(id).includes('ioto-dashboard'),
			false,
			`${dashboardCommandId(id)} must not contain the plugin id`,
		);
	}
});

test('distinct dashboard ids map to distinct command ids', () => {
	const ids = [
		'dashboard:default',
		'dashboard:Default',
		'dashboard:中文',
		'dashboard:1731',
		'dashboard:1731-2',
		'dashboard-3a-default',
		'dashboard:3a:default',
	];
	const commandIds = ids.map(dashboardCommandId);
	assert.equal(new Set(commandIds).size, ids.length);
});

test('escaped segments are reversible', () => {
	const encode = (value) =>
		value.replace(/[^A-Za-z0-9_]/g, (char) => {
			return `-${char.codePointAt(0).toString(16)}-`;
		});
	const source = 'dashboard:中文:AB';
	assert.equal(dashboardCommandId(source), `open-ioto-canvas-${encode(source)}`);
});
