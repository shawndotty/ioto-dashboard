import {
	AI_METRICS_PAGE_ID,
	type DashboardPage,
} from "./types";

/** 页级口径：h 值以 rowHeight=10 为准，默认 72 会把 h19 放大成巨卡。 */
const ROW_HEIGHT = 10;
const GAP = 12;

/** 标准 5 卡预置页：A1 逐行铺满 12 列（4+8 / 4+4+4）。 */
const STANDARD_FIVE = {
	types: [
		"ai-runs-kpi",
		"ai-runs-agents",
		"ai-runs-frequency",
		"ai-runs-schedule",
		"ai-runs-recent",
	] as const,
	w: [4, 8, 4, 4, 4],
	h: [19, 19, 17, 17, 17],
};

/**
 * 当前库 6 卡（当日 / 最近7天 成对）：宽度 6,6,3,3,3,3 已零空洞，
 * 只按 type 校正 h（agents 19 / 其余 17），w 原样保留，卡不增删。
 */
const CURRENT_SIX = {
	types: [
		"ai-runs-agents",
		"ai-runs-agents",
		"ai-runs-kpi",
		"ai-runs-kpi",
		"ai-runs-recent",
		"ai-runs-frequency",
	] as const,
	w: [6, 6, 3, 3, 3, 3],
	h: [19, 19, 17, 17, 17, 17],
};

/** 供单测直接断言的目标布局常量表。 */
export const AI_METRICS_LAYOUTS = {
	standard5: STANDARD_FIVE,
	current6: CURRENT_SIX,
	rowHeight: ROW_HEIGHT,
	gap: GAP,
};

function matchesTypes(types: string[], expected: readonly string[]): boolean {
	return (
		types.length === expected.length &&
		types.every((type, index) => type === expected[index])
	);
}

/**
 * 把一张 AI 指标页就地重排为紧凑布局（只写 w/h + 页级 rowHeight/gap）。
 * 返回浅拷贝；未知组合返回 null（fail-safe，调用方据此拒绝写盘）。
 */
export function applyAiMetricsCompactLayout(
	page: DashboardPage,
): DashboardPage | null {
	if (page.id !== AI_METRICS_PAGE_ID) return null;

	const types = page.components.map((component) => component.type);
	let chosen: typeof STANDARD_FIVE | typeof CURRENT_SIX | null = null;
	let keepWidth = false;
	if (matchesTypes(types, STANDARD_FIVE.types)) {
		chosen = STANDARD_FIVE;
	} else if (matchesTypes(types, CURRENT_SIX.types)) {
		chosen = CURRENT_SIX;
		keepWidth = true;
	}
	if (!chosen) return null;

	const layout = chosen;
	return {
		...page,
		rowHeight: ROW_HEIGHT,
		gap: GAP,
		components: page.components.map((component, index) => ({
			...component,
			w: keepWidth ? component.w : layout.w[index],
			h: layout.h[index],
		})),
	};
}
