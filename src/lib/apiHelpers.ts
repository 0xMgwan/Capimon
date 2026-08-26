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

export function boom(e: unknown, fallback = "Request failed") {
  const message = e instanceof Error ? e.message : fallback;
  return NextResponse.json({ ok: false, code: "server_error", error: message }, { status: 500 });
}
