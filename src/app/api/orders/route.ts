import { checkPilot } from "@/lib/auth";
import { orderSource, orderTotal } from "@/lib/orders/orders";
import { getStore } from "@/lib/storage/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = checkPilot(req);
  if (denied) return denied;
  const [orders, outcomes] = await Promise.all([orderSource.list(), getStore().listOutcomes()]);
  return Response.json({
    orders: orders.map((o) => ({
      ...o,
      total: orderTotal(o),
      lastOutcome: outcomes.find((x) => x.orderId === o.id) ?? null,
    })),
  });
}
