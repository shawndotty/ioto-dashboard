import { Platform } from "obsidian";

/**
 * macOS 系统红黄绿窗口按钮的隐藏 / 恢复。
 * 调用点：弹窗进入全屏（ui/modal-shell.ts）、插件卸载兜底（main.ts onunload）。
 */

interface BrowserWindowLike {
	setWindowButtonVisibility?: (visible: boolean) => void;
}

interface ElectronLike {
	remote: { getCurrentWindow: () => BrowserWindowLike };
}

/** 每个 renderer 进程一份 = 每个窗口一份；幂等位。 */
let hidden = false;

function getElectron(): ElectronLike | null {
	try {
		/* eslint-disable no-undef, @typescript-eslint/no-require-imports */
		return require("electron") as ElectronLike;
		/* eslint-enable no-undef, @typescript-eslint/no-require-imports */
	} catch {
		return null;
	}
}

/** 返回是否真的藏上了；调用方据此决定挂不挂 is-frame-buttons-hidden。 */
export function hideMacWindowButtons(): boolean {
	if (!Platform.isMacOS) {
		return false;
	}
	if (hidden) {
		return true;
	}
	try {
		const win = getElectron()?.remote.getCurrentWindow();
		if (typeof win?.setWindowButtonVisibility !== "function") {
			return false;
		}
		win.setWindowButtonVisibility(false);
		hidden = true;
		return true;
	} catch {
		return false;
	}
}

/** 幂等，多调无害；未藏过时是 no-op。 */
export function restoreMacWindowButtons(): void {
	if (!hidden) {
		return;
	}
	try {
		getElectron()?.remote.getCurrentWindow().setWindowButtonVisibility?.(true);
	} catch {
		/* 窗口已销毁等异常：没有可补救的东西 */
	}
	hidden = false;
}
