"use client";

import React from "react";

/**
 * Keeps a render fault inside the panel it happened in.
 *
 * A thrown error during render unmounts the whole tree, so one mistake in the
 * order ticket takes the page with it — the customer sees a browser error page
 * with no prices, no balance and nothing to act on. That is a bad outcome for a
 * bug anywhere, and a worse one here, where people arrive to check money.
 *
 * The rest of the page keeps working and the panel says what to do instead.
 */
export class PanelBoundary extends React.Component<
  { children: React.ReactNode; label?: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Left visible in the console: this is a bug to fix, not a condition to
    // handle quietly.
    console.error("[capx] panel failed to render", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="rounded-3xl border border-[var(--color-down)]/40 bg-[var(--color-down)]/[0.05] p-5">
        <div className="eyebrow text-[var(--color-down)]">{this.props.label ?? "Panel"}</div>
        <p className="mt-2 text-sm leading-relaxed">
          This part of the page could not load. Nothing was sent and your balance is unchanged.
        </p>
        <button
          onClick={() => this.setState({ failed: false })}
          className="mt-4 rounded-full border hairline px-4 py-2 text-[13px] font-medium transition-colors hover:surface"
        >
          Try again
        </button>
      </div>
    );
  }
}
