const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

const NAMED: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "Insert",
};

function keyName(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  return NAMED[code];
}

/** Tauri accelerator for a key press, or undefined while only modifiers are held or no modifier is used. */
export function acceleratorFromEvent(
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
) {
  if (MODIFIER_CODES.has(event.code)) return undefined;
  const key = keyName(event.code);
  const modifiers = [
    event.ctrlKey || event.metaKey ? "CommandOrControl" : undefined,
    event.altKey ? "Alt" : undefined,
    event.shiftKey ? "Shift" : undefined,
  ].filter((m): m is string => m !== undefined);
  // A bare key as a global shortcut would swallow normal typing everywhere.
  if (!key || modifiers.length === 0 || (modifiers.length === 1 && modifiers[0] === "Shift")) return undefined;
  return [...modifiers, key].join("+");
}

/** Keys to show for an accelerator, the way Windows writes them. */
export const acceleratorKeys = (accelerator: string) =>
  accelerator
    .split("+")
    .filter(Boolean)
    .map((part) => (part === "CommandOrControl" || part === "CmdOrCtrl" || part === "Control" ? "Ctrl" : part));

/** Opens the command palette; Ctrl+P is free because the webview blocks printing anyway. */
export const PALETTE_SHORTCUT_SETTING = "paletteShortcut";
export const DEFAULT_PALETTE_SHORTCUT = "CommandOrControl+P";

/** True when a key press is exactly this accelerator. */
export const matchesAccelerator = (
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  accelerator: string,
) =>
  Boolean(accelerator) && acceleratorFromEvent(event) === accelerator.replace(/^CmdOrCtrl(?=\+)/, "CommandOrControl");
