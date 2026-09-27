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
export function haptic(feel: Feel = "light", opts: {
  /**
   * True when this comes from a drag rather than a tap.
   *
   * It decides which mechanism is even possible. The iOS switch haptic plays
   * only inside a trusted `click`, and a drag produces none — but the call
   * still *succeeds*, because clicking the hidden switch throws nothing
   * whether or not the Taptic Engine answers. So a gesture asking for a
   * haptic on iOS got silence and a return value saying it had worked, which
   * is why pull-to-refresh felt like nothing for several attempts.
   *
   * Told that it is a gesture, iOS skips the switch it cannot use and goes
   * straight to the sound, which is the only answer available there.
   */
  gesture?: boolean;
} = {}) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(PATTERN[feel]);
      return;
    }
    if (isIosSafari() && opts.gesture) {
      if (tapSoundEnabled()) tick(feel);
      return;
    }
    if (isIosSafari()) {
      /*
       * iOS 18 and up feel the switch. Everything below it, and every
       * gesture the switch cannot reach, gets the click instead.
       *
       * A drag is the case that forced this. The switch haptic plays only
       * inside a trusted `click`, and a pull-to-refresh produces none — so
       * on an iPhone the gesture had no feedback at all and no way to get
       * any. The tick is sound rather than touch and is a poorer thing, but
       * it is a real answer where there was none.
       */
      const played = iosHaptic();
      if ((!played || needsTapSound()) && tapSoundEnabled()) tick(feel);
    }
  } catch {
    /* feedback is a courtesy; never let it interrupt the thing it accompanies */
  }
}


/* ------------------------------------------------------------- fallback -- */

const SOUND_KEY = "capx-tap-sound";

/** Whether the audio fallback is switched on. Off unless chosen. */
/**
 * Whether the audio tick plays.
 *
 * On by default, but only where it is the only feedback available: a phone
 * that can vibrate already answers, and adding a sound to a device that has
 * a Taptic Engine would be noise on top of a nicety. On an iPhone below iOS
 * 18, or anywhere else with neither the Vibration API nor the switch haptic,
 * this is the difference between a control that responds and one that seems
 * broken.
 *
 * "Off" is remembered; nothing else is. Somebody who turns it off has said
 * so, and the absence of an answer is not consent in either direction — so a
 * device that needs it gets it, and one tap of a setting stops it forever.
 */
export function tapSoundEnabled() {
  if (typeof localStorage === "undefined") return false;
  try {
    const stored = localStorage.getItem(SOUND_KEY);
    if (stored === "off") return false;
    if (stored === "on") return true;
    /*
     * Any iPhone, not only the ones with no haptic at all.
     *
     * iOS 18 can feel a button, through the switch control, and cannot feel a
     * drag — the switch plays only inside a trusted click and a pull produces
     * none. So "does this device need the sound" has two answers depending on
     * what is being answered, and for gestures the answer on every iPhone is
     * yes. `needsTapSound` still means what it always did, and still governs
     * the button fallback, so a phone that can feel a tap does not also hear
     * one.
     */
    return isIosSafari();
  } catch { return false; }
}

/**
 * Whether the tap-sound setting is worth showing this person.
 *
 * Any iPhone: either it has no haptic at all, or it has one that cannot
 * answer a gesture. Everything else vibrates properly and does not need the
 * switch explained to it.
 */
export function tapSoundRelevant() {
  return isIosSafari();
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

/**
 * The pitch and weight of each click.
 *
 * The first version of this ran at 170Hz, which is a reasonable frequency for
 * something you feel and a poor one for something a phone plays. A handset
 * speaker is a few millimetres across and rolls off steeply below roughly
 * 500Hz — so the click was being reproduced at a fraction of its intended
 * level no matter what the gain said, which is why it was barely audible
 * rather than merely quiet. Raising the volume alone would have pushed a
 * frequency the speaker cannot move.
 *
 * These sit where a small speaker is efficient and the ear is most sensitive,
 * kept under 40ms so they read as a click rather than a tone. The three
 * weights differ in pitch rather than length, so "armed" and "done" are
 * distinguishable without either becoming a noise.
 */
const CLICK: Record<Feel, { hz: number; peak: number; ms: number }> = {
  light:   { hz: 780,  peak: 0.16, ms: 26 },
  medium:  { hz: 920,  peak: 0.24, ms: 30 },
  heavy:   { hz: 1040, peak: 0.30, ms: 34 },
  success: { hz: 1180, peak: 0.24, ms: 30 },
  warning: { hz: 640,  peak: 0.26, ms: 34 },
  error:   { hz: 420,  peak: 0.30, ms: 42 },
};

function tick(feel: Feel = "light") {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    // Safari suspends the context between gestures; a click that arrives
    // while it is asleep is silent no matter how loud it was asked to be.
    if (audio.state === "suspended") void audio.resume();

    const { hz, peak, ms } = CLICK[feel];
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();

    /*
     * Triangle rather than sine: it carries odd harmonics above the
     * fundamental, which a small speaker reproduces far better than the
     * fundamental itself. The click keeps its pitch and gains the edge that
     * makes it audible over a room.
     */
    osc.type = "triangle";
    osc.frequency.setValueAtTime(hz, now);
    // A short downward slide, which is what makes a click sound struck
    // rather than switched on.
    osc.frequency.exponentialRampToValueAtTime(hz * 0.72, now + ms / 1000);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);

    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + ms / 1000 + 0.01);
  } catch {
    /* a courtesy, never a failure */
  }
}
