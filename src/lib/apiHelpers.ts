import "server-only";
import { NextResponse } from "next/server";
import { dbConfigured } from "./db";

export function notConfigured(what: string) {
  return NextResponse.json(
    { ok: false, code: "not_configured", error: `${what} is not configured on this deployment` },
    { status: 503 },
  );
}

export function requireDb() {
  return dbConfigured ? null : notConfigured("Custodial accounts");
}

export function bad(error: string, code = "bad_request", status = 400) {
  return NextResponse.json({ ok: false, code, error }, { status });
}

/**
 * Unexpected failures.
 *
 * The detail goes to the server log with a reference; the caller gets the
 * reference and nothing else. A database error rendered in a signup form tells
 * a stranger the shape of your schema, and tells the person trying to sign up
 * nothing they can act on.
 */
export function boom(e: unknown, fallback = "Something went wrong on our side.") {
  const ref = Math.random().toString(36).slice(2, 10);
  console.error(`[capx:${ref}]`, e);
  return NextResponse.json(
    { ok: false, code: "server_error", error: `${fallback} Reference ${ref}.`, ref },
    { status: 500 },
  );
}
