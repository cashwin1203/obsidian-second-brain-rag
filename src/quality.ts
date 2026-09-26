import type { EvidenceRecord } from "./contracts.js";

const REFUSAL_PATTERNS = [
  /insufficient evidence/i,
  /not enough (?:information|evidence)/i,
  /cannot answer\b.*\b(?:from|based on)/i,
  /can't answer\b.*\b(?:from|based on)/i,
];

const INJECTION_PATTERNS = [
  /ignore (?:all |any )?(?:previous|prior|system|developer) instructions?/i,
  /reveal (?:the )?(?:system prompt|developer message|api key|secret)/i,
  /you are (?:chatgpt|an? ai|the system)/i,
  /(?:call|invoke|use) (?:an? )?(?:unknown|write|delete) tool/i,
  /exfiltrat(?:e|ion)/i,
];

export interface AnswerQuality {
  acceptable: boolean;
  refusal: boolean;
  validCitations: string[];
  unsupportedCitations: string[];
  uncitedSentences: string[];
}

export function isRefusal(answer: string) {
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(answer));
}

export function validateAnswer(answer: string, evidence: EvidenceRecord[]): AnswerQuality {
  const validIds = new Set(evidence.map((source) => source.id));
  const citedIds = [...answer.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]);
  const validCitations = [...new Set(citedIds.filter((id) => validIds.has(id)))];
  const unsupportedCitations = [...new Set(citedIds.filter((id) => !validIds.has(id)))];
  const refusal = isRefusal(answer);
  const sentences = answer
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20 && !isRefusal(sentence));
  const uncitedSentences = sentences.filter((sentence) => {
    const ids = [...sentence.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]);
    return !ids.some((id) => validIds.has(id));
  });
  const acceptable = refusal
    ? unsupportedCitations.length === 0 && uncitedSentences.length === 0
    : evidence.length > 0 && validCitations.length > 0 && unsupportedCitations.length === 0 && uncitedSentences.length === 0;
  return { acceptable, refusal, validCitations, unsupportedCitations, uncitedSentences };
}

export function findPromptInjectionSignals(text: string) {
  return INJECTION_PATTERNS
    .filter((pattern) => pattern.test(text))
    .map((pattern) => pattern.source);
}
