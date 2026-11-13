import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { markdownComponent } = await load(
	'../../src/dashboard/components/markdown.ts',
);

test('the markdown component is queryless and never requests data', () => {
	assert.equal(markdownComponent.type, 'markdown');
	assert.equal(markdownComponent.queryless, true);
	assert.equal(markdownComponent.defaultQueryId, '');
	assert.equal(markdownComponent.toMetricRequest, undefined);
	assert.equal(markdownComponent.toDatasetRequest, undefined);
	assert.equal(markdownComponent.renderHeaderActions, undefined);
});

test('markdown createConfig starts empty and hides the title', () => {
	assert.deepEqual(markdownComponent.createConfig(''), {
		queryId: '',
		options: { markdown: '', hideTitle: true, surface: 'plain' },
		w: 4,
		h: 3,
	});
});

test('markdown declares a title and an options-backed textarea', () => {
	const title = markdownComponent.settings.find(
		(setting) => setting.key === 'title',
	);
	assert.equal(title.kind, 'text');
	const markdown = markdownComponent.settings.find(
		(setting) => setting.key === 'markdown',
	);
	assert.equal(markdown.kind, 'textarea');
	assert.equal(markdown.target, 'options');
	assert.ok(!markdownComponent.settings.some((s) => s.kind === 'query'));
});

test('the markdown card has no empty state and a picker icon', () => {
	assert.equal(markdownComponent.isEmpty(), false);
	assert.equal(markdownComponent.icon, 'file-text');
});
