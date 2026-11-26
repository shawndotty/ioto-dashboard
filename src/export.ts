/* global createEl */

/**
 * Dashboard 当前页导出为图片的管线（[[Plan-20261126-152630]]，做法移植自
 * ioto-tasks-center 已真机验证的实现 —— 跨插件只复用做法、代码在本插件内重写）。
 *
 * 分两层：
 * - 纯函数层（文件名 / 倍率钳制 / canvas 上限 / 背景解析）：不碰 DOM，单测主战场；
 * - DOM/IO 层（光栅化 / 页眉合成 / 剪贴板 / 落盘）：真机验证。
 *
 * 技术路线 = `html-to-image`（DOM 克隆 → 内联计算样式 → `foreignObject` 光栅化）。
 * 排除 Electron `capturePage`（只拍视口、无长图、帧滞后）与 CDP `captureScreenshot`
 * （`debugger.attach` 常被占用），理由见 [[Research-20261126-152157]] §3.1。
 */

import { toCanvas } from "html-to-image";
import type { App } from "obsidian";

export const EXPORT_SCALE_MIN = 1;
export const EXPORT_SCALE_MAX = 4;
export const EXPORT_SCALE_STEP = 0.5;
/** 2×：主流高分屏像素密度，第一版固定倍率、不加设置项。 */
export const DEFAULT_EXPORT_SCALE = 2;

/** 出图四周的留白（CSS px）；各倍率下乘过倍率再加，视觉留白一致。 */
export const EXPORT_PADDING = 24;

/** canvas 单边硬上限（px）。 */
export const CANVAS_MAX_SIDE = 16384;
/** canvas 总面积硬上限（px²，约 2.68 亿）。 */
export const CANVAS_MAX_AREA = 268_000_000;

/** 文件名里不允许的字符（Windows / macOS 的公共禁区）。 */
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|]/g;

/** 页名为空时的兜底名（与 Obsidian 新建笔记的 `Untitled` 同口径）。 */
const UNTITLED = "Untitled";

/** 深 / 浅色主题下的最终兜底底色（必须**不透明**）。 */
const FALLBACK_DARK = "#1e1e1e";
const FALLBACK_LIGHT = "#ffffff";

function pad2(value: number): string {
	return value < 10 ? `0${value}` : String(value);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/**
 * 导出倍率钳制：非数 / 越界回落默认值，再按 0.5 步长取整（值恒落在步长网格上）。
 */
export function clampExportScale(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_EXPORT_SCALE;
	}
	const clamped = clamp(value, EXPORT_SCALE_MIN, EXPORT_SCALE_MAX);
	return Math.round(clamped / EXPORT_SCALE_STEP) * EXPORT_SCALE_STEP;
}

/**
 * `<清洗后页名>-YYYYMMDD-HHmmss.png`：页名在前便于回看溯源，时间戳保证连导不覆盖。
 * 非法字符替换成 `-`（不删：删掉会让两个不同的名字撞在一起），首尾空白与末尾的点一并去掉。
 */
export function buildExportFileName(pageName: string, at: Date): string {
	const base = (pageName ?? "")
		.replace(ILLEGAL_NAME_CHARS, "-")
		.trim()
		.replace(/\.+$/, "");
	const name = base === "" ? UNTITLED : base;
	const stamp =
		`${at.getFullYear()}${pad2(at.getMonth() + 1)}${pad2(at.getDate())}` +
		`-${pad2(at.getHours())}${pad2(at.getMinutes())}${pad2(at.getSeconds())}`;
	return `${name}-${stamp}.png`;
}

/**
 * 判定一个**已解析**的 CSS 颜色是否不透明。
 *
 * 透明底 + 半透明卡片发到聊天软件会变黑，所以导出必须压在实底上。
 * `transparent` 与 `rgba(r,g,b,0)` / `rgb(r g b / 0)` 都算透明。
 */
export function isOpaqueBackground(color: string | null | undefined): boolean {
	if (typeof color !== "string") {
		return false;
	}
	const value = color.trim().toLowerCase();
	if (value === "" || value === "transparent" || value === "none") {
		return false;
	}
	const alphaMatch = /(?:rgba?\((?:[^)]*?)[,\s/]+([\d.]+%?)\s*\))/.exec(value);
	if (alphaMatch && alphaMatch[1] !== undefined) {
		const raw = alphaMatch[1];
		const alpha = raw.endsWith("%")
			? Number.parseFloat(raw) / 100
			: Number.parseFloat(raw);
		if (Number.isFinite(alpha) && alpha <= 0) {
			return false;
		}
	}
	return true;
}

/**
 * 从一串候选背景色里挑第一个**不透明**的；全透明则回落到主题实底。
 */
export function pickOpaqueBackground(
	candidates: Array<string | null | undefined>,
	isDarkTheme: boolean,
): string {
	for (const candidate of candidates) {
		if (isOpaqueBackground(candidate)) {
			return (candidate as string).trim();
		}
	}
	return isDarkTheme ? FALLBACK_DARK : FALLBACK_LIGHT;
}

/**
 * 解析导出用的**不透明**底色：优先视图根自身的 `background-color`，否则沿祖先找到第一个
 * 不透明背景；最终兜底主题实底。玻璃主题的 Aurora 挂在视图根 `::before`，天然不参与解析。
 */
export function resolveExportBackground(viewRootEl: HTMLElement): string {
	const candidates: Array<string | null | undefined> = [];
	let node: HTMLElement | null = viewRootEl;
	let guard = 0;
	while (node && guard < 32) {
		const style = node.ownerDocument.defaultView?.getComputedStyle(node);
		candidates.push(style?.backgroundColor ?? null);
		node = node.parentElement;
		guard += 1;
	}
	const doc = viewRootEl.ownerDocument;
	const isDark =
		doc.body?.classList.contains("theme-dark") === true ||
		doc.documentElement.classList.contains("theme-dark");
	return pickOpaqueBackground(candidates, isDark);
}

/**
 * 在「全高 × 期望倍率」超出 canvas 硬上限时自动下调倍率（下限 1），避免 `toBlob` 静默失败。
 */
export function computeCanvasScaleLimit(
	cssWidth: number,
	cssHeight: number,
	desiredScale: number,
): number {
	const width = Math.max(1, cssWidth);
	const height = Math.max(1, cssHeight);
	const sideLimit = CANVAS_MAX_SIDE / Math.max(width, height);
	const areaLimit = Math.sqrt(CANVAS_MAX_AREA / (width * height));
	const limit = Math.min(desiredScale, sideLimit, areaLimit);
	return Math.max(EXPORT_SCALE_MIN, limit);
}

/** 已知**拍不到**的内容（iframe 跨文档；Canvas minimap 由核心绘制）。 */
const UNCAPTURABLE_SELECTOR = "iframe, .canvas-minimap";

export function hasUncapturableContent(rootEl: Element): boolean {
	return rootEl.querySelector(UNCAPTURABLE_SELECTOR) !== null;
}

/** 需显式内联的 SVG 表现属性：html-to-image 不递归 decorate SVG 内部元素。 */
export const SVG_INLINE_PROPS = [
	"fill", "stroke", "stroke-width", "stroke-dasharray",
	"stroke-linecap", "stroke-linejoin", "fill-opacity", "stroke-opacity",
	"opacity", "color", "font-family", "font-size", "font-weight",
	"font-style", "font-variant-numeric", "text-anchor",
	"dominant-baseline", "letter-spacing", "paint-order",
] as const;

/**
 * 给离屏克隆里所有 SVG 后代逐项内联 computed 样式。
 * 必须在宿主已挂进 body 之后调用，才能拿到已解析主题变量的 computed 值。
 */
export function inlineSvgStyles(root: HTMLElement): void {
	const view = root.ownerDocument.defaultView;
	if (!view) return;
	// 必须带 <SVGElement> 泛型：否则 el 被推断为 Element、没有 .style，tsc 会报错。
	for (const el of Array.from(root.querySelectorAll<SVGElement>("svg *"))) {
		const cs = view.getComputedStyle(el);
		for (const prop of SVG_INLINE_PROPS) {
			const value = cs.getPropertyValue(prop);
			if (value) el.style.setProperty(prop, value);
		}
	}
}

// ——————————————————————————————————————————————————————————————
// DOM / IO 层
// ——————————————————————————————————————————————————————————————

export interface CaptureResult {
	canvas: HTMLCanvasElement;
	/** 视图中存在已知拍不到的内容（iframe / Canvas minimap），不阻断出图。 */
	partial: boolean;
	/** 因 canvas 硬上限被封顶了高度，不阻断出图。 */
	heightCapped: boolean;
	/** 实际使用的倍率（可能因 canvas 上限被下调）。 */
	scale: number;
}

/** 视图根类名（离屏宿主复刻它，才能拿到同一套祖先选择器与容器查询上下文）。 */
const VIEW_ROOT_SELECTOR = ".ioto-custom-dashboard-view";

/** 导出前从**克隆**上摘掉的残留交互态类（不碰实时 DOM）。 */
const TRANSIENT_CLASSES = [
	"is-selected",
	"is-dragging",
	"is-drop-target",
	"is-placeholder",
];

/**
 * 把当前页网格拍成**一张长图**（按内容全高一次出图，无滚动 / 拼接）。
 *
 * 关键实现口径：
 * 1. **拍离屏克隆，不拍实时 DOM**。`html-to-image` 会把每个节点的**计算样式**（含 `width` /
 *    `height` 的**已用像素值**）内联进克隆，所以克隆**不会**随根节点宽度重新排版 —— 直接把
 *    根节点宽度设成目标宽度只会得到「裁剪」而不是「重排」。因此这里把 `.ioto-dashboard-grid`
 *    深克隆进一个复刻了视图根类名的离屏宿主（`width` 设成目标宽度），让它在真实布局下按目标
 *    宽度重排，再拍克隆。`finally` 里 `host.remove()`，实时 DOM 零改动。
 * 2. 工具栏 / 页签 / 横幅 / 检查器是网格的兄弟，天然不入图；只拍「当前页面的具体内容」。
 * 3. `onImageErrorHandler` 让单张图片抓不下来时留空继续出图（尽力而为）。
 */
export async function captureDashboardPageCanvas(
	gridEl: HTMLElement,
	opts: { width: number; desiredScale: number; backgroundColor: string },
): Promise<CaptureResult> {
	const width = Math.max(1, Math.round(opts.width));
	const viewRoot =
		gridEl.closest<HTMLElement>(VIEW_ROOT_SELECTOR) ?? gridEl;
	const doc = gridEl.ownerDocument;
	const host = doc.createElement("div");
	// 复刻视图根类名 + 挂 `is-exporting`（让 styles.css 的导出瞬间规则作用在克隆上：禁用过渡
	// 与动画、抹掉光标）。新树不跑 transition，天然避开「过渡旧值入图」。
	host.className = `${viewRoot.className} is-exporting ioto-dashboard-export-host`;
	host.setAttribute(
		"style",
		// 中和视图根类自带的 padding/height/overflow：宿主宽度就是 grid 的实际宽度，
		// 再套 20px 左右内边距会让克隆重排成窄 40px 的图（容器查询断点也会跟着错）。
		`position:fixed;left:-20000px;top:0;width:${width}px;pointer-events:none;padding:0;height:auto;overflow:visible;box-sizing:border-box;`,
	);
	const clone = gridEl.cloneNode(true) as HTMLElement;
	for (const cls of TRANSIENT_CLASSES) {
		clone.querySelectorAll(`.${cls}`).forEach((el) => el.classList.remove(cls));
	}
	host.appendChild(clone);
	doc.body.appendChild(host);

	try {
		// 克隆已挂文档、宿主复刻了视图根类名：computed 值与屏幕一致，且实时 DOM 零改动。
		inlineSvgStyles(clone);
		const rawHeight = Math.max(1, Math.round(clone.scrollHeight));
		const scale = clampExportScale(
			computeCanvasScaleLimit(width, rawHeight, opts.desiredScale),
		);
		const maxHeightBySide = Math.floor(CANVAS_MAX_SIDE / scale);
		const maxHeightByArea = Math.floor(
			CANVAS_MAX_AREA / (width * scale * scale),
		);
		const height = Math.min(rawHeight, maxHeightBySide, maxHeightByArea);

		const source = await toCanvas(clone, {
			pixelRatio: scale,
			backgroundColor: opts.backgroundColor,
			width,
			height,
			style: {
				height: `${height}px`,
				overflow: "visible",
			},
			onImageErrorHandler: () => undefined,
		});

		return {
			canvas: withPadding(source, opts.backgroundColor, scale),
			partial: hasUncapturableContent(clone),
			heightCapped: height < rawHeight,
			scale,
		};
	} finally {
		host.remove();
	}
}

/** 四周加留白（二次合成，不拉伸内容；留白量按设备像素算）。 */
function withPadding(
	source: HTMLCanvasElement,
	backgroundColor: string,
	scale: number,
): HTMLCanvasElement {
	const pad = Math.round(EXPORT_PADDING * scale);
	// 用全局 `createEl` 而不是 `activeDocument.createEl`：后者会 appendChild 到 document 上并抛错。
	const canvas = createEl("canvas");
	canvas.width = source.width + pad * 2;
	canvas.height = source.height + pad * 2;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return source; // 拿不到 2d 上下文就退回原图，总比整张空白好
	}
	ctx.fillStyle = backgroundColor;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(source, pad, pad);
	return canvas;
}

/**
 * 解析 `#rgb` / `#rrggbb` / `rgb(r,g,b)` 为分量；解析不了返回 `null`。
 * `getComputedStyle` 已把 `color-mix()` 解析成 rgb，这里只需认导出路径上会出现的形式。
 */
export function parseCssColor(
	color: string | null | undefined,
): { r: number; g: number; b: number } | null {
	if (typeof color !== "string") {
		return null;
	}
	const value = color.trim().toLowerCase();
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
	const digits = hex?.[1];
	if (digits) {
		const expand =
			digits.length === 3
				? digits
						.split("")
						.map((d) => `${d}${d}`)
						.join("")
				: digits;
		return {
			r: Number.parseInt(expand.slice(0, 2), 16),
			g: Number.parseInt(expand.slice(2, 4), 16),
			b: Number.parseInt(expand.slice(4, 6), 16),
		};
	}
	const rgb = /rgba?\(\s*(\d+)\s*[,\s]\s*(\d+)\s*[,\s]\s*(\d+)/.exec(value);
	if (rgb) {
		return {
			r: Number.parseInt(rgb[1] as string, 10),
			g: Number.parseInt(rgb[2] as string, 10),
			b: Number.parseInt(rgb[3] as string, 10),
		};
	}
	return null;
}

/** 给一个背景色挑可读的文字色（深底给浅字、浅底给深字）。 */
export function readableTextColor(backgroundColor: string): string {
	const rgb = parseCssColor(backgroundColor);
	if (!rgb) {
		return "#1f1f1f";
	}
	const luminance =
		(0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
	return luminance > 0.55 ? "#1f1f1f" : "#f5f5f5";
}

/**
 * 页眉标题带：在内容图**上方**合成一条只放当前页标题的带子（18×scale 字号、上下各
 * 14×scale 留白），**不放日期行**。走 canvas 二次合成而不是往实时 DOM 注入节点，零 DOM
 * 改动、零闪烁。
 */
export function composePageHeader(
	source: HTMLCanvasElement,
	opts: {
		title: string;
		backgroundColor: string;
		textColor: string;
		scale: number;
	},
): HTMLCanvasElement {
	const scale = clampExportScale(opts.scale);
	const pad = Math.round(EXPORT_PADDING * scale);
	const titleSize = Math.round(18 * scale);
	const topPad = Math.round(14 * scale);
	const bottomPad = Math.round(14 * scale);
	const headerHeight = topPad + titleSize + bottomPad;

	const canvas = createEl("canvas");
	canvas.width = source.width;
	canvas.height = source.height + headerHeight;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return source; // 拿不到 2d 上下文就退回无页眉图
	}
	ctx.fillStyle = opts.backgroundColor;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.textBaseline = "alphabetic";
	const maxWidth = Math.max(1, canvas.width - pad * 2);
	ctx.fillStyle = opts.textColor;
	ctx.font = `600 ${titleSize}px sans-serif`;
	ctx.fillText(opts.title, pad, topPad + titleSize, maxWidth);
	ctx.drawImage(source, 0, headerHeight);
	return canvas;
}

/** `canvas.toBlob` 的 Promise 版；浏览器给不出 blob 时直接抛错，由调用方提示。 */
export function canvasToBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))),
			mime,
		);
	});
}

/** 恒写 PNG —— Chromium 的异步剪贴板写 `image/jpeg` 会被 `NotAllowedError` 拒。失败抛错，不静默。 */
export async function copyCanvasToClipboard(canvas: HTMLCanvasElement): Promise<void> {
	const mime = "image/png";
	const blob = await canvasToBlob(canvas, mime);
	await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]);
}

/**
 * 写进库内附件目录：路径由 `getAvailablePathForAttachment` 生成 —— 遵守用户的「附件默认位置」
 * 设置并自动去重。
 */
export async function saveCanvasToVault(
	app: App,
	canvas: HTMLCanvasElement,
	filename: string,
	opts: { sourcePath?: string },
): Promise<string> {
	const blob = await canvasToBlob(canvas, "image/png");
	const buffer = await blob.arrayBuffer();
	const path = await app.fileManager.getAvailablePathForAttachment(
		filename,
		opts.sourcePath,
	);
	await app.vault.createBinary(path, buffer);
	return path;
}

/** 桌面回退：`navigator.clipboard` 不可用时走 Electron 原生剪贴板；失败返回 false。 */
export async function copyCanvasViaElectron(canvas: HTMLCanvasElement): Promise<boolean> {
	try {
		const blob = await canvasToBlob(canvas, "image/png");
		const buffer = await blob.arrayBuffer();
		// 渲染进程 `require('electron')` 可用（nodeIntegration 开启）；移动端没有 `require`，
		// 故整段包在 try 里。`require` / `Buffer` 由 nodeIntegration 提供，不是浏览器全局。
		/* eslint-disable no-undef, @typescript-eslint/no-require-imports */
		const electron = require("electron") as {
			clipboard: { writeImage: (image: unknown) => void };
			nativeImage: { createFromBuffer: (data: Buffer) => unknown };
		};
		electron.clipboard.writeImage(
			electron.nativeImage.createFromBuffer(Buffer.from(buffer)),
		);
		/* eslint-enable no-undef, @typescript-eslint/no-require-imports */
		return true;
	} catch {
		return false;
	}
}
