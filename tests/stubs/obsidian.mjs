// obsidian 依赖只提供 .d.ts，没有运行时代码。
// 这里给出单测所需的最小可实例化实现：只求「能被继承 / import」，方法体留空，
// 不模拟 Obsidian 行为；DOM / 渲染留给真机（Obsidian CLI）验证。
// 本文件必须放在插件目录内：重导出的真实 moment 依赖此处的 node_modules/moment 解析基准。

import moment from 'moment';

// Obsidian 运行环境始终存在 window / activeDocument 全局；补最小兜底，
// 让源码里按 lint 规则写的 window.setTimeout 等在 Node 测试里也能运行。
if (typeof globalThis.window === 'undefined') {
	globalThis.window = globalThis;
}
if (typeof globalThis.activeDocument === 'undefined') {
	globalThis.activeDocument = globalThis.document ?? { documentElement: {} };
}

// 真实 Obsidian 运行时通过 API 导出 moment（`import { moment } from 'obsidian'`）。
// 单测里转发到 npm 版 moment，使语言包等行为与真机一致；不放假实现。
export { moment };
export default moment;

// ---- 空壳类（只求「能被继承 / import」，方法体留空）----
export class App {}
export class ItemView {}
export class Component {}
export class Modal {}
export class FuzzySuggestModal {}
export class SuggestModal {}
export class PluginSettingTab {}
export class Plugin {}
export class Setting {}
export class TFile {}
export class TFolder {}
export class TAbstractFile {}
export class WorkspaceLeaf {}
export class MarkdownView {}
export class Menu {}
export class Notice {}
export class DropdownComponent {}
export class TextComponent {}
export class ButtonComponent {}
export class ExtraButtonComponent {}
export class ToggleComponent {}

// ---- 其余具名导出 ----
export const MarkdownRenderer = {
	render: async () => {},
	renderMarkdown: async () => {},
};

export const Platform = {
	isMobile: false,
	isDesktop: true,
	isPhone: false,
	isTablet: false,
};

export const setIcon = () => {};

export const setTooltip = () => {};

export const debounce = (fn) => fn;

export const normalizePath = (path) => path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
