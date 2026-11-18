# Real phone-call test — Ravi on your mobile

Twilio calls **your own mobile**, and Ravi talks to you over a real phone line. Every call is recorded
(left channel = you, right channel = Ravi) with a transcript and timings in `data/calls/`.

## 0. Before you start (one time)

1. **Top up Sarvam credits** at the Sarvam API dashboard (voice + speech recognition stopped with
   "No credits available"). Nothing works on the phone without this.
2. **Twilio trial account** (free): sign up at twilio.com →
   - verify **your mobile number** during sign-up (trial accounts can only call verified numbers);
   - get the free trial phone number (Console → Phone Numbers → Buy a number);
   - Voice → Settings → **Geo permissions** → tick **India**.
   - Copy **Account SID** and **Auth Token** (Console home page).
3. **Tunnel** so Twilio can reach your Mac:
   ```bash
   brew install cloudflared
   ```
4. Add to `.env.local` (same file as your OpenAI/Sarvam keys):
   ```
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_AUTH_TOKEN=...
   TWILIO_FROM=+1XXXXXXXXXX
   PHONE_PUBLIC_URL=            # fill in after step 2 below
   ```

## 1. Start the phone server (Terminal 1)

```bash
cd ~/Downloads/godavari-voice-agent
```
```bash
npm install
```
```bash
npm run phone
```

## 2. Start the tunnel (Terminal 2)

```bash
cloudflared tunnel --url http://localhost:8080
```
It prints a link like `https://something-words.trycloudflare.com`. Put it in `.env.local` as
`PHONE_PUBLIC_URL=https://something-words.trycloudflare.com` (no need to restart the phone server).

## 3. Make Twilio call you (Terminal 3)

Ravi answering like the hospital line (someone called the hospital):
```bash
npm run phone:call -- +91XXXXXXXXXX
```
Ravi calling Lakshmi about the cardiologist visit:
```bash
npm run phone:call -- +91XXXXXXXXXX alert
```
Pick up. The **trial account first plays a short Twilio message — press any key**, then Ravi speaks.

## 4. Things to try on the call

- Normal booking: "Doctor Viswanath garu eppudu vastharu? fee entha?" → book the 22nd with your name.
- "హలో, లైన్‌లో ఉన్నారా?" (expect: "హా వినిపిస్తుంది అండి…")
- Talk over Ravi while he is speaking — he should stop at once and listen.
- Ask other things: physiotherapy, parking, Aarogyasri, CT scan, Sunday timings.
- Switch to English for a few sentences — Ravi should switch too.
- Be a bit annoyed ("same script laga cheptunnaru") — he should apologise and rephrase.
- Stay silent for 10 seconds — he should check "హలో అండి, వినిపిస్తోందా?".

## 5. Pass / fail (decide startup vs. start again)

Fill this in after 3–5 calls:

| Check | Pass if | Your result |
|---|---|---|
| First sound after you stop talking | "హా అండి." within ~1 s, every time | |
| Real answer | starts within ~3 s | |
| Understood you | 8 of 10 sentences or better (see transcript in `data/calls/*.json`) | |
| Interrupting Ravi | stops within half a second | |
| Answers | correct facts, no made-up info | |
| Booking | right doctor, date, name; only after your yes | |
| Sounds like a person | your rating 4/5 or better | |
| Audio quality on the line | clear, no cut words | |

Send me the `.wav` + `.json` files from `data/calls/` and this table — I'll go through every turn.

## If something goes wrong

| What you see | Fix |
|---|---|
| `Phone server not reachable` | Terminal 1 and 2 must both be running; `PHONE_PUBLIC_URL` must be the tunnel link |
| Twilio: "unverified number" | Trial accounts can only call the number you verified |
| Twilio: geo permission error | Voice → Settings → Geo permissions → India |
| Call connects but silence | Check Terminal 1: "tts failed … credits" → top up Sarvam |
| Ravi cuts himself off / doesn't hear you | Note the time in the call and send me the recording — detector thresholds can be tuned |
