# ALG

ALG is a Next.js dashboard for Shankar, the Telugu–English Sai Viswas voice agent. The public overview starts with sample data. The live dashboard, microphone test and outbound calling require a pilot code for hosted deployments.

## Preview locally

Use Node.js 22 LTS. Run `npm ci` and `npm run dev:3001`. Open http://localhost:3001. The browser voice test uses the provider credentials from `.env.local`; the dashboard WebSocket endpoint needs a Vercel runtime with WebSocket support.

## Deploy from Git

1. Push the contents of this folder to a Git repository, with `package.json` at its root. Import it into Vercel as a Next.js project.
2. For the sample-data showcase, deploy with no credentials. For live tests, create a Supabase project and run `supabase/alg.sql` once in the SQL Editor. It creates the call log and agent record tables with row-level security, and a private audio bucket.
3. Add the following server-side variables to Vercel and redeploy. Use the production environment if you will call from the production URL.

| Variable | Value |
|---|---|
| `PILOT_ACCESS_CODE` | Strong private code for the live demo |
| `SESSION_SECRET` | Independent value from `openssl rand -hex 32` |
| `OPENAI_API_KEY` | OpenAI server API key |
| `SARVAM_API_KEY` | Sarvam server API key |
| `SARVAM_CLONE_VOICE_ID` | Optional existing Shankar clone ID. If blank, the app uses its configured stock voice. |
| `AGENT_MODEL` | Optional. Existing Shankar default is GPT-5.5; test `gpt-5.4-mini` if you want the lower-cost pilot configuration. |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **legacy service_role** JWT key. Server only. |
| `VOBIZ_AUTH_ID`, `VOBIZ_AUTH_TOKEN`, `VOBIZ_FROM` | The existing Vobiz account values and outbound caller ID |
| `PHONE_SECRET` | A separate value from `openssl rand -hex 32` |
| `ALG_PUBLIC_URL` | The stable HTTPS URL of this exact Vercel deployment, without a path |
| `ALG_TEST_NUMBERS` | Comma-separated approved test mobile numbers, each in +91 format |

Leave Vercel Deployment Protection off the production callback routes or configure a Vercel protection bypass specifically for Vobiz before testing. Vobiz must reach the HTTPS Answer endpoint and the WebSocket endpoint. The app authenticates these per call with a short-lived signed URL. Never put provider keys in Git or in `NEXT_PUBLIC_` variables.

4. **Browser test**: click **Test in browser**, enter the pilot code, choose the Sai Viswas scenario, start and end a session. Completed browser tests save their transcript and estimated AI cost.
5. **Phone test**: in ALG **Settings**, enter the pilot code to unlock live logs. Open **Test calls**, enter one allowlisted test number, and click **Call test number**. After hanging up, open the new **Call logs** row for the transcript and recording. The dashboard refreshes live logs every five seconds while unlocked.

## Scope

- The phone stream uses Vercel's WebSocket runtime and the existing Vobiz adapter. The call is configured for up to three minutes. Test this from the deployed URL with your Mac off before a client demo.
- Call outcomes and audio depend on Vobiz sending successful callbacks and Supabase accepting the writes. Phone cost stays blank until actual carrier billing is integrated. Browser cost is estimated. The overview uses the latest 250 saved records.
- This is a single private demo workspace. The pilot code grants access to all live logs. Use testers who know the call is being recorded, and use dummy hospital data for demos.
- The original local Vobiz and Twilio commands are retained. See [PHONE-TEST.md](PHONE-TEST.md) for the original local Twilio instructions.

## Voice Studio and Gemini comparison

Open Voice Studio and choose **Shankar · GPT** or **Shankar · Gemini 3.1 Flash-Lite**, then choose the browser microphone or Vobiz phone channel. GPT remains the default. Set the server-side `GEMINI_API_KEY` to enable the separate Gemini test path. Keep the existing OpenAI and Sarvam variables. Both agents use the same Sarvam speech and Vobiz phone integration.

Gemini test outcomes are saved with the call log without updating the shared booking and outcome store. Use synthetic patient information. Transcripts and recordings appear after the call is saved. Set `WS_NO_BUFFER_UTIL=1` on Vercel for the real phone stream.
