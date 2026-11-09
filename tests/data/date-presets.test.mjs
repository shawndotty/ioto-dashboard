import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './helpers.mjs';

const {
	DATE_PRESETS,
	DATE_PRESET_LABEL_KEYS,
	normalizeDatePreset,
	formatDateInput,
	isDateRangeValid,
	defaultCustomRange,
} = await load('../../src/data/date-presets.ts');

const locales = {
	en: (await load('../../src/lang/locale/en.ts')).default,
	'zh-cn': (await load('../../src/lang/locale/zh-cn.ts')).default,
	'zh-tw': (await load('../../src/lang/locale/zh-tw.ts')).default,
};

test('the preset list is fixed, ordered and includes custom', () => {
	assert.deepEqual(DATE_PRESETS, [
		'all',
		'last1day',
		'last3days',
		'last7days',
		'last14days',
		'last30days',
		'custom',
	]);
});

test('every preset has a label key present and non-empty in every locale', () => {
	for (const preset of DATE_PRESETS) {
		const key = DATE_PRESET_LABEL_KEYS[preset];
		assert.equal(typeof key, 'string', `missing label key for ${preset}`);
		for (const [name, dict] of Object.entries(locales)) {
			assert.equal(
				typeof dict[key],
				'string',
				`${name} is missing ${key} (preset ${preset})`,
			);
			assert.ok(
				dict[key].trim().length > 0,
				`${name}.${key} should not be empty`,
			);
		}
	}
});

test('unknown persisted presets fall back to all', () => {
	assert.equal(normalizeDatePreset('custom'), 'custom');
	assert.equal(normalizeDatePreset('last14days'), 'last14days');
	assert.equal(normalizeDatePreset('yesterday'), 'all');
	assert.equal(normalizeDatePreset(undefined), 'all');
	assert.equal(normalizeDatePreset(''), 'all');
});

test('formatDateInput uses local time, not UTC', () => {
	assert.equal(formatDateInput(new Date(2026, 0, 5)), '2026-01-05');
	assert.equal(formatDateInput(new Date(2026, 11, 31, 23, 45)), '2026-12-31');
});

test('isDateRangeValid treats an empty side as unbounded', () => {
	assert.equal(isDateRangeValid('', ''), true);
	assert.equal(isDateRangeValid('2026-02-01', ''), true);
	assert.equal(isDateRangeValid('', '2026-01-01'), true);
	assert.equal(isDateRangeValid('2026-01-01', '2026-01-01'), true);
	assert.equal(isDateRangeValid('2026-01-01', '2026-02-01'), true);
	assert.equal(isDateRangeValid('2026-02-01', '2026-01-01'), false);
});

test('defaultCustomRange spans the last 7 days including today', () => {
	const range = defaultCustomRange(new Date(2026, 10, 10, 15, 30));
	assert.deepEqual(range, {
		dateStart: '2026-11-04',
		dateEnd: '2026-11-10',
	});
});
