import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	SnapshotStore,
	collectDailySnapshot,
	buildDailySnapshot,
	localDate,
	mergeSnapshotFiles,
	dailyPoints,
} = await load('../../src/metrics/snapshot-store.ts');

const HEADINGS = {
	task: ['任务'],
	input: ['输入 LEARN'],
	output: ['输出 THINK'],
	outcome: ['成果 DO'],
	goal: ['目标'],
	review: ['复盘'],
};

const CONFIG = {
	inputFolder: '1-输入',
	outputFolder: '2-输出',
	taskFolder: '3-任务',
	outcomeFolder: '4-成果',
	headings: HEADINGS,
};

const DIR = '.obsidian/plugins/ioto-dashboard';

function memoryAdapter(initial = {}) {
	const files = new Map(Object.entries(initial));
	return {
		files,
		exists: async (path) => files.has(path),
		read: async (path) => {
			if (!files.has(path)) throw new Error(`missing ${path}`);
			return files.get(path);
		},
		write: async (path, data) => {
			files.set(path, data);
		},
		rename: async (from, to) => {
			files.set(to, files.get(from));
			files.delete(from);
		},
	};
}

function store(adapter, now, deviceId = 'dev-a') {
	return new SnapshotStore({ adapter, dir: DIR, deviceId, now: () => now });
}

function task(overrides = {}) {
	return {
		path: '3-任务/Alpha/a.md',
		line: 1,
		marker: 'open',
		isCompleted: false,
		text: 't',
		indent: 0,
		ioType: 'Task',
		sectionRole: 'task',
		sectionHeading: '任务',
		project: 'Alpha',
		noteCtime: 1,
		noteMtime: 1,
		noteBasename: 'a',
		noteSize: 1,
		...overrides,
	};
}

function snapshot() {
	return {
		notes: [
			{
				path: '3-任务/Alpha/a.md',
				basename: 'a',
				folder: '3-任务/Alpha',
				ioType: 'Task',
				project: 'Alpha',
				ctime: 1,
				mtime: 1,
				size: 1,
				fileTaskCount: 2,
				fileCompletedCount: 1,
				sectionTaskCount: 2,
				sectionCompletedCount: 1,
			},
		],
		tasks: [
			task(),
			task({ line: 2, marker: 'done', isCompleted: true }),
			task({ line: 3, marker: 'cancelled' }),
		],
		projects: [],
	};
}

test('writes only the snapshot file via tmp + rename', async () => {
	const adapter = memoryAdapter();
	const now = new Date(2026, 10, 8, 10, 0).getTime();
	await collectDailySnapshot(snapshot(), CONFIG, store(adapter, now), now);
	assert.deepEqual([...adapter.files.keys()], [`${DIR}/metrics-snapshots.json`]);
	const parsed = JSON.parse(adapter.files.get(`${DIR}/metrics-snapshots.json`));
	assert.equal(Object.keys(parsed.days).length, 1);
	assert.equal(parsed.days['2026-11-08'].totals.tasks, 3);
	assert.equal(parsed.days['2026-11-08'].totals.open, 1);
	assert.equal(parsed.days['2026-11-08'].totals.cancelled, 1);
});

test('same day overwrites, next day appends', async () => {
	const adapter = memoryAdapter();
	const day1 = new Date(2026, 10, 8, 9, 0).getTime();
	const day2 = new Date(2026, 10, 9, 9, 0).getTime();
	await collectDailySnapshot(snapshot(), CONFIG, store(adapter, day1), day1);
	await collectDailySnapshot(snapshot(), CONFIG, store(adapter, day2), day2);
	const parsed = JSON.parse(adapter.files.get(`${DIR}/metrics-snapshots.json`));
	assert.deepEqual(Object.keys(parsed.days).sort(), ['2026-11-08', '2026-11-09']);
});

test('retention keeps at most 180 calendar days', async () => {
	const adapter = memoryAdapter();
	const now = new Date(2026, 10, 8, 9, 0).getTime();
	const old = new Date(2026, 4, 1, 9, 0).getTime();
	await collectDailySnapshot(snapshot(), CONFIG, store(adapter, old), old);
	await collectDailySnapshot(snapshot(), CONFIG, store(adapter, now), now);
	const parsed = JSON.parse(adapter.files.get(`${DIR}/metrics-snapshots.json`));
	assert.deepEqual(Object.keys(parsed.days), ['2026-11-08']);
});

test('corrupt JSON is reported and never overwritten', async () => {
	const path = `${DIR}/metrics-snapshots.json`;
	const adapter = memoryAdapter({ [path]: '{not json' });
	const now = new Date(2026, 10, 8, 9, 0).getTime();
	const result = await collectDailySnapshot(
		snapshot(),
		CONFIG,
		store(adapter, now),
		now,
	);
	assert.equal(result, null);
	assert.equal(adapter.files.get(path), '{not json');
});

test('empty index is not recorded as a fake zero', async () => {
	const adapter = memoryAdapter();
	const now = Date.now();
	const result = await collectDailySnapshot(
		{ notes: [], tasks: [], projects: [] },
		CONFIG,
		store(adapter, now),
		now,
	);
	assert.equal(result, null);
	assert.equal(adapter.files.size, 0);
});

test('local date follows the local timezone at the day boundary', () => {
	assert.equal(localDate(new Date(2026, 10, 8, 23, 59).getTime()), '2026-11-08');
	assert.equal(localDate(new Date(2026, 10, 9, 0, 1).getTime()), '2026-11-09');
});

test('scope fingerprint changes set scopeChangedAt', async () => {
	const adapter = memoryAdapter();
	const now = new Date(2026, 10, 8, 9, 0).getTime();
	await collectDailySnapshot(snapshot(), CONFIG, store(adapter, now), now);
	const changed = { ...CONFIG, headings: { ...HEADINGS, task: ['TODO'] } };
	await collectDailySnapshot(
		snapshot(),
		changed,
		store(adapter, now + 3600000),
		now + 3600000,
	);
	const parsed = JSON.parse(adapter.files.get(`${DIR}/metrics-snapshots.json`));
	assert.equal(parsed.days['2026-11-08'].scopeChangedAt, now + 3600000);
});

test('two devices merge by capturedAt and keep the loser in samples', () => {
	const now = new Date(2026, 10, 8, 9, 0).getTime();
	const local = {
		schemaVersion: 1,
		deviceId: 'dev-a',
		days: {
			'2026-11-08': {
				...buildDailySnapshot(snapshot(), CONFIG, now),
				capturedAt: now,
			},
		},
	};
	const remote = {
		schemaVersion: 1,
		deviceId: 'dev-b',
		days: {
			'2026-11-08': {
				...buildDailySnapshot(snapshot(), CONFIG, now + 1000),
				capturedAt: now + 1000,
			},
		},
	};
	const merged = mergeSnapshotFiles(local, remote);
	assert.equal(merged.days['2026-11-08'].capturedAt, now + 1000);
	assert.equal(merged.days['2026-11-08'].samples.at(-1).deviceId, 'dev-a');
});

test('daily points expose completed without interpolation', () => {
	const now = new Date(2026, 10, 8, 9, 0).getTime();
	const file = {
		schemaVersion: 1,
		deviceId: 'dev-a',
		days: {
			'2026-11-07': { ...buildDailySnapshot(snapshot(), CONFIG, now - 86400000), capturedAt: now - 86400000 },
			'2026-11-08': { ...buildDailySnapshot(snapshot(), CONFIG, now), capturedAt: now },
		},
	};
	const points = dailyPoints(file);
	assert.deepEqual(points.map((point) => point.date), ['2026-11-07', '2026-11-08']);
	assert.equal(points[0].completed, 1);
});
