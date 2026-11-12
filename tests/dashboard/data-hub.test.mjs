import assert from 'node:assert/strict';
import test from 'node:test';
import '../stubs/obsidian.mjs';
import { load } from '../data/helpers.mjs';

const { DataHub } = await load('../../src/dashboard/data-hub.ts');
const { datasetKey } = await load('../../src/dashboard/dataset/types.ts');
const { createDefaultFilterState } = await load(
	'../../src/data/saved-query-adapter.ts',
);

function query(target = 'note') {
	return {
		id: 'q1',
		name: 'Q',
		target,
		scope: { folders: [], includeSubfolders: true },
		filters: createDefaultFilterState(),
	};
}

function emptySnapshot(marker = 'snapshot') {
	return { notes: [], tasks: [], projects: [], marker };
}

function makeHub({ fail = null } = {}) {
	const state = {
		fail,
		snapshot: emptySnapshot(),
		query: query('note'),
	};
	const hub = new DataHub({
		index: {
			getSnapshot: async () => {
				if (state.fail) throw new Error(state.fail);
				return state.snapshot;
			},
		},
		getQueries: () => ({
			get: (id) => (id === state.query.id ? state.query : undefined),
		}),
		getIndexConfig: () => ({
			inputFolder: '1-输入',
			outputFolder: '2-输出',
			taskFolder: '3-任务',
			outcomeFolder: '4-成果',
			headings: {},
		}),
		getCustomFilters: () => [],
		now: () => 0,
		retryDelaysMs: [],
	});
	return { hub, state };
}

function waitIdle(hub) {
	return new Promise((resolve) => {
		const unsubscribe = hub.subscribe(() => {
			if (hub.isLoading()) return;
			unsubscribe();
			resolve();
		});
	});
}

const NOTE_COUNT = { object: 'note', measure: 'count', queryId: 'q1' };

test('failed refresh always leaves loading and records the error', async () => {
	const { hub } = makeHub({ fail: 'boom' });
	await hub.refresh();

	assert.equal(hub.isLoading(), false);
	assert.equal(hub.getLastError(), 'boom');
});

test('refreshNow clears failure records and recovers', async () => {
	const { hub, state } = makeHub({ fail: 'boom' });
	const key = datasetKey(NOTE_COUNT);

	let idle = waitIdle(hub);
	hub.setDatasetRequests([NOTE_COUNT]);
	await idle;
	assert.equal(hub.isLoading(), false);
	assert.ok(hub.getLastError());
	assert.ok(hub.getDatasetError(key));

	state.fail = null;
	idle = waitIdle(hub);
	hub.refreshNow();
	await idle;

	assert.equal(hub.getLastError(), null);
	assert.equal(hub.getDatasetError(key), undefined);
	assert.ok(hub.getDataset(key));
});

test('switching the query key publishes a dataset for the new key', async () => {
	const { hub } = makeHub();
	const first = { ...NOTE_COUNT };
	const second = { ...NOTE_COUNT, limit: 5 };

	let idle = waitIdle(hub);
	hub.setDatasetRequests([first]);
	await idle;
	assert.ok(hub.getDataset(datasetKey(first)));

	idle = waitIdle(hub);
	hub.setDatasetRequests([second]);
	await idle;
	assert.ok(hub.getDataset(datasetKey(second)));
	assert.equal(hub.getDataset(datasetKey(first)), undefined);
});

test('a stale refresh does not overwrite a newer result', async () => {
	let call = 0;
	const hub = new DataHub({
		index: {
			getSnapshot: () => {
				call += 1;
				if (call === 1) {
					return new Promise((resolve) => {
						setTimeout(() => resolve(emptySnapshot('slow')), 50);
					});
				}
				return Promise.resolve(emptySnapshot('fast'));
			},
		},
		getQueries: () => ({ get: () => undefined }),
		getIndexConfig: () => ({
			inputFolder: '',
			outputFolder: '',
			taskFolder: '',
			outcomeFolder: '',
			headings: {},
		}),
		getCustomFilters: () => [],
		now: () => 0,
		retryDelaysMs: [],
	});

	const stale = hub.refresh();
	const fresh = hub.refresh();
	await Promise.all([stale, fresh]);

	assert.equal(hub.getSnapshot()?.marker, 'fast');
	assert.equal(hub.isLoading(), false);
});

test('one failing adapter only fails its own key', async () => {
	const { hub } = makeHub();
	const good = { ...NOTE_COUNT };
	const bad = { object: 'bogus', measure: 'count', queryId: 'q1' };

	const idle = waitIdle(hub);
	hub.setDatasetRequests([good, bad]);
	await idle;

	assert.ok(hub.getDataset(datasetKey(good)));
	assert.equal(hub.getDataset(datasetKey(bad)), undefined);
	assert.ok(hub.getDatasetError(datasetKey(bad)));
	assert.equal(hub.getLastError(), null);
});
