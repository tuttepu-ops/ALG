// SAI VISWAS HOSPITAL — knowledge base the agent answers from.
// ⚠️ DEMO DATA: every name, number, timing and price except the visiting cardiologist (Dr. Viswanath,
// Nov 22 & 25, ₹100, 50/day) is invented for testing. Replace with the hospital's real details before going live.
// The agent may say ONLY what is in this file (plus the booking tools); anything else → "I'll check with the team".

export interface Doctor {
  id: string;
  name: string;
  department: string;
  qualification: string;
  /** "visiting" doctors come on specific dates; "resident" doctors have weekly OP days. */
  kind: "resident" | "visiting";
  /** Weekly OP days for resident doctors (0 = Sunday). */
  opDays?: number[];
  /** Specific visit dates (YYYY-MM-DD) for visiting doctors. */
  visitDates?: string[];
  timings: string;
  fee: number;
  /** Appointments per day the agent may book. */
  perDay: number;
  languages: string[];
  notes?: string;
}

export const HOSPITAL_INFO = {
  name: "Sai Viswas Hospital",
  type: "50-bed multi-speciality hospital",
  address: "D.No. 12-3-45, Main Road, near RTC Bus Stand, Kakinada, Andhra Pradesh 533001",
  landmark: "Opposite SBI, 2 minutes from the RTC bus stand",
  receptionPhone: "0884-2345678",
  whatsapp: "+91 90000 12345 (booking confirmations and reports)",
  emergencyPhone: "0884-2345600 (24×7)",
  ambulance: "Own ambulance, 24×7 — call 0884-2345600, or 108",
  opHours: "Monday to Saturday 9:00 AM – 8:00 PM; Sunday 9:00 AM – 1:00 PM (only visiting doctors / emergency on Sunday afternoon)",
  emergency: "24×7 casualty with duty doctor",
  visitingHoursForInpatients: "11:00 AM – 1:00 PM and 5:00 PM – 7:00 PM; one attendant allowed to stay",
  payment: "Cash, UPI (PhonePe/GPay/Paytm), debit and credit cards",
  languages: "Telugu, English, Hindi",
  parking: "Free two-wheeler and car parking inside the campus",
  accessibility: "Lift to all floors, wheelchairs at the entrance, ramp at the main gate",
  canteen: "Canteen on the ground floor, 7:00 AM – 9:00 PM",
  pharmacy: "24×7 in-house pharmacy, ground floor",
  bring: "Old reports, scanning reports, prescriptions and current medication details, and an ID proof (Aadhaar)",
  appointments: "Appointments are booked by DATE (not a fixed minute): the patient comes within the doctor's timings that day and gets a token at registration; booked patients are seen before walk-ins",
  arrival: "Please come 15 minutes early for registration",
  afterBooking: "Booking details and the hospital location are sent on WhatsApp",
  rescheduling: "Free to reschedule or cancel — call reception or reply on WhatsApp",
  followUp: "Follow-up with the same doctor within 7 days is free (once)",
  reportCollection: "Lab reports are sent on WhatsApp; printed copies at the lab counter",
};

export const DOCTORS_KB: Doctor[] = [
  { id: "dr-viswanath", name: "Dr. Viswanath", department: "Cardiology", qualification: "MD, DM (Cardiology)", kind: "visiting",
    visitDates: ["2026-11-22", "2026-11-25"], timings: "10:00 AM – 4:00 PM", fee: 100, perDay: 50, languages: ["Telugu", "English"],
    notes: "Visiting heart specialist. Special camp fee ₹100 (usual ₹500). ECG done the same day if the doctor advises." },
  { id: "dr-anjali", name: "Dr. Anjali Reddy", department: "General Medicine", qualification: "MBBS, MD (General Medicine)", kind: "resident",
    opDays: [1, 2, 3, 4, 5, 6], timings: "9:00 AM – 1:00 PM and 5:00 PM – 8:00 PM", fee: 300, perDay: 40, languages: ["Telugu", "English", "Hindi"],
    notes: "Fever, BP, sugar, general check-ups." },
  { id: "dr-prakash", name: "Dr. Prakash Rao", department: "Orthopaedics", qualification: "MS (Ortho)", kind: "resident",
    opDays: [1, 3, 5], timings: "10:00 AM – 2:00 PM", fee: 400, perDay: 25, languages: ["Telugu", "English"],
    notes: "Bones, joints, back pain, fractures, knee problems." },
  { id: "dr-sravani", name: "Dr. Sravani", department: "Gynaecology", qualification: "MS (OBG)", kind: "resident",
    opDays: [1, 2, 4, 6], timings: "10:00 AM – 1:00 PM", fee: 400, perDay: 25, languages: ["Telugu", "English"],
    notes: "Pregnancy care, women's health." },
  { id: "dr-kiran", name: "Dr. Kiran Kumar", department: "Paediatrics", qualification: "MD (Paediatrics)", kind: "resident",
    opDays: [1, 2, 3, 4, 5, 6], timings: "10:00 AM – 1:00 PM and 6:00 PM – 8:00 PM", fee: 300, perDay: 30, languages: ["Telugu", "English"],
    notes: "Children's doctor; vaccinations on Wednesdays and Saturdays." },
  { id: "physio", name: "Mr. Naveen (Physiotherapist)", department: "Physiotherapy", qualification: "BPT, MPT", kind: "resident",
    opDays: [1, 2, 3, 4, 5, 6], timings: "8:00 AM – 12:00 PM and 4:00 PM – 7:00 PM", fee: 250, perDay: 20, languages: ["Telugu", "English"],
    notes: "₹250 per session; 10-session package ₹2,000. Home visits within Kakinada ₹500 per session." },
  { id: "dr-lalitha", name: "Dr. Lalitha", department: "Dermatology (skin)", qualification: "MD (DVL)", kind: "resident",
    opDays: [2, 4, 6], timings: "4:00 PM – 7:00 PM", fee: 400, perDay: 20, languages: ["Telugu", "English"] },
  { id: "dr-ramana", name: "Dr. Ramana", department: "Diabetology", qualification: "MD, Fellowship in Diabetes", kind: "resident",
    opDays: [1, 4], timings: "9:00 AM – 12:00 PM", fee: 350, perDay: 25, languages: ["Telugu", "English"] },
];

/** Services with prices (demo). */
export const SERVICES = [
  { name: "ECG", price: 200, notes: "No appointment needed; 10 minutes" },
  { name: "2D Echo", price: 1500, notes: "On visiting cardiologist days and Tuesdays; book at reception" },
  { name: "TMT (treadmill test)", price: 1800, notes: "Tuesdays and Fridays, morning; come in comfortable shoes" },
  { name: "X-ray", price: 400, notes: "Daily 9 AM – 8 PM" },
  { name: "Ultrasound scan", price: 900, notes: "Daily 9 AM – 1 PM" },
  { name: "CT scan", price: 0, notes: "Not available — referred to a partner centre in Kakinada" },
  { name: "MRI", price: 0, notes: "Not available — referred to a partner centre" },
  { name: "Blood tests (lab)", price: 0, notes: "Lab open 7 AM – 7 PM; sample collection at home ₹100 extra. Sugar (fasting) test needs 10–12 hours fasting — lab instruction" },
  { name: "Lipid profile", price: 500, notes: "Lab instruction: 10–12 hours fasting" },
  { name: "HbA1c", price: 450, notes: "No fasting needed" },
  { name: "Dialysis", price: 0, notes: "Not available" },
  { name: "Physiotherapy session", price: 250, notes: "10-session package ₹2,000; home visit ₹500" },
];

export const PACKAGES = [
  { name: "Heart check-up package", price: 2500, includes: "Cardiologist consultation, ECG, 2D Echo, lipid profile, sugar" },
  { name: "Master health check-up", price: 3000, includes: "Doctor consultation, CBC, sugar, lipid, liver, kidney, thyroid, ECG, X-ray chest, urine" },
  { name: "Diabetes check-up", price: 1200, includes: "Diabetologist consultation, fasting & PP sugar, HbA1c, kidney function" },
  { name: "Senior citizen package (60+)", price: 2000, includes: "Consultation, CBC, sugar, lipid, kidney, ECG, eye screening" },
];

export const INSURANCE = {
  cashless: ["Star Health", "HDFC ERGO", "ICICI Lombard", "Care Health"],
  government: "Dr. NTR Vaidya Seva (Aarogyasri) accepted for listed in-patient procedures; OP consultations are paid",
  employees: "EHS (employee health scheme) accepted for in-patient care",
  notes: "Bring the insurance card and Aadhaar; the TPA desk at reception helps with approvals",
};

/** Hospital policies the agent can explain. */
export const POLICIES = [
  "The agent never gives medical advice; the doctor decides tests and medicines.",
  "Emergency (chest pain now, breathlessness, unconscious): call 108 or the emergency number immediately.",
  "Senior citizens (60+) get priority at registration.",
  "Walk-ins are seen after booked patients.",
];

/** The knowledge base as compact text for the model's instructions. */
export function knowledgeText(): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const docs = DOCTORS_KB.map((d) => `- ${d.name} [id: ${d.id}] — ${d.department}, ${d.qualification}. ${d.kind === "visiting" ? `VISITING on ${d.visitDates!.join(", ")}` : `OP days: ${d.opDays!.map((x) => days[x]).join(", ")}`}; timings ${d.timings}; fee ₹${d.fee}; ${d.perDay}/day. ${d.notes ?? ""}`).join("\n");
  const svc = SERVICES.map((s) => `- ${s.name}: ${s.price ? `₹${s.price}` : ""} ${s.notes}`).join("\n");
  const pk = PACKAGES.map((p) => `- ${p.name}: ₹${p.price} — ${p.includes}`).join("\n");
  const info = Object.entries(HOSPITAL_INFO).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  return `HOSPITAL\n${info}\n\nDOCTORS\n${docs}\n\nSERVICES\n${svc}\n\nPACKAGES\n${pk}\n\nINSURANCE\n- Cashless: ${INSURANCE.cashless.join(", ")}\n- ${INSURANCE.government}\n- ${INSURANCE.employees}\n- ${INSURANCE.notes}\n\nPOLICIES\n${POLICIES.map((p) => `- ${p}`).join("\n")}`;
}
