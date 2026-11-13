export interface PointerDragArmOptions {
	/** Pointer travel before the drag becomes active. */
	threshold?: number;
	/** Touch: long-press delay instead of a travel threshold. */
	longPressDelay?: number;
	onActivate(startEvent: PointerEvent): void;
}

/**
 * Waits for a pointer gesture to become a drag: desktop needs `threshold` px,
 * touch needs a long-press and cancels once the finger clearly scrolls.
 */
export function armPointerDrag(
	handle: HTMLElement,
	event: PointerEvent,
	options: PointerDragArmOptions,
): void {
	if (event.button !== 0) return;
	const doc = handle.ownerDocument;
	const win = doc.defaultView ?? window;
	const threshold = options.threshold ?? 6;
	const longPressDelay = options.longPressDelay ?? 350;
	const touch = event.pointerType === "touch";
	const startX = event.clientX;
	const startY = event.clientY;
	let armed = true;
	let timer: number | null = null;

	const cleanup = (): void => {
		armed = false;
		if (timer !== null) win.clearTimeout(timer);
		timer = null;
		doc.removeEventListener("pointermove", onMove);
		doc.removeEventListener("pointerup", onUp);
		doc.removeEventListener("pointercancel", onUp);
	};

	const activate = (): void => {
		if (!armed) return;
		cleanup();
		options.onActivate(event);
	};

	const onMove = (moveEvent: PointerEvent): void => {
		if (moveEvent.pointerId !== event.pointerId) return;
		const distance = Math.hypot(
			moveEvent.clientX - startX,
			moveEvent.clientY - startY,
		);
		if (touch) {
			// Any scroll intent cancels the long-press before it activates.
			if (distance > 8) cleanup();
			return;
		}
		if (distance > threshold) activate();
	};

	const onUp = (upEvent: PointerEvent): void => {
		if (upEvent.pointerId === event.pointerId) cleanup();
	};

	doc.addEventListener("pointermove", onMove);
	doc.addEventListener("pointerup", onUp);
	doc.addEventListener("pointercancel", onUp);

	if (touch) {
		timer = win.setTimeout(activate, longPressDelay);
	}
}

/**
 * Tracks an active pointer session until pointerup, pointercancel or Escape.
 * `onFinish(true)` means the gesture was cancelled and nothing should commit.
 */
export function bindPointerSession(
	handle: HTMLElement,
	pointerId: number,
	handlers: {
		onMove(event: PointerEvent): void;
		onFinish(cancelled: boolean): void;
	},
): void {
	const doc = handle.ownerDocument;
	const cleanup = (): void => {
		doc.removeEventListener("pointermove", onMove);
		doc.removeEventListener("pointerup", onUp);
		doc.removeEventListener("pointercancel", onCancel);
		doc.removeEventListener("keydown", onKey);
		try {
			handle.releasePointerCapture(pointerId);
		} catch {
			// Already released by the browser.
		}
	};
	const onMove = (event: PointerEvent): void => {
		if (event.pointerId === pointerId) handlers.onMove(event);
	};
	const onUp = (event: PointerEvent): void => {
		if (event.pointerId !== pointerId) return;
		cleanup();
		handlers.onFinish(false);
	};
	const onCancel = (event: PointerEvent): void => {
		if (event.pointerId !== pointerId) return;
		cleanup();
		handlers.onFinish(true);
	};
	const onKey = (event: KeyboardEvent): void => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		cleanup();
		handlers.onFinish(true);
	};
	doc.addEventListener("pointermove", onMove);
	doc.addEventListener("pointerup", onUp);
	doc.addEventListener("pointercancel", onCancel);
	doc.addEventListener("keydown", onKey);
}
