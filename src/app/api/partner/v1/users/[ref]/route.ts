import { partnerRoute, send, sendFail, fail, partnerCustomer, customerView } from "@/lib/partnerApi";

export const dynamic = "force-dynamic";

/** One customer: who they are, where their verification stands, what they hold. */
export const GET = partnerRoute("GET /v1/users/:ref", {}, async ({ caller, req }) => {
  const ref = decodeURIComponent(new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "");
  const customer = await partnerCustomer(caller.partner.id, ref);
  if (!customer) return sendFail(fail("unknown_customer", "No customer of yours matches that.", 404));
  return send({ ok: true, user: await customerView(customer.id) });
});
