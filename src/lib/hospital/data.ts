// SAI VISWAS HOSPITAL — the details the agent may say. Anything not here goes to reception.
// Edit this file to change the doctor, dates, fee or capacity; the agent never invents facts.

export interface Hospital {
  name: string;
  /** The agent's name ("Ravi"). */
  agentName: string;
  /** How the agent says its name and the hospital in Telugu lines. */
  agentNameTe: string;
  spokenNameTe: string;
  /** What patients should bring. */
  bring: { te: string; en: string };
  /** Hospital address / exact timings are sent on WhatsApp after booking; null = "WhatsApp + reception". */
  address: string | null;
}

export interface DoctorVisit {
  /** YYYY-MM-DD (local). */
  date: string;
  /** Appointments that day. */
  capacity: number;
  /** Already booked before the agent (e.g. by reception). */
  booked: number;
}

export interface VisitingDoctor {
  id: string;
  name: string; // "Dr. Viswanath"
  nameTe: string; // "Dr. విశ్వనాథ్ గారు"
  specialty: string; // "Cardiologist"
  specialtyTe: string; // "cardiologist" (said in English, as people do)
  visits: DoctorVisit[];
  /** Consultation fee in rupees. */
  fee: number;
  /** "10:00–14:00" if known; null → "exact timings come on WhatsApp after booking". */
  hours: string | null;
}

export interface PatientCall {
  id: string;
  /** outbound = we call the patient (new-visit alert); inbound = a patient calls the hospital number. */
  direction: "outbound" | "inbound";
  /** Known for outbound calls; inbound callers are asked their name. */
  patientName: string | null;
  /** "లక్ష్మి గారు" — how the agent addresses them in Telugu. */
  nameTe: string | null;
  /** "Lakshmi" — in English replies. */
  nameEn: string | null;
  phoneMasked: string;
  village: string;
  /** Why they are on the list (outbound), from the hospital's records. */
  reason: string;
  doctorId: string;
}

export const HOSPITAL: Hospital = {
  name: "Sai Viswas Hospital",
  agentName: "Ravi",
  agentNameTe: "రవి",
  spokenNameTe: "సాయి విశ్వాస్ hospital",
  bring: {
    te: "old reports, scanning reports, current medication details ఏమున్నా",
    en: "any old reports, scanning reports and your current medication details",
  },
  address: null,
};

export const DOCTORS: VisitingDoctor[] = [
  {
    id: "dr-viswanath",
    name: "Dr. Viswanath",
    nameTe: "Dr. విశ్వనాథ్ గారు",
    specialty: "Cardiologist",
    specialtyTe: "cardiologist",
    visits: [
      { date: "2026-11-22", capacity: 50, booked: 0 },
      { date: "2026-11-25", capacity: 50, booked: 0 },
    ],
    fee: 100,
    hours: null,
  },
];

export const PATIENT_CALLS: PatientCall[] = [
  {
    id: "HSP-ALERT-3001", direction: "outbound",
    patientName: "Lakshmi Devi", nameTe: "లక్ష్మి గారు", nameEn: "Lakshmi",
    phoneMasked: "+91 xxxxxx3001", village: "Samalkot",
    reason: "Heart patient — asked to be told when a cardiologist visits", doctorId: "dr-viswanath",
  },
  {
    id: "HSP-ALERT-3002", direction: "outbound",
    patientName: "Venkata Rao", nameTe: "వెంకట్రావు గారు", nameEn: "Venkata Rao",
    phoneMasked: "+91 xxxxxx3002", village: "Peddapuram",
    reason: "Follow-up due after last cardiology checkup", doctorId: "dr-viswanath",
  },
  {
    id: "HSP-INBOUND", direction: "inbound",
    patientName: null, nameTe: null, nameEn: null,
    phoneMasked: "Caller ID (from the phone line)", village: "—",
    reason: "Incoming call to the hospital number", doctorId: "dr-viswanath",
  },
];

export function doctorFor(call: PatientCall): VisitingDoctor {
  const d = DOCTORS.find((x) => x.id === call.doctorId);
  if (!d) throw new Error(`Unknown doctor ${call.doctorId}`);
  return d;
}

/** Each visit date with the appointments still free, given bookings made by other calls. */
export function freeDates(d: VisitingDoctor, taken: Record<string, number> = {}): { date: string; free: number }[] {
  return d.visits.map((v) => ({ date: v.date, free: v.capacity - v.booked - (taken[v.date] ?? 0) }));
}
