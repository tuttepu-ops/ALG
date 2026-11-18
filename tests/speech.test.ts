import { describe, expect, it } from "vitest";
import { spokenDate, spokenRange, spokenTime, teluguOrdinal, toSpeech } from "@/lib/telugu/speech";
import { planAudio } from "@/lib/providers/ttsCache";

describe("spoken text for the voice engine", () => {
  it("writes prices, weights and ranges as Telugu words", () => {
    expect(toSpeech("మొత్తం 1090 రూపాయలు.")).toBe("మొత్తం వెయ్యి తొంభై రూపాయలు.");
    expect(toSpeech("Fee ₹400.")).toBe("Fee నాలుగు వందల రూపాయలు.");
    expect(toSpeech("పూతరేకులు 250 గ్రాముల pack")).toBe("పూతరేకులు రెండు వందల యాభై గ్రాముల pack");
    expect(toSpeech("Delivery 2–4 business days లో వస్తుంది")).toBe("Delivery రెండు నుంచి నాలుగు business days లో వస్తుంది");
  });

  it("reads PIN codes and phone numbers digit by digit", () => {
    expect(toSpeech("PIN 533001")).toBe("PIN ఐదు మూడు మూడు సున్నా సున్నా ఒకటి");
  });

  it("removes markdown and emoji but keeps the words", () => {
    expect(toSpeech("**Kaja** ఉంది 😊")).toBe("Kaja ఉంది");
  });

  it("says times and dates the way people do", () => {
    expect(spokenTime("10:30")).toBe("ఉదయం పదిన్నరకి");
    expect(spokenTime("13:00")).toBe("మధ్యాహ్నం ఒంటి గంటకి");
    expect(spokenTime("16:30")).toBe("సాయంత్రం నాలుగున్నరకి");
    expect(spokenRange("10:00", "13:00")).toBe("ఉదయం పది గంటల నుంచి మధ్యాహ్నం ఒంటి గంట వరకు");
    expect(spokenDate("2026-11-21")).toBe("శనివారం, నవంబర్ ఇరవై ఒకటో తేదీ");
    expect(teluguOrdinal(2)).toBe("రెండో");
    expect(teluguOrdinal(20)).toBe("ఇరవయ్యో");
    expect(teluguOrdinal(10)).toBe("పదో");
  });

  it("text without numbers is unchanged, so old cached audio is still reused", () => {
    const line = "హలో అండి, Godavari Basket voice assistant‌ని. మీ order గురించి ఇప్పుడు మాట్లాడొచ్చా?";
    expect(toSpeech(line)).toBe(line);
  });

  it("the screen keeps the digits; only the spoken copy changes", () => {
    const [p] = planAudio([{ text: "Items మొత్తం 1030 రూపాయలు.", cacheable: false }], { model: "bulbul:v4-flash", speaker: "kavitha_te_conversation", pace: 1 });
    expect(p.text).toContain("1030");
    expect(p.spoken).toBe("ఐటమ్స్ మొత్తం వన్ థౌజండ్ థర్టీ రుపీస్."); // default: Tenglish numbers, English words in Telugu script
    expect(p.chars).toBe([...p.spoken].length);
  });

  it("an English reply is sent as plain English (no Telugu-script transliteration)", () => {
    const en = "Perfect, Ramesh! Your appointment on November 22nd is confirmed. Fee 100 rupees.";
    expect(toSpeech(en, "telugu", "english")).toBe(en);
  });

  it("numbers in English (default) or Telugu words", () => {
    expect(toSpeech("Saturday, 21st morning 10:30 కి, లేదా 11 కి. Fee 400 rupees. 108 కి call చేయండి.", "telugu", "english"))
      .toBe("సాటర్డే, ట్వంటీ ఫస్ట్ మార్నింగ్ టెన్ థర్టీ కి, లేదా ఎలెవెన్ కి. ఫీజు ఫోర్ హండ్రెడ్ రుపీస్. వన్ ఓ ఎయిట్ కి కాల్ చేయండి.");
    expect(toSpeech("10:30", "telugu", "telugu")).toBe("పదిన్నర");
    expect(toSpeech("Morning 10:30 or 11 o'clock, రెండు slots ఉన్నాయి", "roman", "english")).toBe("Morning టెన్ థర్టీ or ఎలెవెన్ o'clock, రెండు slots ఉన్నాయి");
  });

  it("can send common English words in Telugu script, leaving brand names alone", () => {
    const line = "Book అయిపోయింది అండి. Godavari Basket. Thank you అండి! Consultation fee ₹400.";
    expect(toSpeech(line, "telugu")).toBe("బుక్ అయిపోయింది అండి. Godavari Basket. థాంక్యూ అండి! కన్సల్టేషన్ ఫీజు నాలుగు వందల రూపాయలు.");
    expect(toSpeech(line, "roman")).toBe("Book అయిపోయింది అండి. Godavari Basket. Thank you అండి! Consultation fee నాలుగు వందల రూపాయలు.");
    expect(toSpeech("slots ఉన్నాయి, ఏ time?", "telugu")).toBe("స్లాట్స్ ఉన్నాయి, ఏ టైమ్?");
  });
});
