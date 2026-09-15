"use client";

/**
 * A short tap of feedback when something happens.
 *
 * Two mechanisms, because no single one covers both phones.
 *
 * Android and desktop Chrome implement the Vibration API, so `navigator.vibrate`
 * is all that is needed there. iOS Safari has never implemented it and calling
 * it does nothing — which is worth saying plainly, because a feature that
 * silently does nothing on half the devices is worse than one that is known not
 * to work on them.
 *
 * For iOS there is a real mechanism: a `<label>` bound to a checkbox with the
 * `switch` attribute plays the system haptic when toggled, from iOS 17.4. That
 * is a side effect of a form control rather than an API, so the element is
 * created once, kept off-screen and out of the accessibility tree, and clicked
 * rather than rendered. On anything older it simply does nothing, same as
 * before.
 */

type Feel = "light" | "medium" | "heavy" | "success" | "warning" | "error";

/** Vibration patterns, in milliseconds. Short enough to read as a tap. */
const PATTERN: Record<Feel, number | number[]> = {
  light: 8,
  medium: 14,
  heavy: 22,
  success: [10, 45, 10],
  warning: [14, 60, 14],
  error: [22, 55, 22, 55, 22],
};

let iosSwitch: HTMLInputElement | null = null;

function iosHaptic() {
  if (typeof document === "undefined") return false;
  try {
    if (!iosSwitch) {
      const input = document.createElement("input");
      input.type = "checkbox";
      // The attribute is what produces the haptic; without it this is an
      // ordinary checkbox and nothing happens.
      input.setAttribute("switch", "");
      input.setAttribute("aria-hidden", "true");
      input.tabIndex = -1;
      input.style.cssText =
        "position:fixed;top:-100px;left:-100px;width:1px;height:1px;opacity:0;pointer-events:none";

      const label = document.createElement("label");
      label.setAttribute("aria-hidden", "true");
      label.style.cssText = input.style.cssText;
      const id = "capx-haptic-switch";
      input.id = id;
      label.htmlFor = id;

      document.body.append(input, label);
      iosSwitch = input;
      (iosSwitch as HTMLInputElement & { _label?: HTMLLabelElement })._label = label;
    }
    const label = (iosSwitch as HTMLInputElement & { _label?: HTMLLabelElement })._label;
    label?.click();
    return true;
  } catch {
    return false;
  }
}

/** Whether this device can produce any feedback at all. */
export function hapticsAvailable() {
  if (typeof navigator === "undefined") return false;
  return typeof navigator.vibrate === "function" || isIosSafari();
}

function isIosSafari() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS reports as Macintosh, so touch points are what separates it.
  const iOS = /iPad|iPhone|iPod/.test(ua)
    || (ua.includes("Macintosh") && (navigator.maxTouchPoints ?? 0) > 1);
  return iOS && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

/**
 * Plays one tap. Safe to call anywhere: a device that cannot do this does
 * nothing rather than throwing, and nothing here blocks the action that
 * triggered it.
 */
export function haptic(feel: Feel = "light") {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(PATTERN[feel]);
      return;
    }
    if (isIosSafari()) iosHaptic();
  } catch {
    /* feedback is a courtesy; never let it interrupt the thing it accompanies */
  }
}
