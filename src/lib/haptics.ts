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
 * For iOS there is a real mechanism from 17.4: a `<label>` bound to a checkbox
 * with the `switch` attribute plays the system haptic when toggled. That is a
 * side effect of a form control rather than an API, so the element is created
 * once, kept off-screen and out of the accessibility tree, and clicked rather
 * than rendered.
 *
 * Below 17.4 there is no web API that reaches the Taptic Engine. Not a
 * restricted one, not a permissioned one — none. What can be offered instead is
 * a very short, very quiet click through Web Audio, which is sound rather than
 * touch. It is off unless someone turns it on, because a finance app that
 * starts making noises nobody asked for is worse than one that is silently
 * missing a nicety, and it is labelled as sound rather than dressed up as
 * haptics.
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
    if (isIosSafari()) {
      // 17.4 and up feel this. Older devices get the audio click only if the
      // person asked for it.
      const played = iosHaptic();
      if (!played || (needsTapSound() && tapSoundEnabled())) tick();
    }
  } catch {
    /* feedback is a courtesy; never let it interrupt the thing it accompanies */
  }
}


/* ------------------------------------------------------------- fallback -- */

const SOUND_KEY = "capx-tap-sound";

/** Whether the audio fallback is switched on. Off unless chosen. */
export function tapSoundEnabled() {
  if (typeof localStorage === "undefined") return false;
  try { return localStorage.getItem(SOUND_KEY) === "on"; } catch { return false; }
}

export function setTapSound(on: boolean) {
  try { localStorage.setItem(SOUND_KEY, on ? "on" : "off"); } catch { /* session only */ }
}

/**
 * Whether this device has no real haptic and would benefit from the fallback.
 *
 * Used to decide whether the setting is worth showing at all: offering a
 * workaround to someone whose phone already vibrates is just another switch to
 * read past.
 */
export function needsTapSound() {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.vibrate === "function") return false;
  if (!isIosSafari()) return false;
  // 17.4 brought the switch control's haptic. Below it, nothing.
  const m = /OS (\d+)_(\d+)/.exec(navigator.userAgent);
  if (!m) return true;
  const major = Number(m[1]), minor = Number(m[2]);
  return major < 17 || (major === 17 && minor < 4);
}

let audio: AudioContext | null = null;

function tick() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === "suspended") void audio.resume();

    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    // Short and low, so it reads as a click rather than a beep.
    osc.frequency.value = 170;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  } catch {
    /* a courtesy, never a failure */
  }
}
