import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Where a desk token may be presented.
 *
 * A token in a query string lands in browser history, in a download
 * manager's list, in any referrer the page sends and in every access log
 * between the browser and here — and on the document routes that same URL
 * points at somebody's identity papers. Every caller now sends a bearer
 * header; the two image routes cannot, because an `<img src>` carries none.
 *
 * So this pins the narrow exception rather than trusting it to stay narrow.
 * A route added later that reads a token from its URL is the regression this
 * catches.
 */

const ADMIN = "admin-token-for-tests";
process.env.ADMIN_TOKEN = ADMIN;
process.env.FIMCO_TOKEN = "fimco-token-for-tests";

/* Imported lazily, not at the top: the module reads the tokens from the
   environment when it loads, and a static import is hoisted above the lines
   that set them. The env above is in place before any test body runs. */
type Auth = typeof import("../src/lib/adminAuth");
let mod: Auth | null = null;
const auth = async (): Promise<Auth> => (mod ??= await import("../src/lib/adminAuth"));

const withHeader = (path: string, token: string) =>
  new Request(`https://capx.broker${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });

const withQuery = (path: string, token: string) =>
  new Request(`https://capx.broker${path}?token=${encodeURIComponent(token)}`);

test("a bearer header authenticates any route", async () => {
  const { roleOf } = await auth();
  assert.equal(roleOf(withHeader("/api/admin/custody", ADMIN)), "admin");
  assert.equal(roleOf(withHeader("/api/admin/partners", ADMIN)), "admin");
  assert.equal(roleOf(withHeader("/api/admin/kyc/image", ADMIN)), "admin");
});

test("a token in the query string is ignored on an ordinary route", async () => {
  const { roleOf } = await auth();
  /* The token is correct. It is refused because of where it was put. */
  assert.equal(roleOf(withQuery("/api/admin/custody", ADMIN)), null);
  assert.equal(roleOf(withQuery("/api/admin/partners", ADMIN)), null);
  assert.equal(roleOf(withQuery("/api/admin/holders", ADMIN)), null);
});

test("the image routes still accept it, because an img tag sends no header", async () => {
  const { roleOf } = await auth();
  assert.equal(roleOf(withQuery("/api/admin/kyc/image", ADMIN)), "admin");
  assert.equal(roleOf(withQuery("/api/dse/document", ADMIN)), "admin");
});

test("the exception is matched on the path, not on a substring anywhere", async () => {
  const { roleOf } = await auth();
  /* A route that merely mentions an allowed path in its query must not
     inherit the exception — otherwise ?next=/api/admin/kyc/image would
     reopen every endpoint to tokens in URLs. */
  assert.equal(
    roleOf(new Request(
      `https://capx.broker/api/admin/custody?next=/api/admin/kyc/image&token=${ADMIN}`)),
    null,
  );
});

test("a wrong token is refused wherever it is presented", async () => {
  const { roleOf } = await auth();
  assert.equal(roleOf(withHeader("/api/admin/custody", "nope")), null);
  assert.equal(roleOf(withQuery("/api/admin/kyc/image", "nope")), null);
});

test("no token at all is nobody", async () => {
  const { roleOf } = await auth();
  assert.equal(roleOf(new Request("https://capx.broker/api/admin/custody")), null);
});
