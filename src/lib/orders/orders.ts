// Order lookup. The demo uses local sample orders; a Zoho (or Supabase) source can
// implement the same OrderSource interface later without touching the workflow.

import { PATIENT_CALLS, doctorFor } from "../hospital/data";

export interface OrderItem {
  sku: string;
  nameEn: string;
  /** Native-script name, spoken by the agent (Bulbul pronounces native script best). */
  nameTe: string;
  /** Romanized / alternate spellings customers or STT may use. */
  aliases: string[];
  qty: string;
  price: number; // INR, whole rupees
}

export interface Order {
  id: string;
  customerName: string;
  phoneMasked: string;
  city: string;
  items: OrderItem[];
  /** Which conversation runs for this call. Default: shop order confirmation. */
  workflow?: "shop" | "hospital";
  status: "pending_confirmation" | "confirmed" | "change_requested" | "cancel_requested" | "callback" | "staff_followup";
  placedAt: string;
}

export interface OrderSource {
  list(): Promise<Order[]>;
  get(id: string): Promise<Order | null>;
}

/** Total is always computed by the app from line items — never taken from the model. */
export function orderTotal(order: Order): number {
  return order.items.reduce((sum, it) => sum + it.price, 0);
}

export const CATALOG_ALIASES: Record<string, string[]> = {
  pootharekulu: ["పూతరేకులు", "పూతరేకు", "pootharekulu", "pootarekulu", "putharekulu", "putarekulu", "pootharekalu", "putharekalu"],
  kaja: ["కాజా", "కాజాలు", "kaja", "kaaja", "khaja", "kajalu"],
  avakaya: ["ఆవకాయ", "avakaya", "aavakaya", "avakai", "mango pickle"],
  gongura: ["గోంగూర", "gongura", "gongoora"],
  ariselu: ["అరిసెలు", "అరిసె", "ariselu", "arisalu", "ariselu"],
  sunnundalu: ["సున్నుండలు", "సున్నుండ", "sunnundalu", "sunnunda", "sunundalu"],
  gavvalu: ["గవ్వలు", "బెల్లం గవ్వలు", "gavvalu", "bellam gavvalu"],
};

const LEGACY_ORDERS: Order[] = [
  {
    id: "GB-1042",
    customerName: "S. Lakshmi",
    phoneMasked: "+91 98xxxxxx21",
    city: "Rajahmundry",
    placedAt: "2026-11-16T10:12:00+05:30",
    status: "pending_confirmation",
    items: [
      { sku: "pootharekulu", nameEn: "Pootharekulu", nameTe: "పూతరేకులు", aliases: CATALOG_ALIASES.pootharekulu, qty: "1 box", price: 420 },
      { sku: "kaja", nameEn: "Kaja", nameTe: "కాజా", aliases: CATALOG_ALIASES.kaja, qty: "500 g", price: 220 },
    ],
  },
  {
    id: "GB-1043",
    customerName: "K. Ravi Kumar",
    phoneMasked: "+91 90xxxxxx07",
    city: "Kakinada",
    placedAt: "2026-11-16T12:40:00+05:30",
    status: "pending_confirmation",
    items: [
      { sku: "avakaya", nameEn: "Avakaya pickle", nameTe: "ఆవకాయ", aliases: CATALOG_ALIASES.avakaya, qty: "500 g", price: 380 },
      { sku: "gongura", nameEn: "Gongura pickle", nameTe: "గోంగూర పచ్చడి", aliases: CATALOG_ALIASES.gongura, qty: "250 g", price: 210 },
    ],
  },
  {
    id: "GB-1044",
    customerName: "P. Swathi",
    phoneMasked: "+91 99xxxxxx58",
    city: "Bhimavaram",
    placedAt: "2026-11-17T09:05:00+05:30",
    status: "pending_confirmation",
    items: [
      { sku: "ariselu", nameEn: "Ariselu", nameTe: "అరిసెలు", aliases: CATALOG_ALIASES.ariselu, qty: "1 kg", price: 560 },
      { sku: "sunnundalu", nameEn: "Sunnundalu", nameTe: "సున్నుండలు", aliases: CATALOG_ALIASES.sunnundalu, qty: "500 g", price: 340 },
      { sku: "gavvalu", nameEn: "Bellam gavvalu", nameTe: "బెల్లం గవ్వలు", aliases: CATALOG_ALIASES.gavvalu, qty: "250 g", price: 180 },
    ],
  },
];

const SAMPLE_ORDERS: Order[] = [
  {
    id: "GB-DEMO-1043", customerName: "Ananya", phoneMasked: "+91 xxxxxx0042",
    city: "Kakinada", placedAt: "2026-11-17T09:05:00+05:30", status: "pending_confirmation",
    items: [
      { sku: "avakaya", nameEn: "Avakaya Pickle", nameTe: "ఆవకాయ", aliases: CATALOG_ALIASES.avakaya, qty: "500 g", price: 380 },
      { sku: "gongura", nameEn: "Gongura Pickle", nameTe: "గోంగూర", aliases: CATALOG_ALIASES.gongura, qty: "250 g", price: 210 },
    ],
  },
];

/** Hospital patient calls shown in the same call list (one "item" = the checkup, price = fee). */
const HOSPITAL_CALLS: Order[] = PATIENT_CALLS.map((p) => {
  const d = doctorFor(p);
  const dates = d.visits.map((v) => v.date).join(", ");
  return {
    id: p.id, customerName: p.direction === "inbound" ? "📞 Incoming call (anyone)" : `${p.patientName} · new-visit alert`,
    phoneMasked: p.phoneMasked, city: p.village, workflow: "hospital",
    placedAt: `${d.visits[0].date}T09:00:00+05:30`, status: "pending_confirmation",
    items: [{ sku: d.id, nameEn: `${d.name} (${d.specialty}) · ${dates}`, nameTe: `${d.nameTe} · ${dates}`, aliases: [], qty: "1 visit", price: d.fee }],
  };
});

export class SampleOrderSource implements OrderSource {
  async list() {
    return [...SAMPLE_ORDERS, ...HOSPITAL_CALLS].map((o) => structuredClone(o));
  }
  async get(id: string) {
    const o = [...SAMPLE_ORDERS, ...HOSPITAL_CALLS, ...LEGACY_ORDERS].find((x) => x.id === id);
    return o ? structuredClone(o) : null;
  }
}

// Later: export class ZohoOrderSource implements OrderSource { ... }
export const orderSource: OrderSource = new SampleOrderSource();

/** All product words the matcher treats as "specific change detail". */
export const ALL_PRODUCT_WORDS: string[] = Object.values(CATALOG_ALIASES).flat();
