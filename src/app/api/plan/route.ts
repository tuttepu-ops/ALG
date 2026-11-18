import { checkPilot } from "@/lib/auth";
import { resolveVoice } from "@/lib/config";
import { orderSource } from "@/lib/orders/orders";
import { planAudio } from "@/lib/providers/ttsCache";
import { T, orderReadout } from "@/lib/workflow/templates";
import { PATIENT_CALLS } from "@/lib/hospital/data";
import { hospitalOpening } from "@/lib/workflow/hospital";

export const dynamic = "force-dynamic";

// Audition lines (same Godavari Basket lines the agent uses) with cache keys. No provider call.
export async function POST(req: Request) {
  const denied = checkPilot(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { voice?: { speaker?: string; pace?: number } };
  const voice = resolveVoice(body.voice);
  const order = (await orderSource.get("GB-1042"))!;
  const d = (text: string) => ({ text, cacheable: false });
  const lines = [
    // Same test line for every voice, so stock and cloned voices can be compared fairly.
    { label: "Comparison line (shop)", seg: d("బెల్లం పూతరేకులు బాగుంటాయండి. పావు కిలో ప్యాక్ రెండు వందల ఇరవై రూపాయలు. ఒక ప్యాక్ కలపనా?") },
    { label: "Hospital · incoming call", seg: d(hospitalOpening(PATIENT_CALLS.find((p) => p.direction === "inbound")!)) },
    { label: "Hospital · new-visit alert", seg: d(hospitalOpening(PATIENT_CALLS[0])) },
    { label: "Hospital · doctor info", seg: d("Dr. విశ్వనాథ్ గారు cardiologist అండి. ఈ month November 22, 25 dates లో available ఉన్నారు. Consultation fee కేవలం 100 rupees మాత్రమే అండి. మీకు appointment book చేయమంటారా అండి?") },
    { label: "Hospital · booked", seg: d("Perfect అండి Ramesh గారు! November 22 కి appointment confirm అయిపోయింది. Complete booking details, hospital address మీ WhatsApp కి ఇప్పుడే పంపిస్తున్నాను. Thank you so much, take care!") },
    { label: "Hospital · English", seg: d("Perfect, Ramesh! Your appointment on November 22nd is confirmed. I'm sending the complete booking details to your WhatsApp right now. Thank you so much, take care!") },
    { label: "Opening", seg: T.opening },
    { label: "Order readout (GB-1042)", seg: orderReadout(order) },
    { label: "Why we called", seg: T.whyConfirm },
    { label: "Confirmed", seg: T.confirmed },
    { label: "Callback", seg: T.askCallbackTime },
  ];
  const planned = planAudio(lines.map((l) => l.seg), voice);
  return Response.json({ voice, lines: lines.map((l, i) => ({ label: l.label, segment: planned[i] })) });
}
