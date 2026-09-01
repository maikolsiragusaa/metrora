const REDACTION = '[redacted]'

// Keep this list semantic and deliberately narrow. It complements the
// model-facing projection: ordinary words such as "system" or "schema" are
// not sensitive on their own.
const DISCLOSURE_PATTERNS: readonly RegExp[] = [
  /\b(?:advisor[-_](?:ui[-_]context|planning[-_]draft|synthesis[-_]draft|guard[-_]plan|verified[-_]claim[-_]atom)(?:[-_]v?\d+)?)\b/iu,
  /\badvisor(?:UiContext|PlanningDraft|SynthesisDraft|GuardPlan|VerifiedClaimAtom)(?:[-_]?v?\d+)?\b/iu,
  /\b(?:contract|schema)\s*version\b/iu,
  /\b(?:contract|schema)Version\b/iu,
  /\b(?:current\s*surface|question\s*family|requested\s*evidence\s*domains|fallback\s*plan|authorization\s*posture)\b/iu,
  /\b(?:currentSurface|questionFamily|requestedEvidenceDomains|fallbackPlan|authorizationPosture|relevantReferences)\b/iu,
  /\b(?:turn\s*kind|question\s*family|requested\s+evidence\s+domains|tool\s*requests|presentation\s+intent|expert\s+detail\s+requested)\b/iu,
  /\b(?:turnKind|questionFamily|requestedEvidenceDomains|toolRequests|presentationIntent|expertDetailRequested)\b/iu,
  /\b(?:camp[oi]|chiav[ie]|propriet[aà]|metadati)\s+(?:intern[oi]|nascost[ie]|di\s+pianificazione|del\s+planning)\b/iu,
  /\b(?:tipo\s+di\s+turno|famiglia\s+della\s+domanda|domini\s+di\s+evidenza\s+richiesti|richieste\s+di\s+strumenti|intento\s+di\s+presentazione|dettaglio\s+esperto\s+richiesto)\b/iu,
  /\b(?:internal|hidden|private|raw)\s+(?:schema|contract|guard|metadata|context|instructions?|rules?|reasoning|thoughts?)\b/iu,
  /\b(?:internal|hidden|private)\s+(?:policy|implementation|prompting|configuration|details?)\b/iu,
  /\b(?:guard|schema|contract|metadata|context)\s+(?:object|plan|internals?|details?)\b/iu,
  /\b(?:harness\s*(?:\/|and)\s*tools?|tools?\s*(?:\/|and)\s*harness)\s+boundary\b/iu,
  /\b(?:system|developer|hidden|internal)\s+(?:prompt|instructions?|message|rules?)\b/iu,
  /\b(?:reveal|show|quote|repeat|paraphrase|disclose)\b[^\n]{0,96}\b(?:system|developer|hidden|internal)\b[^\n]{0,48}\b(?:prompt|instructions?|message|rules?)\b/iu,
  /\b(?:instructions?|rules?)\s+(?:i\s+was\s+(?:given|told)|i\s+received|from\s+(?:the\s+)?system)\b/iu,
  /\b(?:chain[- ]of[- ]thought|scratchpad|private\s+reasoning|internal\s+reasoning)\b/iu,
  /\b(?:prompt|istruzioni?|messaggio)\s+(?:di|del|della)?\s*(?:sistema|sviluppatore|intern[oaie]|nascost[oaie])\b/iu,
  /\b(?:sistema|sviluppatore|intern[oaie]|nascost[oaie])\s+(?:prompt|istruzioni?|messaggio)\b/iu,
  /\b(?:systemPrompt|developerMessage|hiddenPrompt|implementationPrompt|chainOfThought|internalScratchpad|rawProviderPayload|rawToolPayload|guardContract|guardPlan|toolContract|evidencePath|evidenceRef)\b/iu,
  /\b(?:messaggio|risposta|contenuto|testo)\s+(?:di|del|della)\s+sistema\b/iu,
  /\b(?:istruzioni?|regole)\s+(?:interne|nascoste|private|del\s+sistema|di\s+sistema)\b/iu,
  /\b(?:rivela|mostra|riporta|ripeti|parafrasa|condividi)\b[^\n]{0,96}\b(?:prompt|istruzioni?|regole)\b[^\n]{0,64}\b(?:sistema|sviluppatore|interne|nascoste)\b/iu,
  /\b(?:catena\s+di\s+pensiero|ragionamento\s+(?:interno|privato|nascosto)|appunti\s+(?:interni|privati|nascosti))\b/iu,
  /\b(?:schema|contratto|guard|metadati|contesto)\s+(?:intern[oaie]|nascost[oaie]|di\s+implementazione)\b/iu,
  /\b(?:risposta|payload|dati)\s+(?:grezz[oaie]|del\s+provider|del\s+tool)\b/iu,
  /\b(?:postura|autorizzazione)\s+(?:di\s+autorizzazione|di\s+lettura|del\s+confine|del\s+boundary)\b/iu,
]

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/([a-z])([A-Z])/gu, '$1 $2')
}

function matches(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0
  const matched = pattern.test(value)
  pattern.lastIndex = 0
  return matched
}

export function containsAdvisorInternalDisclosure(value: string): boolean {
  if (!value) return false
  const normalized = normalize(value)
  return DISCLOSURE_PATTERNS.some(pattern => matches(pattern, value) || matches(pattern, normalized))
}

export function redactAdvisorInternalDisclosure(value: string): string {
  let result = value
  for (const pattern of DISCLOSURE_PATTERNS) {
    pattern.lastIndex = 0
    result = result.replace(pattern, REDACTION)
    pattern.lastIndex = 0
  }
  return result
}
