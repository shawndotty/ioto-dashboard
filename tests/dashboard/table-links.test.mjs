import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { resolveCellLink } = await load(
	'../../src/dashboard/dataset/views/table.ts',
);

test('task cells keep their line for navigation', () => {
	assert.deepEqual(
		resolveCellLink({ text: '写报告', path: '3-任务/Plan.md', line: 12 }),
		{ path: '3-任务/Plan.md', line: 12, kind: 'task' },
	);
	assert.equal(
		resolveCellLink({ text: '写报告', path: '3-任务/Plan.md', line: 0 }).kind,
		'task',
	);
});

test('note, file and folder cells are auto links', () => {
	assert.deepEqual(resolveCellLink({ text: '笔记', path: '1-输入/A.md' }), {
		path: '1-输入/A.md',
		line: undefined,
		kind: 'auto',
	});
	assert.equal(resolveCellLink({ text: '图片', path: '0-辅助/a.png' }).kind, 'auto');
	assert.equal(resolveCellLink({ text: '文件夹', path: '3-任务' }).kind, 'auto');
});

test('cells without a usable path are not links', () => {
	assert.equal(resolveCellLink(undefined), null);
	assert.equal(resolveCellLink({ text: '3' }), null);
	assert.equal(resolveCellLink({ text: '根目录', path: '' }), null);
	assert.equal(resolveCellLink({ text: '空', line: 5 }), null);
});

test('an empty label with a path still yields a clickable link', () => {
	const link = resolveCellLink({ text: '', path: '1-输入/B.md' });
	assert.deepEqual(link, {
		path: '1-输入/B.md',
		line: undefined,
		kind: 'auto',
	});
});
