import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { AiScheduleSource, isScheduleBoard, localDayKey } = await load(
	'../../src/services/ai-schedule-source.ts',
);

const SETTINGS = { IOTOFrameworkPath: '0-辅助/IOTO' };

function boardJson(over = {}) {
	return JSON.stringify({
		schemaVersion: 1,
		generatedAt: 1795645018081,
		day: '2026-11-26',
		enabled: true,
		maxPerDay: 1,
		graceMinutes: 180,
		failureThreshold: 3,
		rules: [],
		today: [],
		...over,
	});
}

function sourceWith(raw) {
	const app = {
		vault: {
			adapter: {
				read: async () => {
					if (raw instanceof Error) throw raw;
					return raw;
				},
			},
		},
	};
	return new AiScheduleSource({ app, getSettings: () => SETTINGS });
}

test('bridgePath / matchesPath 跟随 IOTOFrameworkPath', () => {
	const source = sourceWith(boardJson());
	assert.equal(source.bridgePath(), '0-辅助/IOTO/Dashboard/AI-Schedule-Board.md');
	assert.equal(source.matchesPath('0-辅助/IOTO/Dashboard/AI-Schedule-Board.md'), true);
	assert.equal(source.matchesPath('0-辅助/IOTO/Dashboard/AI-Runs-Snapshot.md'), false);
	const unset = new AiScheduleSource({ app: {}, getSettings: () => ({}) });
	assert.equal(unset.bridgePath(), null);
	assert.equal(unset.matchesPath('anything'), false);
});

test('合法 board 被读取并广播；同一 generatedAt 不重复广播', async () => {
	const source = sourceWith(boardJson());
	let broadcasts = 0;
	source.subscribe(() => broadcasts++);
	const first = await source.read();
	assert.equal(first?.day, '2026-11-26');
	assert.equal(broadcasts, 1);
	await source.read();
	assert.equal(broadcasts, 1);
});

test('缺字段 / 未知 schemaVersion / 非法 JSON / 读失败 → null 降级', async () => {
	for (const raw of [
		boardJson({ schemaVersion: 2 }),
		boardJson({ rules: undefined }),
		'{not json',
		new Error('missing'),
	]) {
		const source = sourceWith(raw);
		assert.equal(await source.read(), null);
		assert.equal(source.boardNow(), null);
	}
});

test('isScheduleBoard 形状校验', () => {
	assert.equal(isScheduleBoard(JSON.parse(boardJson())), true);
	assert.equal(isScheduleBoard(null), false);
	assert.equal(isScheduleBoard({ schemaVersion: 1 }), false);
});

test('version() 含 generatedAt 与分钟桶', async () => {
	const source = sourceWith(boardJson());
	await source.read();
	const version = source.version();
	assert.match(version, /^1795645018081:\d+$/);
});

test('localDayKey 与上游同口径', () => {
	assert.equal(localDayKey(new Date(2026, 10, 26, 23, 59).getTime()), '2026-11-26');
});