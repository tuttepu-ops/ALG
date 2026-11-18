import { checkPilot } from "@/lib/auth";
import { algStorageReady, listAlgCalls, signAlgRecording } from "@/lib/storage/alg";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = checkPilot(req);
  if (denied) return denied;
  if (!algStorageReady()) return Response.json({ calls: [], configured: false });
  try {
    const calls = await listAlgCalls();
    const id = new URL(req.url).searchParams.get("recording");
    if (!id) return Response.json({ calls, configured: true });
    const call = calls.find((item) => item.id === id);
    if (!call?.recording) return Response.json({ error: "Recording not found." }, { status: 404 });
    return Response.json({ url: await signAlgRecording(call.recording) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
