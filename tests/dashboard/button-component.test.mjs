import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { buttonComponent, normalizeExternalUrl, contrastOn } = await load(
	'../../src/dashboard/components/button.ts',
);

const setting = (key) =>
	buttonComponent.settings.find((item) => item.key === key);

const shownFor = (key, actionType) => {
	const entry = setting(key);
	if (!entry.when) return true;
	return entry.when({ options: { actionType } }, {});
};

test('normalizeExternalUrl keeps http/https/mailto and rejects everything else', () => {
	assert.equal(normalizeExternalUrl('https://example.com'), 'https://example.com/');
	assert.equal(normalizeExternalUrl('example.com'), 'https://example.com/');
	assert.equal(normalizeExternalUrl('HTTP://X.com'), 'http://x.com/');
	assert.equal(normalizeExternalUrl('mailto:a@b.c'), 'mailto:a@b.c');
	assert.equal(normalizeExternalUrl('javascript:alert(1)'), null);
	assert.equal(normalizeExternalUrl('data:text/html,<b>x</b>'), null);
	assert.equal(normalizeExternalUrl('file:///etc/passwd'), null);
	assert.equal(normalizeExternalUrl(''), null);
	assert.equal(normalizeExternalUrl('   '), null);
	assert.equal(normalizeExternalUrl('not a url'), null);
});

test('the button is a queryless utility component with no data pipeline', () => {
	assert.equal(buttonComponent.type, 'button');
	assert.equal(buttonComponent.category, 'utility');
	assert.equal(buttonComponent.queryless, true);
	assert.equal(buttonComponent.defaultQueryId, '');
	assert.equal(buttonComponent.icon, 'mouse-pointer-click');
	assert.equal(buttonComponent.toMetricRequest, undefined);
	assert.equal(buttonComponent.toDatasetRequest, undefined);
	assert.equal(buttonComponent.isEmpty(), false);
});

test('button createConfig starts on a URL action with the card title hidden', () => {
	const created = buttonComponent.createConfig('');
	assert.equal(created.queryId, '');
	assert.equal(created.options.actionType, 'url');
	assert.equal(created.options.label, '');
	assert.equal(created.options.url, '');
	assert.equal(created.options.variant, 'default');
	assert.equal(created.options.openInNewTab, true);
	assert.equal(created.options.hideTitle, true);
	assert.equal(created.options.surface, 'plain');
	assert.equal('buttonColor' in created.options, false);
	assert.equal(created.w, 2);
	assert.equal(created.h, 1);
});

test('button settings expose title plus one target row per action type', () => {
	assert.equal(setting('title').kind, 'text');

	const targets = [
		['notePath', 'note'],
		['commandId', 'command'],
		['pageId', 'page'],
	];
	for (const [key, picker] of targets) {
		const entry = setting(key);
		assert.equal(entry.kind, 'target');
		assert.equal(entry.picker, picker);
		assert.equal(entry.target, 'options');
	}
});

test('the variant menu exposes the six button styles', () => {
	const entry = setting('variant');
	assert.deepEqual(
		entry.options.map((option) => option.value),
		['default', 'primary', 'warning', 'success', 'danger', 'custom'],
	);
});

test('buttonColor only shows for the custom style', () => {
	const entry = setting('buttonColor');
	assert.equal(entry.kind, 'color');
	assert.equal(entry.group, 'style');
	assert.equal(entry.target, 'options');
	for (const variant of ['default', 'primary', 'warning', 'success', 'danger']) {
		assert.equal(entry.when({ options: { variant } }, {}), false, variant);
	}
	assert.equal(entry.when({ options: { variant: 'custom' } }, {}), true);
});

test('contrastOn picks the readable text color', () => {
	assert.equal(contrastOn('#ffffff'), '#000000');
	assert.equal(contrastOn('#000000'), '#ffffff');
	assert.equal(contrastOn('#ffff00'), '#000000');
	assert.equal(contrastOn('#1e3a8a'), '#ffffff');
	assert.equal(contrastOn('not-a-color'), '#ffffff');
});

test('action-specific rows only show for their action type', () => {
	const rows = ['url', 'notePath', 'commandId', 'pageId', 'openInNewTab'];
	const actionOf = {
		url: 'url',
		notePath: 'note',
		commandId: 'command',
		pageId: 'page',
		openInNewTab: 'note',
	};
	for (const row of rows) {
		for (const actionType of ['url', 'note', 'command', 'page']) {
			assert.equal(
				shownFor(row, actionType),
				actionOf[row] === actionType,
				`${row} visibility under ${actionType}`,
			);
		}
	}
});
