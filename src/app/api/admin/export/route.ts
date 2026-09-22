import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { roleOf } from "@/lib/adminAuth";
import { buildTable, toCsv, DATASETS, type Dataset } from "@/lib/exportData";

export const dynamic = "force-dynamic";
// A full ledger replay with cost basis can take a while on a large book.
export const maxDuration = 60;

/**
 * One dataset as a CSV download, for CAPX and FIMCO alike.
 *
 * `from` and `to` are calendar dates (YYYY-MM-DD), inclusive, and apply to the
 * event tables — trades, cash, ledger, filings, issuance. Customers and
 * holdings are always as of now, with lifetime figures, because a position
 * does not have a date range.
 */
export async function GET(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  const role = roleOf(req);
  if (!role) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });

  const url = new URL(req.url);
  const dataset = url.searchParams.get("dataset") as Dataset;
  if (!(dataset in DATASETS)) {
    return NextResponse.json({ ok: false, error: `dataset must be one of: ${Object.keys(DATASETS).join(", ")}` }, { status: 400 });
  }
  const day = (v: string | null, end: boolean) => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const d = new Date(`${v}T00:00:00Z`);
    if (end) d.setUTCDate(d.getUTCDate() + 1); // inclusive of the whole last day
    return d;
  };
  const from = day(url.searchParams.get("from"), false);
  const to = day(url.searchParams.get("to"), true);

  try {
    const table = await buildTable(dataset, { from, to });
    const stamp = new Date().toISOString().slice(0, 10);
    const span = from || to ? `_${url.searchParams.get("from") ?? "start"}_to_${url.searchParams.get("to") ?? stamp}` : "";
    return new NextResponse(toCsv(table), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="capx_${dataset}${span}_${stamp}.csv"`,
        "cache-control": "private, no-store",
        "x-row-count": String(table.rows.length),
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "export failed" }, { status: 500 });
  }
}
