import { upgradeWebSocket, waitUntil } from "@vercel/functions";
import { phoneCallId } from "@/lib/alg-phone";
import { updateAlgCall, uploadAlgRecording } from "@/lib/storage/alg";
import { attachPhoneSocket } from "../../../../../phone/server";
import { stereoWav } from "../../../../../phone/audio";

export const runtime = "nodejs";
export const maxDuration = 240;
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const id = phoneCallId(new URL(req.url));
  if (!id) return new Response(null, { status: 403 });
  return upgradeWebSocket((socket) => {
    attachPhoneSocket(socket, true, (call, seconds) => {
      waitUntil((async () => {
        const latencies = call.timings.flatMap((t) => t.firstAudioAfterMs == null ? [] : [t.firstAudioAfterMs]);
        await updateAlgCall(id, {
          status: "Completed", seconds: Math.round(seconds), transcript: call.transcript, outcome: call.outcome,
          response_ms: latencies.length ? Math.round(latencies.reduce((a,b) => a+b, 0) / latencies.length) : null,
        });
        const { left, right } = call.recording();
        await updateAlgCall(id, { recording: await uploadAlgRecording(id, stereoWav(left, right)) });
      })().catch(console.error));
    }, id.endsWith("-gemini") ? "gemini" : undefined);
  });
}
