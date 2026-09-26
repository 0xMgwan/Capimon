"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { ProfileCard } from "./ProfileCard";
import { pollWhileVisible } from "@/lib/usePoll";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { useT } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";

/**
 * What customers say to each other about a security.
 *
 * Folded shut by default and placed below the ticket, because somebody who
 * came to buy should reach the buy button before they reach an argument about
 * whether to. The count in the header is the invitation; opening it is a
 * decision.
 *
 * Handles written with @ become taps that open the author's card — which
 * shows their trading only if they have published it. Nothing here reveals a
 * position by itself.
 */
type Comment = {
  id: string;
  body: string;
  mentions: string[];
  createdAt: string;
  author: { username: string | null; name: string | null; avatar: string | null };
  mine?: boolean;
  parentId?: string | null;
  replies?: Comment[];
};

const MAX = 500;

const ago = (iso: string, t: (s: string) => string) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return t("just now");
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
};

export function Comments({ symbol }: { symbol: string }) {
  const { t } = useT();
  const { account } = useCapimonAccount();
  const [open, setOpen] = useState(false);
  /*
   * Arriving from a mention opens the thread.
   *
   * The push for "@you were mentioned" lands on /markets/x#comments, and a
   * folded section at that anchor is a notification that shows you a closed
   * door. Read in an effect rather than during render so the server and the
   * first client paint agree, and deferred for the usual reason.
   */
  useEffect(() => {
    if (window.location.hash !== "#comments") return;
    const id = window.setTimeout(() => setOpen(true), 0);
    return () => window.clearTimeout(id);
  }, []);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  /** The comment being answered, or null when writing a new one. */
  const [replyTo, setReplyTo] = useState<Comment | null>(null);

  /* The @ autocomplete. */
  const [handles, setHandles] = useState<{ username: string; name: string | null; avatar: string | null }[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  /*
   * Loaded once, then kept current while somebody is actually reading it.
   *
   * Three conditions, and each one is there to keep this cheap. It polls only
   * while the thread is open — a folded section is a count nobody is watching
   * change. It polls only while the tab is visible, so a phone in a pocket
   * asks for nothing. And twenty-five seconds is slow enough that a page left
   * open all afternoon is a couple of hundred requests, not a couple of
   * thousand.
   *
   * The reply replaces the list only when it differs, so a poll that finds
   * nothing new does not re-render the thread under someone mid-sentence.
   */
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch(`/api/comments?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (!alive) return;
          const next: Comment[] = j.ok ? j.comments : [];
          setComments((prev) => {
            if (prev && prev.length === next.length
                && prev.every((c, i) => c.id === next[i]?.id)) return prev;
            return next;
          });
        })
        .catch(() => { if (alive) setComments((prev) => prev ?? []); });
    };
    load();
    if (!open) return () => { alive = false; };
    const stop = pollWhileVisible(load, 25_000);
    return () => { alive = false; stop(); };
  }, [symbol, open]);

  /*
   * The word being typed after an @, if there is one.
   *
   * Read from the caret rather than the whole field, so mentioning somebody
   * in the middle of a sentence works the way it does everywhere else.
   */
  useEffect(() => {
    let alive = true;
    if (!token) {
      // Cleared in a task rather than in the effect body: a synchronous
      // setState here cascades a second render before the first has painted.
      const id = window.setTimeout(() => { if (alive) setHandles([]); }, 0);
      return () => { alive = false; window.clearTimeout(id); };
    }
    fetch(`/api/handles?q=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (alive) setHandles(j.ok ? j.handles : []); })
      .catch(() => { if (alive) setHandles([]); });
    return () => { alive = false; };
  }, [token]);

  const onType = (value: string, caret: number) => {
    setBody(value.slice(0, MAX));
    const before = value.slice(0, caret);
    const m = before.match(/@([a-z0-9._-]{0,20})$/i);
    setToken(m ? m[1] : null);
  };

  const pick = (handle: string) => {
    const el = boxRef.current;
    const caret = el?.selectionStart ?? body.length;
    const before = body.slice(0, caret).replace(/@([a-z0-9._-]{0,20})$/i, `@${handle} `);
    const next = before + body.slice(caret);
    setBody(next.slice(0, MAX));
    setToken(null);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(before.length, before.length); });
  };

  const post = async () => {
    setBusy(true); setErr(null);
    const parent = replyTo;
    try {
      const r = await fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol, body, parentId: parent?.id ?? null }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? t("Could not post your comment"));
      /*
       * Placed where it will be after the next load, rather than at the top.
       * A reply that appears above the thread it answers and then jumps into
       * place on the next poll reads as a bug.
       */
      setComments((c) => {
        const list = c ?? [];
        if (!parent) return [j.comment, ...list];
        const anchor = parent.parentId ?? parent.id;
        return list.map((x) =>
          x.id === anchor ? { ...x, replies: [...(x.replies ?? []), j.comment] } : x);
      });
      setBody("");
      setReplyTo(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("Could not post your comment"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setComments((c) => (c ?? [])
      .filter((x) => x.id !== id)
      .map((x) => ({ ...x, replies: (x.replies ?? []).filter((r) => r.id !== id) })));
    await fetch("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    }).catch(() => { /* it is gone from the page either way */ });
  };

  // Replies count: somebody deciding whether to open the thread is asking how
  // much is in it, not how many of it are top-level.
  const count = (comments ?? []).reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0);

  return (
    <section id="comments" className="mt-3 scroll-mt-24 rounded-3xl border hairline p-4 sm:p-5">
      <button
        onClick={() => { haptic(); setOpen((v) => !v); }}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span>
          <span className="eyebrow block">{t("Discussion")}</span>
          <span className="mt-0.5 block text-[12px] text-[var(--muted)]">
            {count === 0
              ? t("Nothing said about this one yet.")
              : `${count} ${count === 1 ? t("comment") : t("comments")}`}
          </span>
        </span>
        <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <>
          {account ? (
            <div className="relative mt-3">
              {/* What this will answer, and a way out of answering it. */}
              {replyTo && (
                <div className="mb-1.5 flex items-center gap-2 rounded-full surface px-3 py-1.5 text-[11.5px]">
                  <span className="min-w-0 flex-1 truncate text-[var(--muted)]">
                    {t("Replying to")}{" "}
                    <span className="text-[var(--fg)]">
                      {replyTo.author.username ? `@${replyTo.author.username}` : t("A customer")}
                    </span>
                  </span>
                  <button
                    onClick={() => { setReplyTo(null); setBody(""); }}
                    className="shrink-0 text-[var(--muted)] hover:text-[var(--fg)]"
                    aria-label={t("Cancel")}
                  >
                    ✕
                  </button>
                </div>
              )}
              <textarea
                ref={boxRef}
                value={body}
                onChange={(e) => onType(e.target.value, e.target.selectionStart ?? 0)}
                placeholder={replyTo ? t("Write your reply…") : t("Say something. Use @ to mention someone.")}
                rows={2}
                className="w-full resize-none rounded-2xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
              />
              {handles.length > 0 && (
                <div className="absolute left-0 right-0 z-20 overflow-hidden rounded-xl border hairline bg-[var(--bg)] shadow-lg">
                  {handles.map((h) => (
                    <button key={h.username} onClick={() => pick(h.username)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:surface">
                      <Avatar src={h.avatar} name={h.name} email={h.username} size={22} />
                      <span className="text-[13px] font-medium">@{h.username}</span>
                      {h.name && <span className="truncate text-[11px] text-[var(--muted)]">{h.name}</span>}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="tnum text-[11px] text-[var(--muted)]">{body.length}/{MAX}</span>
                <button
                  onClick={() => { haptic(); void post(); }}
                  disabled={busy || body.trim().length < 2}
                  className="rounded-full bg-[var(--fg)] px-4 py-2 text-[13px] font-medium text-[var(--bg)] disabled:opacity-40"
                >
                  {busy ? t("Posting…") : t("Post")}
                </button>
              </div>
              {err && <p className="mt-1 text-[12px] text-[var(--color-down)]">{err}</p>}
            </div>
          ) : (
            <p className="mt-3 rounded-2xl surface px-3.5 py-3 text-[12px] text-[var(--muted)]">
              {t("Sign in to join the conversation.")}
            </p>
          )}

          <div className="mt-4 grid gap-3.5">
            {(comments ?? []).map((c) => (
              <div key={c.id}>
                <One
                  c={c}
                  canReply={!!account}
                  onView={setViewing}
                  onReply={(target) => {
                    setReplyTo(target);
                    // Prefilled, because a reply to somebody is nearly always
                    // addressed to them — and it can be deleted if it is not.
                    setBody(target.author.username ? `@${target.author.username} ` : "");
                    requestAnimationFrame(() => boxRef.current?.focus());
                  }}
                  onRemove={remove}
                  t={t}
                />
                {(c.replies?.length ?? 0) > 0 && (
                  /*
                    Indented once and no further. The rule is a thread line,
                    not decoration: it is what says these belong to the
                    comment above rather than to the list.
                  */
                  <div className="mt-3 grid gap-3 border-l hairline pl-3 ml-[14px]">
                    {c.replies!.map((r) => (
                      <One
                        key={r.id}
                        c={r}
                        small
                        canReply={!!account}
                        onView={setViewing}
                        onReply={(target) => {
                          setReplyTo(target);
                          setBody(target.author.username ? `@${target.author.username} ` : "");
                          requestAnimationFrame(() => boxRef.current?.focus());
                        }}
                        onRemove={remove}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {viewing && <ProfileCard username={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}

/**
 * One comment, at either level.
 *
 * A reply is the same object drawn slightly smaller — same author, same
 * handles, same removal. Making it a separate component would have meant two
 * places to change when any of that does.
 */
function One({ c, small, canReply, onView, onReply, onRemove, t }: {
  c: Comment;
  small?: boolean;
  canReply: boolean;
  onView: (handle: string) => void;
  onReply: (c: Comment) => void;
  onRemove: (id: string) => void;
  t: (s: string) => string;
}) {
  return (
    <div className="flex gap-2.5">
      <Avatar src={c.author.avatar} name={c.author.name} email={c.author.username ?? ""} size={small ? 24 : 28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <button
            onClick={() => c.author.username && onView(c.author.username)}
            disabled={!c.author.username}
            className={`font-medium hover:underline disabled:no-underline ${small ? "text-[12.5px]" : "text-[13px]"}`}
          >
            {c.author.username ? `@${c.author.username}` : c.author.name ?? t("A customer")}
          </button>
          <span className="text-[11px] text-[var(--muted)]">{ago(c.createdAt, t)}</span>
          {c.mine && (
            <button onClick={() => void onRemove(c.id)}
              className="ml-auto text-[11px] text-[var(--muted)] hover:text-[var(--color-down)]">
              {t("Remove")}
            </button>
          )}
        </div>
        <p className={`mt-0.5 whitespace-pre-line break-words leading-snug ${small ? "text-[13px]" : "text-[13.5px]"}`}>
          {/* Handles become taps; everything else is plain text, which is
              also what stops a comment from carrying markup. */}
          {c.body.split(/(@[a-z0-9._-]{3,20})/gi).map((part, i) =>
            part.startsWith("@") ? (
              <button key={i} onClick={() => onView(part.slice(1))}
                className="text-[var(--color-accent)] hover:underline">{part}</button>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
        </p>
        {canReply && (
          <button
            onClick={() => onReply(c)}
            className="mt-1 text-[11px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
          >
            {t("Reply")}
          </button>
        )}
      </div>
    </div>
  );
}
