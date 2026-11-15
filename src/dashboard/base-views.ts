/**
 * Pure helpers for reading view names out of a parsed `.base` file. Kept free
 * of `obsidian` imports so `parseYaml` stays at the call site and these can run
 * under the test runner.
 */

export interface BaseViewInfo {
	name: string;
	type: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从 parseYaml 结果里抽出具名视图；忽略无名/非法条目。 */
export function extractBaseViews(parsed: unknown): BaseViewInfo[] {
	if (!isRecord(parsed)) return [];
	const raw = parsed.views;
	if (!Array.isArray(raw)) return [];
	const views: BaseViewInfo[] = [];
	for (const entry of raw) {
		if (!isRecord(entry)) continue;
		const name = typeof entry.name === "string" ? entry.name : "";
		if (!name.trim()) continue;
		const type = typeof entry.type === "string" ? entry.type : "";
		views.push({ name, type });
	}
	return views;
}

/** 视图选择器的候选名：默认视图在前，其余按文件顺序、去重。 */
export function baseViewChoices(views: readonly BaseViewInfo[]): string[] {
	const seen = new Set<string>();
	const choices: string[] = [];
	for (const view of views) {
		if (!view.name || seen.has(view.name)) continue;
		seen.add(view.name);
		choices.push(view.name);
	}
	return choices;
}

export function hasBaseView(
	views: readonly BaseViewInfo[],
	name: string,
): boolean {
	if (!name.trim()) return false;
	return views.some((view) => view.name === name);
}