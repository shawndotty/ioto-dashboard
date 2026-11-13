import { parseColumnSelection } from "../dataset/columns";
import { measureLabelKey, measuresForObject, resolveMeasure } from "../dataset/measures";
import { objectForQuery } from "../dataset/object";
import {
	groupsForObject,
	groupLabelKey,
	renderTable,
	resolveGroupFor,
	type TableHandle,
} from "../dataset/views/table";
import type { ComponentDefinition } from "../registry";
import type { DashboardComponentConfig } from "../types";
import { t } from "../../lang/helpers";
import {
	mountCardSearch,
	type CardSearchHandle,
} from "../ui/card-search";

/** Hard ceiling on fetched rows; page size never enters the dataset cache key. */
export const TABLE_ROW_CAP = 2000;
export const DEFAULT_TABLE_PAGE_SIZE = 50;

interface TableMemory {
	queryId: string;
	page: number;
	sortKey: string;
	sortDir: 1 | -1;
	/** Session-only page size; `limit` from the inspector is the default. */
	pageSize: number;
	limit: number;
}

const memories = new WeakMap<DashboardComponentConfig, TableMemory>();

function memoryOf(config: DashboardComponentConfig): TableMemory {
	const limit = config.limit ?? DEFAULT_TABLE_PAGE_SIZE;
	let memory = memories.get(config);
	if (!memory || memory.queryId !== config.queryId) {
		memory = {
			queryId: config.queryId,
			page: 1,
			sortKey: "",
			sortDir: 1,
			pageSize: limit,
			limit,
		};
		memories.set(config, memory);
	} else if (memory.limit !== limit) {
		memory.limit = limit;
		memory.pageSize = limit;
		memory.page = 1;
	}
	return memory;
}

interface TableCardState {
	queryId: string;
	handle?: TableHandle | null;
	search?: CardSearchHandle;
}

const cardStates = new WeakMap<DashboardComponentConfig, TableCardState>();

function stateOf(config: DashboardComponentConfig): TableCardState {
	let state = cardStates.get(config);
	if (!state || state.queryId !== config.queryId) {
		state = { queryId: config.queryId };
		cardStates.set(config, state);
	}
	return state;
}

export const tableComponent: ComponentDefinition = {
	type: "table",
	labelKey: "COMPONENT_TABLE_NAME",
	descriptionKey: "COMPONENT_TABLE_DESC",
	icon: "table",
	category: "analysis",
	objects: ["task", "note", "file", "folder"],
	queryTargets: ["task", "note", "file", "folder"],
	views: ["table"],
	viewDefault: "table",
	measureDefault: "count",
	defaultQueryId: "builtin:tasks-all",
	createConfig: (queryId) => ({
		queryId,
		basis: "file",
		view: "table",
		measure: "count",
		options: { showRowNumber: false, groupBy: "none" },
		limit: DEFAULT_TABLE_PAGE_SIZE,
		w: 6,
		h: 4,
	}),
	settings: [
		{ key: "queryId", kind: "query", group: "data" },
		{
			key: "basis",
			kind: "basis",
			group: "data",
			fallback: "file",
			when: (_config, context) => objectForQuery(context?.query) === "task",
		},
		{
			key: "measure",
			kind: "select",
			group: "data",
			labelKey: "SETTING_MEASURE",
			options: ({ query }) =>
				measuresForObject(objectForQuery(query)).map((value) => ({
					value,
					labelKey: measureLabelKey(value),
				})),
			fallback: "count",
		},
		{
			key: "groupBy",
			kind: "select",
			group: "data",
			labelKey: "SETTING_TABLE_GROUP_BY",
			options: ({ query }) =>
				groupsForObject(objectForQuery(query)).map((value) => ({
					value,
					labelKey: groupLabelKey(value),
				})),
			fallback: "none",
			target: "options",
		},
		{
			key: "limit",
			kind: "number",
			group: "data",
			labelKey: "COMPONENT_TASK_LIST_PAGE_SIZE",
			min: 1,
			max: 100,
			step: 1,
			fallback: DEFAULT_TABLE_PAGE_SIZE,
		},
		{
			key: "showRowNumber",
			kind: "toggle",
			group: "display",
			labelKey: "DASHBOARD_TABLE_ROW_NUMBER",
			fallback: false,
			target: "options",
		},
		{
			key: "columns",
			kind: "columns",
			group: "display",
			labelKey: "SETTING_TABLE_COLUMNS",
			hintKey: "TABLE_COLUMNS_HINT",
			target: "options",
		},
		{ key: "title", kind: "text", group: "display" },
	],
	toDatasetRequest: (config, query) => {
		const object = objectForQuery(query);
		return {
			object,
			measure: resolveMeasure(config.measure, object),
			queryId: config.queryId,
			limit: TABLE_ROW_CAP,
			...(object === "task" ? { basis: config.basis ?? "file" } : {}),
		};
	},
	isEmptyDataset: (dataset) => dataset.total === 0,
	isEmpty: () => false,
	render: (el, ctx) => {
		if (!ctx.dataset) return;
		const state = stateOf(ctx.config);
		const memory = memoryOf(ctx.config);
		state.handle = renderTable(
			el,
			ctx.dataset,
			(path, line, newTab) => {
				if (ctx.editMode) return;
				if (newTab) ctx.openFileInNewTab?.(path, line);
				else ctx.openFile(path, line);
			},
			{
				showRowNumber: ctx.config.options?.showRowNumber === true,
				editMode: ctx.editMode,
				pageSize: memory.pageSize,
				columns: parseColumnSelection(ctx.config.options?.columns),
				group: resolveGroupFor(
					ctx.dataset.object,
					ctx.config.options?.groupBy,
				),
				state: {
					page: memory.page,
					sortKey: memory.sortKey,
					sortDir: memory.sortDir,
				},
				onStateChange: (patch) => {
					Object.assign(memory, patch);
				},
				openLink: (path, line, newTab) => {
					if (ctx.editMode) return;
					ctx.openLink?.(path, line, newTab);
				},
				openFolder: (path) => ctx.openFolder(path),
				revealInExplorer: (path) => ctx.revealInExplorer(path),
			},
		);
	},
	renderHeaderActions: (header, ctx) => {
		const rows = ctx.dataset?.rows ?? [];
		// 空数据集时卡片本身就是空态，没有内容可过滤。
		if (rows.length === 0) return;
		const state = stateOf(ctx.config);
		state.search = mountCardSearch(header, {
			config: ctx.config,
			labels: {
				toggle: t("TABLE_SEARCH_TOGGLE"),
				placeholder: t("TABLE_SEARCH_PLACEHOLDER"),
				close: t("TABLE_SEARCH_CLOSE"),
			},
			onChange: (text) => state.handle?.setFilter(text),
		});
	},
};
