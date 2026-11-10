/** Obsidian 原生文档类型，不参与「文件」查询。 */
export const NOTE_EXTENSIONS = new Set(["md", "canvas"]);

export type FileExtensionGroupKey =
	| "document"
	| "sheet"
	| "slide"
	| "image"
	| "media"
	| "archive";

export const FILE_EXTENSION_GROUPS = [
	{ key: "document", extensions: ["pdf", "doc", "docx", "txt", "rtf", "odt"] },
	{ key: "sheet", extensions: ["xls", "xlsx", "csv", "ods"] },
	{ key: "slide", extensions: ["ppt", "pptx", "key", "odp"] },
	{ key: "image", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic"] },
	{ key: "media", extensions: ["mp3", "wav", "m4a", "mp4", "mov", "webm"] },
	{ key: "archive", extensions: ["zip", "rar", "7z", "tar", "gz"] },
] as const satisfies readonly {
	key: FileExtensionGroupKey;
	extensions: readonly string[];
}[];

/** 去空格、去前导点、转小写、去重排序；丢弃非法值与笔记类型。 */
export function normalizeExtensions(input: readonly string[] | undefined): string[] {
	const out = new Set<string>();
	for (const raw of input ?? []) {
		const ext = raw.trim().replace(/^\.+/, "").toLowerCase();
		if (ext.length === 0 || /[/\\]/.test(ext)) continue;
		if (NOTE_EXTENSIONS.has(ext)) continue;
		out.add(ext);
	}
	return [...out].sort();
}

/** 空白名单 = 全部非笔记文件；笔记类型永远不命中。 */
export function matchesFileExtension(
	extension: string,
	allowed: readonly string[],
): boolean {
	const ext = extension.toLowerCase();
	if (NOTE_EXTENSIONS.has(ext)) return false;
	return allowed.length === 0 || allowed.includes(ext);
}
