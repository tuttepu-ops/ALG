// Fictional product descriptions for the local demo. Verify against labels before launch.
export const productFacts = {
  pootharekulu: "పలుచని బియ్యపు పొరలు, బెల్లం, నెయ్యితో చేసే తీపి. Sample recipeలో dairy ఉంది.",
  kaja: "పాకంలో ముంచిన పొరల మిఠాయి. Sample recipeలో గోధుమ పిండి ఉంది.",
  avakaya: "మామిడికాయ, ఆవాలు, కారం కలిపిన పచ్చడి. Sample recipeలో mustard ఉంది.",
  gongura: "గోంగూర ఆకులతో చేసే పుల్లటి పచ్చడి.",
  ariselu: "బియ్యపు పిండి, బెల్లంతో చేసే తీపి. Sample recipeలో నువ్వులు ఉన్నాయి.",
  sunnundalu: "మినప్పప్పు, బెల్లం, నెయ్యితో చేసే లడ్డూ. Sample recipeలో dairy ఉంది.",
  "karam-podi": "ఎండు మిరపకాయలు, పప్పులతో చేసే కారంపొడి.",
};

export function storeKnowledge(text: string, skus: (keyof typeof productFacts)[]): string | null {
  if (/allerg|gluten.free|nut.free|dairy.free|vegan|అలర్జీ|అలెర్జీ/u.test(text)) {
    return "Allergy లేదా dietary requirement ఉంటే exact ingredients, packing label staffతో verify చేయాలి అండి. Review request పెట్టాలా?";
  }
  if (/ingredient|made (?:of|with|from)|taste|spicy|what is the difference|దేనితో|రుచి|ఎలా చేస్తారు|కారంగా/u.test(text) && skus.length) {
    return skus.slice(0, 3).map((sku) => productFacts[sku]).join(" ");
  }
  if (/expiry|expiration|shelf.life|best before|storage|refrigerat|ఎన్ని రోజులు నిల్వ|ఎలా నిల్వ/u.test(text)) {
    return "Storage, best-before date కోసం మీ pack మీద label చూడండి అండి. Batch details verify చేయడానికి Review request పెట్టాలా?";
  }
  if (/track|waybill|tracking|ఎక్కడ ఉంది/u.test(text)) {
    return "ఈ demoలో live tracking details అందుబాటులో లేవు అండి. Review request పెట్టాలా?";
  }
  if (/international|overseas|outside india|ship to (?:us|usa|uk|canada)/u.test(text)) {
    return "ఈ demoలో selected Indian PIN codesకి మాత్రమే delivery check చేయగలను అండి.";
  }
  if (/coupon|discount|promo|gift (?:wrap|hamper)|bulk order|wholesale/u.test(text)) {
    return "ఈ requestకి confirmed details లేవు అండి. Review request పెట్టాలా?";
  }
  return null;
}
