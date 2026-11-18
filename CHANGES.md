# Changes — 18 Nov 2026

## Merge
Applied in order: `godavari-voice-agent-updated` (base) → `catalogue-fix` → `sarvam-clone-fix` →
`store-knowledge` → `sales-flow` → `opening-speech-fix`. Each later `shop.ts` / `shop.test.ts`
was checked against the previous one: every patch only adds behaviour, so the final files are
the last patch's versions. The store totals in the README were checked against the seed data:
₹590 cart + Kaja ₹220 + Pootharekulu ₹220 = ₹1,030, + ₹60 shipping for PIN 533001 = ₹1,090.

## New: hospital visiting-doctor workflow
- `src/lib/hospital/data.ts` — **demo** hospital, two visiting doctors, slot capacity, two patients, compounder.
- `src/lib/workflow/hospital.ts` — rules-only call (no OpenAI): AI disclosure → identity check →
  visit offer → slot (full-slot and out-of-hours handling) → compounder pickup → readback →
  separate clear yes → one `appointment_booked` outcome carrying the compounder alert.
  Also: fee / place / timing / other doctors / what to bring from data; no medical advice;
  emergencies → 108 + `urgent_referral`; relative answering; wrong person; busy → callback;
  not interested; do-not-call; silence; repeated misunderstanding → staff.
- Hospital calls appear in the same Call list (🏥) with their own test phrases and outcome labels.

## Voice naturalness
- `src/lib/telugu/speech.ts` — the screen keeps digits; Sarvam receives numbers, prices, weights,
  times, dates, ranges and PIN codes as Telugu words; markdown and emoji are removed.
  Applied to every reply (shop and hospital) in the `/api/tts` route, cache keys and `tts:warm`.
- Voices tab: one shared comparison line plus hospital lines, so stock and cloned voices can be
  compared on the same text.
- `SARVAM_TTS_SAMPLE_RATE=8000` option to hear phone-line quality locally.

## Small fixes
- Shop close lines no longer break when new outcome kinds exist (type error).
- Removed the `e2e` npm script: `scripts/e2e.mjs` was not in any of the six ZIPs.
- Added `npm run dev:3001`.
- `.env.example` documents `SARVAM_CLONE_VOICE_ID` and `SARVAM_TTS_SAMPLE_RATE`.

## Access-code screen fix (11:30)
- A wrong code now shows a message under Continue instead of doing nothing, even if you type the same code twice.
- Spaces or quotes around `PILOT_ACCESS_CODE` in `.env.local`, or around the typed code, no longer cause a mismatch.
- If `.env.local` still has the placeholder `change-me`, the screen says so.
- New `tests/auth.test.ts` (3).

## Conversation style from the reference loan call (13:55)
- Hospital agent now follows the reference call: a first name ("నేను స్వాతి", set in `data.ts`),
  why we're calling ("…అడిగారు కదా"), a short "థాంక్యూ అండి / ఓకే అండి" before each question,
  one question per turn, and the next step plus when it happens after booking.
- New `SARVAM_ENGLISH_WORDS` (default `telugu`): common English words are sent to the voice in
  Telugu script, as in the reference call. `roman` keeps them in English letters. Not listened to yet.
- The agent still says it is an AI assistant in the opening, and when asked.

## Tests
- New: `tests/hospital.test.ts` (19), `tests/speech.test.ts` (6).
- Run in the build sandbox with a minimal Vitest stand-in (no package registry access):
  **123 of 124 pass**. The 1 not run needs `gpt-tokenizer` (prompt-size check), unchanged code.
- **Not run here:** `npm ci`, real `vitest`, `npm run typecheck` (React/Next types), `npm run build`,
  live Sarvam/OpenAI calls, microphone, and listening to any audio. Run those on the Mac.

## Not verified
- How any line actually sounds. Nobody has listened to the new spoken forms yet.
- Sarvam clone endpoint (`/voices/clone`, `voice_id`, `audio_b64`) is unchanged from the
  clone-fix patch; I could not re-check it against current Sarvam docs.
- Speaker id `kavitha_te_conversation` is unchanged; confirm it in Sarvam's voice list.
- Real hospital data, real telephony, real compounder notification (it is only recorded as an outcome).

# Changes — 18 Nov 2026 (natural conversation fixes)

Review found the hospital agent only understood exact phrases: natural replies got
"సరిగ్గా వినపడలేదు" and two of them ended the call. Fixed, following the reference loan call.

## Understanding the caller
- **Model fallback (new):** a reply the rules can't place goes to OpenAI once
  (`interpretHospitalWithLlm`, ~600 in / 20 out tokens, ~1–1.5 s). The model only *labels* the reply;
  the same rules still decide, so the model can never book, invent facts or end a call as an emergency.
  Call goes to staff only after 3 misses (rules + model), not 2.
- Speech-recognition punctuation is ignored ("అవును, బుక్ చేయండి." now books).
- Natural yes/no: "అవునండి నేనే లక్ష్మి, చెప్పండి", "ఓహో, సరే అండి", "ok no problem book it",
  "వద్దండి మా అబ్బాయి తీసుకొస్తాడు". A bare "ఆ" or "అవును కానీ ఇప్పుడు వద్దు" still does not book.
- **Answer + question in one breath** (reference-call style): "పదకొండు గంటలకి, fee ఎంత?" → fee answered
  *and* 11:00 taken, then the next question.
- Questions without data (parking, canteen…) get "front desk will call you" and are saved with the
  outcome for staff, instead of "didn't hear". Asking for another day → "doctor comes only on Saturday".
- Romanized times: "padakondunnara ki" = 11:30, "padiki" = 10:00.

## Bugs fixed
- "ఇప్పుడు నొప్పి ఏమీ లేదు" (no pain now), "I don't k**now**", "emergency appointment?" no longer
  send the caller to 108 and close the call.
- "ph**one**", "some**one**", "రెండు రోజుల" are no longer read as clock times.
- "ఆ తరువాత ఏం చేయాలి?" is no longer taken as "call me later".
- **Overbooking:** bookings from other calls now count against slot capacity, and capacity is checked
  again at the moment of booking (before: 5 calls could all book a slot with 2 places).

## Faster replies
- Replies are sent as sentence-sized audio parts; the browser fetches them in parallel and starts the
  first one early. Measured live with Sarvam: first sound after ~1.0–1.2 s instead of ~2.9–4.7 s.
  Repeated sentences are reused from the audio cache across calls.
- End-of-speech wait 1.5 s → 1.0 s (`src/client/mic.ts`).

## Tests
- New `tests/hospital-natural.test.ts`; 148 tests pass. `npm run typecheck` and `npm run build` pass.
- New `npm run hospital:live`: messy conversations against the real model.
- Verified live: OpenAI gpt-5.4-mini labels, Sarvam Bulbul v4 Flash `kavitha_te_conversation`,
  full booking through the running server's API.
- **Not verified:** real microphone / speech recognition with real callers, how the split audio sounds
  between sentences, real telephony.

# Changes — 18 Nov 2026 (human-sounding voice + random-call testing)

## Voice
- **Cloned voice is the default** (`SARVAM_CLONE_VOICE_ID=svc-143db682-…` in `.env.example`).
- Cloned voice now uses Sarvam's **streaming** clone endpoint (`/voices/clone/stream`): a whole reply
  arrives in ~1.1 s (the JSON endpoint took ~3 s). Falls back to `/voices/clone` if streaming fails.
  `pace` works on it (measured), so the Voices pace slider applies to the clone too.
- **One continuous take per reply** again (no sentence splitting): stitched sentences restart the
  intonation each time, which sounded robotic. Speed is unchanged thanks to streaming.
- Acknowledgements rotate ("ఓకే అండి / సరే అండి / అలాగే అండి / హా, సరే అండి") instead of the same one every turn.

## Call sound (new, browser only, no extra cost) — Voices tab → "Call sound"
- **Hospital office background**: a quiet 40 s seamless loop (room tone, far-off Telugu murmur,
  keyboard taps) under the whole call, fading in/out; level slider. File: `public/ambience/hospital-office.mp3`
  (made from Sarvam stock voices, muffled — no third-party audio).
- **Phone-line sound** for the agent's voice (300–3400 Hz + light compression, like a handset).
- Code: `src/client/fx.ts`.

## Random-call testing (new) — `npm run simulate -- 12` (`--audio` renders MP3s; needs ffmpeg)
OpenAI plays 12 kinds of callers (elderly, son, busy, hard of hearing, sceptical, wrong number, not
interested, worried about tablets…), talking natural Telugu / romanized Telugu to the real agent;
a second pass reviews each transcript. First run: 4/12 calls clean. After fixes: 11/12 per batch,
remaining notes mostly reviewer false alarms. Bugs it found and fixed:
- Loop: "book చేయండి, fee ok" at the readback repeated the fee forever ("fee" taken as a question).
- Yes + a question at the readback ("book చేయండి, parking ఉంటుందా?", "…BP tablet వేసుకోవచ్చా?")
  now answers and books instead of asking again.
- "మీరే call చేయొద్దు" (no compounder needed) was recorded as **do-not-call**. Now only "never call me again".
- "11 కాకుండా 1కి మార్చండి" kept 11; a new time at the readback was ignored and the old time booked.
- "నాకు అవసరం లేదు, book చేయొద్దు" was taken as "book" → now not interested.
- "నేనే, వంటలో ఉన్నాను, సాయంత్రం call back చేయండి" now schedules the callback.
- "మాత్రం" was matched as మాత్ర (tablet); "మందుల చీటీ" as a medical question; "21st", "four hundred" as times.
- Wrong number ("లక్ష్మి ఎవరో తెలీదు") now ends politely instead of asking for Lakshmi.
- Evening request when the doctor is morning-only: says so and offers the latest slots (never books morning silently).
- Can't come Saturday → offers a call for the doctor's next visit; "తర్వాతి సారి call చేయండి, అప్పుడు book" closes as that callback.
- Repeated medical question → "our nurse will call you about fasting/tablets", noted for staff.
- Pickup preference said early is remembered; "why are you calling?" before identity gets a short,
  privacy-safe reason; "compounder ఎప్పుడు call చేస్తారు?" answered from `data.ts` (`compounderCallWhen`).
- "book చేయండి, ఏ టైంకి?" lists the free slots directly (not the doctor's full timetable first).

## Tests
170 offline tests pass (`tests/hospital-natural.test.ts` covers every bug above); typecheck and build pass.
**Not verified:** how the ambience / phone-line chain sounds on a real phone browser (iOS Safari routing of
the voice through Web Audio), echo-cancellation with the background playing while the mic is open.

# Changes — 18 Nov 2026 (conversation style C: Tenglish like the reference call)

Four sample styles were recorded (A Telugu-heavy, B light Tenglish, C Tenglish like the reference loan
call, D urban English); **C was chosen** and every agent line now follows it:
- English for dates, times, money and key words, Telugu as glue: "ఈ Saturday, 21st Dr. రమేష్ గారు
  వస్తున్నారు… Morning 10:30 కి, లేదా 11 కి slots available ఉన్నాయి. మీకు ఏ time convenient?…
  fee 400 rupees… Done అండి, booking confirm అయింది… take care!"
- Old/formal words replaced: తేదీ, ఉదయం/మధ్యాహ్నం, ఏర్పాటు, మందుల చీటీ, క్షమించండి, వివరం, ఖాళీ, లైన్ →
  21st, morning/afternoon, pickup arrange, prescription, sorry, details, available, network.
- **Numbers are spoken in English** ("టెన్ థర్టీ", "ఫోర్ హండ్రెడ్ రుపీస్", "ట్వంటీ ఫస్ట్", "వన్ ఓ ఎయిట్").
  `SPEECH_NUMBERS=telugu` in `.env.local` switches back to Telugu numbers.
- Questions in the very first reply (fee, address, "compounder pick up చేస్తారా?") are answered; the
  patient saying their own name ("లక్ష్మినే") counts as identity; romanized refusals ("book cheyyanu").
- Data file spoken strings updated to style C (`src/lib/hospital/data.ts`).
- 173 tests pass; 12 random simulated calls: 11 rated OK.

# Changes — 18 Nov 2026 (Sai Viswas Hospital agent "Ravi")

## What it does
- **Inbound** (`HSP-INBOUND`): answers the hospital number — "నమస్కారం అండి! సాయి విశ్వాస్ hospital నుంచి రవి
  మాట్లాడుతున్నాను. చెప్పండి అండి, మీకు ఎలా help చేయగలను?" — answers questions, takes the name, books a date.
- **Outbound** (`HSP-ALERT-3001/3002`): new-doctor-visit alert — checks it's the patient (or a relative), offers the visit, books.
- Data (`src/lib/hospital/data.ts`): Dr. Viswanath, cardiologist, **Nov 22 and 25**, fee **100 rupees**, **50 per day**.
  Booking is by date (no time slots). Address and exact timings: "WhatsApp after booking"; anything else: reception.
- No compounder. After booking: "Complete booking details, hospital address మీ WhatsApp కి ఇప్పుడే పంపిస్తున్నాను".
  (The WhatsApp message itself is **recorded as a task** in the booking — sending needs a WhatsApp Business API account.)
- What to bring: old reports, scanning reports, current medication details.
- **Language:** English caller → English replies (and the voice is told the reply is English); Telugu / romanized
  Telugu / mixed → style C Tenglish.
- **AI disclosure:** never mentioned in the opening or normal replies. If the caller asks directly ("robot ఆ?",
  "is this a real person?") the agent says once, honestly, "నేను సాయి విశ్వాస్ hospital virtual assistant ని అండి" and carries on.
  It never claims to be human.
- **Call tracking:** every outcome carries a call record (direction, phone, name, language, booked date, questions for
  reception); Outcomes tab → **Download call log (CSV)** (`/api/calls`), with transcripts.
- Follows the reference script turn by turn (see `tests/hospital.test.ts`, "follows the script end to end").

## Testing
- 137 offline tests pass; build passes.
- 39 random simulated calls in 3 rounds (inbound, outbound, English): 10/13 → 11/13 → 11–12/13 rated OK; every real
  issue found became a fix and a test.
- Cloned voice measured male (~109 Hz) — fits "Ravi".

# Changes — 18 Nov 2026 (Ravi becomes an AI agent)

Test report showed the fixed-line agent repeating itself ("లైన్‌లో ఉన్నారా?" → same offer again; "you sound scripted" →
"contact reception"; "I need a physiotherapist" → kept pushing cardiology). Rebuilt so the model writes every reply.

## How it works (`src/lib/agent/hospitalAgent.ts`)
- **The model (OpenAI gpt-5.5) writes each reply** from: Ravi's persona and style rules (style C Tenglish, English for
  English callers, short, warm, never word-for-word repetition, "హా వినిపిస్తుంది అండి" for line checks, kind with upset
  callers), the hospital knowledge base, the whole conversation, today's calendar, the current time and live free dates.
- **The code keeps control:** bookings only through `book_appointment`, which the code checks (real doctor, real date,
  free capacity, a name, a clear yes from the caller); emergencies, silence and failures are handled before/after the
  model; it never claims to be human (checked on every reply); one outcome per call.
- **"I'll check with the team"** only for personal matters/complaints/unknowns → `log_for_team`, saved in the call log.
- Old rules engine kept as a fallback: `HOSPITAL_ENGINE=rules`.

## Knowledge base (`src/lib/hospital/knowledge.ts`) — DEMO DATA, replace before going live
Hospital info (address, phones, OP hours, emergency, parking, pharmacy, canteen, payment, visiting hours), 8 doctors
(cardiology camp with Dr. Viswanath Nov 22 & 25 ₹100 + resident general medicine, ortho, gynaec, paediatrics,
physiotherapy, dermatology, diabetology with OP days/timings/fees/capacity), services and prices (ECG, echo, TMT,
X-ray, scans, lab, not-available ones), health packages, insurance/Aarogyasri, policies. Bookable for every doctor.

## Speed
- **Streaming:** the first sentence is sent to the voice while the model is still writing (`/api/turn` NDJSON).
- **Instant acknowledgement:** "హా అండి." / "ఓకే అండి." / "Sure." in Ravi's voice (pre-loaded) plays the moment the caller
  stops; the model is told and continues without repeating it (code also trims a doubled acknowledgement).
- Measured on the server: model's first sentence ~1.2–2.1 s; the acknowledgement covers the wait.
- Model comparison (Telugu quality vs speed): gpt-5.5 best (default), gpt-5.4 close, gpt-5.4-mini fastest. `AGENT_MODEL` to change.

## Testing
- 147 offline tests (10 new for the AI agent's guardrails, with a mocked model).
- Simulated callers incl. angry, "you sound scripted", physiotherapy, many questions, English, tricksters, personal
  report questions, child with fever. Reviewer score (out of 10, judged against the knowledge base):
  round 1 avg ~7.5 → round 2 ~8.2 → round 3 ~9.6 (8 of 12 perfect). Bugs found and fixed on the way: "ok" matched
  inside "book" (booked without a yes), same-day availability missing, repeated promises, "గారు" for a child,
  model implying fixed time slots.

# Changes — 18 Nov 2026 (real phone calls)

- **Phone server** (`phone/`): Twilio Media Streams (8 kHz μ-law over WebSocket). Detects the end of the caller's
  sentence (700 ms quiet), plays the instant acknowledgement, Sarvam recognition, streaming AI reply, Ravi's cloned
  voice at 8 kHz; caller talking over Ravi cuts him off immediately (barge-in); hangs up after the goodbye;
  checks the line after 9 s of silence. Records every call: `data/calls/<id>.wav` (stereo: caller | Ravi) + `.json`
  (transcript, per-turn timings, outcome). Provider-agnostic core (`phone/bridge.ts`) — Exotel/Plivo adapters later.
- `npm run phone`, `npm run phone:call -- +91…` (Twilio calls your verified mobile), `npm run phone:sim` (fake call).
- Guide with pass/fail checklist: **PHONE-TEST.md**.
- Fixed while testing: the noise level was learned from speech too, so interruptions were never detected; a reply
  dropped because the caller spoke first is now marked "not heard" for the agent.
- Fake-call test over the real server (stand-in voice/recognition; real AI): acknowledgement plays the instant the end
  of speech is detected (~0.7 s after the caller stops); answer audio ~2.3–3.3 s after that.
- **Blocked:** Sarvam account has no credits (402) — top up before the real call.
- 152 offline tests (5 new for the phone bridge).
