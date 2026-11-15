import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { extractBaseViews, baseViewChoices, hasBaseView } = await load(
	'../../src/dashboard/base-views.ts',
);

test('extractBaseViews keeps named views in file order', () => {
	const views = extractBaseViews({
		views: [
			{ type: 'table', name: '表格' },
			{ type: 'cards', name: '卡片' },
		],
	});
	assert.deepEqual(views, [
		{ name: '表格', type: 'table' },
		{ name: '卡片', type: 'cards' },
	]);
});

test('extractBaseViews ignores nameless, invalid and malformed entries', () => {
	const views = extractBaseViews({
		views: [
			{ type: 'table' },
			{ type: 'table', name: '   ' },
			{ type: 'table', name: 42 },
			null,
			'表格',
			{ type: 'table', name: '有效' },
			{ name: '无类型' },
		],
	});
	assert.deepEqual(views, [
		{ name: '有效', type: 'table' },
		{ name: '无类型', type: '' },
	]);
});

test('extractBaseViews tolerates non-object input and a missing views list', () => {
	assert.deepEqual(extractBaseViews(null), []);
	assert.deepEqual(extractBaseViews(undefined), []);
	assert.deepEqual(extractBaseViews('views: []'), []);
	assert.deepEqual(extractBaseViews([1, 2, 3]), []);
	assert.deepEqual(extractBaseViews({}), []);
	assert.deepEqual(extractBaseViews({ views: 'table' }), []);
});

test('baseViewChoices dedupes while keeping the first occurrence', () => {
	const choices = baseViewChoices([
		{ name: '表格', type: 'table' },
		{ name: '卡片', type: 'cards' },
		{ name: '表格', type: 'cards' },
		{ name: '', type: 'table' },
	]);
	assert.deepEqual(choices, ['表格', '卡片']);
	assert.deepEqual(baseViewChoices([]), []);
});

test('hasBaseView matches exact names and rejects blanks', () => {
	const views = [
		{ name: '表格', type: 'table' },
		{ name: 'Table', type: 'table' },
	];
	assert.equal(hasBaseView(views, '表格'), true);
	assert.equal(hasBaseView(views, 'Table'), true);
	assert.equal(hasBaseView(views, 'table'), false);
	assert.equal(hasBaseView(views, ''), false);
	assert.equal(hasBaseView(views, '   '), false);
	assert.equal(hasBaseView([], '表格'), false);
});