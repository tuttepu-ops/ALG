import { phoneCallId, phoneUrl } from "@/lib/alg-phone";
import { updateAlgCall } from "@/lib/storage/alg";

export async function POST(req: Request) {
  const id = phoneCallId(new URL(req.url));
  if (!id || !process.env.ALG_PUBLIC_URL) return new Response(null, { status: 403 });
  const stream = phoneUrl(process.env.ALG_PUBLIC_URL, "/api/alg/stream", id);
  stream.protocol = "wss:";
  await updateAlgCall(id, { status: "Connected" }).catch(console.error);
  return new Response(
    `<Response><Stream bidirectional="true" keepCallAlive="true" streamTimeout="180" contentType="audio/x-mulaw;rate=8000">${stream.href.replaceAll("&", "&amp;")}</Stream><Hangup/></Response>`,
    { headers: { "Content-Type": "application/xml" } },
  );
}
