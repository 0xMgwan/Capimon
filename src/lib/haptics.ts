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
 * For iOS there is a real mechanism from iOS 18: a `<label>` wrapping a
 * checkbox with the `switch` attribute plays the system haptic when toggled. That is a
 * side effect of a form control rather than an API, so the element is created
 * once, kept off-screen and out of the accessibility tree, and clicked rather
 * than rendered.
 *
 * Below iOS 18 there is no web API that reaches the Taptic Engine. Not a
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

/**
 * The iOS system haptic, via a switch control.
 *
 * Toggling an `<input type="checkbox" switch>` plays the Taptic Engine on
 * iOS 18 and later — but only when it happens inside a genuine tap's `click`
 * event, which is why the global listener fires on click for iOS. The earlier
 * version ran on pointerdown, which Safari does not treat as a user gesture,
 * so it toggled the switch silently.
 *
 * A fresh label-wrapped switch is made, clicked and removed each time. Keeping
 * one around looked tidier but is not the pattern Safari responds to reliably.
 */
let inHaptic = false;

function iosHaptic() {
  if (typeof document === "undefined" || inHaptic) return false;
  inHaptic = true;
  try {
    const label = document.createElement("label");
    label.ariaHidden = "true";
    label.style.display = "none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    label.appendChild(input);
    document.head.appendChild(label);
    label.click();
    document.head.removeChild(label);
    return true;
  } catch {
    return false;
  } finally {
    inHaptic = false;
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
      // iOS 18 and up feel this. Older devices get the audio click only if
      // the person asked for it.
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
  // The switch control gained its haptic in iOS 18. Below it, nothing.
  const m = /OS (\d+)_(\d+)/.exec(navigator.userAgent);
  if (!m) return true;
  return Number(m[1]) < 18;
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
