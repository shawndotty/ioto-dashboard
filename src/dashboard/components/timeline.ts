import { t } from "../../lang/helpers";
import {
	applyArrange,
	type PresentationSpec,
} from "../dataset/presentation";
import {
	type TimelineDateField,
	type TimelineRange,
} from "../dataset/types";
import type { TimelineSourceRef } from "../dataset/timeline";
import type { ComponentDefinition, SettingOption } from "../registry";
import { cardSearchText, mountCardSearch } from "../ui/card-search";
import {
	matchesTimelineTypes,
	mountTimelineTypeFilter,
	timelineTypeFilterActive,
	timelineTypeFilterEnabled,
} from "../ui/timeline-type-filter";

export type TimelineCardSort = "created" | "modified" | "title";

const RANGE_OPTIONS: SettingOption[] = [
	{ value: "7", labelKey: "SETTING_RANGE_7" },
	{ value: "14", labelKey: "SETTING_RANGE_14" },
	{ value: "30", labelKey: "SETTING_RANGE_30" },
	{ value: "90", labelKey: "SETTING_RANGE_90" },
	{ value: "180", labelKey: "SETTING_RANGE_180" },
	{ value: "365", labelKey: "SETTING_RANGE_365" },
];

const DATE_FIELD_OPTIONS: SettingOption[] = [
	{ value: "auto", labelKey: "TIMELINE_DATE_AUTO" },
	{ value: "filename", labelKey: "TIMELINE_DATE_FILENAME" },
	{ value: "created", labelKey: "TIMELINE_DATE_CREATED" },
	{ value: "modified", labelKey: "TIMELINE_DATE_MODIFIED" },
];

const CARD_SORT_OPTIONS: SettingOption[] = [
	{ value: "created", labelKey: "CARD_SORT_CREATED" },
	{ value: "modified", labelKey: "CARD_SORT_MODIFIED" },
	{ value: "title", labelKey: "CARD_SORT_TITLE" },
];

export function cardSortOf(value: unknown): TimelineCardSort {
	return value === "modified" || value === "title" ? value : "created";
}

function dateFieldOf(value: unknown): TimelineDateField {
	return value === "auto" || value === "filename" || value === "created"
		? value
		: "modified";
}

function rangeOf(value: unknown): TimelineRange {
	const parsed = Number(value);
	return parsed === 7 ||
		parsed === 14 ||
		parsed === 30 ||
		parsed === 90 ||
		parsed === 180 ||
		parsed === 365
		? parsed
		: 30;
}

/** Clamps the configurable per-day card cap to [1, 100] (below the 500 hard cap). */
export function maxPerDayOf(value: unknown): number {
	const parsed = Number(value ?? 8);
	if (!Number.isFinite(parsed)) return 8;
	return Math.max(1, Math.min(100, Math.trunc(parsed)));
}

/**
 * 放大态只把每日可见条数抬到 20（16–24 建议区间内），
 * 用户显式设更大的值一律保留，不被放大态压低。
 */
export function maxPerDayForStage(value: unknown, stage?: "grid" | "zoom"): number {
	const configured = maxPerDayOf(value);
	if (stage !== "zoom") return configured;
	return Math.max(configured, 20);
}

/** Number of refs hidden behind the "More" button. */
export function moreCountOf(relatedTotal: number, maxPerDay: number): number {
	return Math.max(0, relatedTotal - maxPerDay);
}

/** 搜卡片标题 / 路径末段 / ioType；空关键词视为全部命中。 */
export function matchesTimelineRef(
	ref: TimelineSourceRef,
	query: string,
): boolean {
	const needle = query.trim().toLocaleLowerCase();
	if (needle.length === 0) return true;
	return [ref.label, ref.path?.split("/").pop(), ref.ioType].some((value) =>
		(value ?? "").toLocaleLowerCase().includes(needle),
	);
}

/**
 * Sorts the refs of one day bucket without mutating the input.
 * `created` → ctime asc, `modified` → mtime asc, `title` → label asc;
 * path is a stable tie-breaker for all three.
 */
export function sortTimelineRefs(
	refs: readonly TimelineSourceRef[],
	cardSort: unknown,
): TimelineSourceRef[] {
	const sort = cardSortOf(cardSort);
	return refs.slice().sort((a, b) => {
		let diff = 0;
		if (sort === "title") {
			diff = a.label.localeCompare(b.label);
		} else if (sort === "modified") {
			diff = (a.mtime ?? 0) - (b.mtime ?? 0);
		} else {
			diff = (a.ctime ?? 0) - (b.ctime ?? 0);
		}
		if (diff !== 0) return diff;
		return a.path.localeCompare(b.path);
	});
}

export const timelineComponent: ComponentDefinition = {
	type: "timeline",
	labelKey: "COMPONENT_TIMELINE_NAME",
	descriptionKey: "COMPONENT_TIMELINE_DESC",
	icon: "history",
	category: "overview",
	objects: ["note"],
	queryTargets: ["note"],
	views: ["list"],
	viewDefault: "list",
	measureDefault: "timeline",
	defaultQueryId: "builtin:notes-all",
	createConfig: (queryId) => ({
		queryId,
		view: "list",
		measure: "timeline",
		options: {
			range: "30",
			dateField: "modified",
			cardSort: "created",
			maxPerDay: 8,
		},
		w: 6,
		h: 8,
	}),
	size: { minW: 4, minH: 4, maxH: 24 },
	settings: [
		{ key: "queryId", kind: "query", group: "data" },
		{
			key: "range",
			kind: "select",
			group: "data",
			labelKey: "SETTING_RANGE",
			options: RANGE_OPTIONS,
			fallback: "30",
			target: "options",
		},
		{
			key: "dateField",
			kind: "select",
			group: "data",
			labelKey: "SETTING_TIMELINE_DATE_FIELD",
			options: DATE_FIELD_OPTIONS,
			fallback: "modified",
			target: "options",
			hintKey: "SETTING_TIMELINE_DATE_HINT",
		},
		{
			key: "cardSort",
			kind: "select",
			group: "data",
			labelKey: "SETTING_CARD_SORT",
			options: CARD_SORT_OPTIONS,
			fallback: "created",
			target: "options",
		},
		{
			key: "maxPerDay",
			kind: "number",
			group: "data",
			labelKey: "SETTING_MAX_PER_DAY",
			min: 1,
			max: 100,
			step: 1,
			fallback: 8,
			target: "options",
		},
		{ key: "title", kind: "text", group: "display" },
	],
	// 日期桶级整理：date/total/size 可排序筛选；不开 group，且不做卡片级 arrange。
	arrange: { sort: true, filter: true },
	toDatasetRequest: (config) => ({
		object: "note",
		measure: "timeline",
		queryId: config.queryId,
		range: rangeOf(config.options?.range),
		timeline: {
			bucket: "day",
			dateField: dateFieldOf(config.options?.dateField),
		},
	}),
	isEmptyDataset: (dataset) => (dataset.sourceTotal ?? 0) === 0,
	isEmpty: () => false,
	render: (el, ctx) => {
		el.addClass("ioto-timeline");
		const rows = ctx.dataset?.rows ?? [];
		const sourceTotal = ctx.dataset?.sourceTotal ?? 0;
		if (rows.length === 0 || sourceTotal === 0) {
			el.createDiv({ cls: "ioto-timeline-empty", text: t("TIMELINE_EMPTY") });
			return;
		}
		const keyword = cardSearchText(ctx.config);
		const typeActive = timelineTypeFilterActive(ctx.config);
		const enabledTypes = timelineTypeFilterEnabled(ctx.config);
		const spec: PresentationSpec = ctx.arrange?.spec ?? { v: 1 };
		const arranged = applyArrange(rows, spec, {
			columns: ctx.dataset?.columns ?? [],
			defaultSort: { key: "date", dir: -1 },
		});
		// applyArrange 的默认 date 降序已产出「今天在最上」，与旧 rows.slice().reverse() 同序；
		// 不要再 reverse（实测再 reverse 会把今天翻到最下）。
		const ordered = arranged.rows;
		const options = ctx.config.options ?? {};
		const cardSort = cardSortOf(options.cardSort);
		const maxPerDay = maxPerDayForStage(options.maxPerDay, ctx.stage);
		let visibleRows = 0;
		for (const row of ordered) {
			const allRefs = row.related ?? [];
			// 类型过滤与搜索关键词并列串联（AND）。
			const matchedRefs = allRefs.filter(
				(ref) =>
					matchesTimelineTypes(ref, enabledTypes) &&
					(!keyword || matchesTimelineRef(ref, keyword)),
			);
			if ((keyword || typeActive) && matchedRefs.length === 0) continue; // 整行隐藏
			visibleRows += 1;
			const refs = sortTimelineRefs(matchedRefs, cardSort);
			// 过滤态用命中数；无过滤时保留原始 relatedTotal（含 500 上限外的真实总数）。
			// 类型过滤生效时也必须取 refs.length，否则「更多 N」会把被过滤掉的卡片算进去。
			const relatedTotal = keyword || typeActive
				? refs.length
				: (row.relatedTotal ?? allRefs.length);
			const rowEl = el.createDiv({ cls: "ioto-timeline-row" });
			const dayEl = rowEl.createDiv({
				cls: "ioto-timeline-day",
				text: row.cells.date?.text ?? row.id,
			});
			rowEl.createDiv({ cls: "ioto-timeline-axis" });
			const cardsEl = rowEl.createDiv({ cls: "ioto-timeline-cards" });

			// 日期与「更多」共用的弹窗打开逻辑（refs / relatedTotal 与可见卡片同源）
			const openBucket = (event: MouseEvent) => {
				if (ctx.editMode) return;             // 与卡片 click 一致：编辑模式不触发
				event.stopPropagation();
				ctx.openChartBucket?.({
					bucketKey: row.id,
					object: "note",
					cumulative: false,
					series: [],
					refs,
					relatedTotal,
					bucket: "day",
					source: "timeline",
				});
			};
			dayEl.addEventListener("click", openBucket);  // 日期始终可点

			for (const ref of refs.slice(0, maxPerDay)) {
				const cardEl = cardsEl.createDiv({ cls: "ioto-timeline-card" });
				cardEl.setAttr("data-io-type", ref.ioType ?? "Unknown");
				cardEl.createDiv({ cls: "ioto-timeline-card-title", text: ref.label });
				cardEl.addEventListener("click", (event) => {
					if (ctx.editMode) return;
					event.stopPropagation();
					ctx.openFile(ref.path, ref.line);
				});
			}
			const moreCount = moreCountOf(relatedTotal, maxPerDay);
			if (moreCount > 0) {
				const moreEl = cardsEl.createEl("button", {
					cls: "ioto-timeline-more",
					text: t("TIMELINE_MORE", [String(moreCount)]),
					attr: { type: "button" },
				});
				moreEl.addEventListener("click", openBucket);  // 改为共用闭包
			}
		}
		// 空态二选一：arrange 把所有日期筛掉 / 关键词没有命中任何卡片。
		if (arranged.rows.length === 0) {
			const empty = el.createDiv({
				cls: "ioto-timeline-empty",
				text: t("ARRANGE_FILTERED_EMPTY"),
			});
			const clear = empty.createEl("button", {
				cls: "mod-cta",
				text: t("ARRANGE_CLEAR_FILTERS"),
				attr: { type: "button" },
			});
			clear.addEventListener("click", () => ctx.arrange?.clearFilters());
		} else if (visibleRows === 0 && keyword.trim().length > 0) {
			el.createDiv({
				cls: "ioto-timeline-empty",
				text: t("TIMELINE_NO_MATCH", [keyword.trim()]),
			});
		} else if (visibleRows === 0 && typeActive) {
			el.createDiv({
				cls: "ioto-timeline-empty",
				text: t("TIMELINE_TYPE_FILTER_EMPTY"),
			});
		}
	},
	renderHeaderActions: (header, ctx) => {
		const rows = ctx.dataset?.rows ?? [];
		if (rows.length === 0) return; // 空数据集没有可过滤内容
		mountCardSearch(header, {
			config: ctx.config,
			labels: {
				toggle: t("TIMELINE_SEARCH_TOGGLE"),
				placeholder: t("TIMELINE_SEARCH_PLACEHOLDER"),
				close: t("TIMELINE_SEARCH_CLOSE"),
			},
			// ctx.refreshBody 由 arrange 声明间接挂上；restore 时可能尚未挂载，故可选调用。
			onChange: () => ctx.refreshBody?.(),
		});
		mountTimelineTypeFilter(header, {
			config: ctx.config,
			labels: {
				toggle: t("TIMELINE_TYPE_FILTER_TOGGLE"),
				title: t("TIMELINE_TYPE_FILTER_TITLE"),
				close: t("TIMELINE_TYPE_FILTER_CLOSE"),
				all: t("TIMELINE_TYPE_FILTER_ALL"),
				input: t("NAV_INPUT"),
				output: t("NAV_OUTPUT"),
				task: t("NAV_TASKS"),
				outcome: t("NAV_OUTCOME"),
			},
			onChange: () => ctx.refreshBody?.(),
		});
	},
};
