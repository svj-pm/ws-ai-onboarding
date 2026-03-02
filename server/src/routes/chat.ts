import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  createSession,
  getSession,
  updateSession,
} from '../state/sessions';
import { chat, applyExtraction, INITIAL_GREETING } from '../services/claude';
import type { ChatRequest, ChatMessage, ExtractionResult, KycRecord, SuitabilityAssessment, SessionMetrics } from '../types';

const router = Router();

// Counts filled leaf values in a record (strings, numbers, booleans, non-empty arrays).
// Used to track cumulative extraction progress across turns.
function countLeafFields(obj: unknown): number {
  if (obj === null || obj === undefined) return 0;
  if (Array.isArray(obj)) return obj.length > 0 ? 1 : 0;
  if (typeof obj === 'object') {
    return Object.values(obj as Record<string, unknown>).reduce(
      (sum: number, v) => sum + countLeafFields(v),
      0
    );
  }
  if (typeof obj === 'string') return obj.length > 0 ? 1 : 0;
  return 1; // number or boolean
}

// ─── Completion (20 required fields) ─────────────────────────────────────────

// Returns true if a field value has been provided. false counts as filled for booleans.
function isValueFilled(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

// Tracks exactly the 20 required fields for a Canadian investment account.
// Mirrors the identical function in the frontend ComplianceRecord.tsx.
function computeCompletionFromRequiredFields(
  kyc: KycRecord,
  suit: SuitabilityAssessment
): { filled: number; pct: number } {
  const pi = kyc.personal_information;
  const addr = pi?.residential_address;
  const ctr = kyc.citizenship_and_tax_residency;
  const emp = kyc.employment_and_income;
  const fp = kyc.financial_profile;
  const sof = kyc.source_of_funds;
  const pep = kyc.pep_and_sanctions;
  const pa = kyc.purpose_and_activity;
  const rp = suit.risk_profile;
  const ik = suit.investment_knowledge;
  const io = suit.investment_objectives;

  const addressFilled =
    isValueFilled(addr?.city) &&
    isValueFilled(addr?.province_territory) &&
    isValueFilled(addr?.postal_code);

  const required: boolean[] = [
    // KYC fields (13)
    isValueFilled(pi?.legal_first_name),
    isValueFilled(pi?.legal_last_name),
    isValueFilled(pi?.date_of_birth),
    addressFilled,
    isValueFilled(pi?.phone_number),
    isValueFilled(pi?.email_address),
    isValueFilled(pi?.sin_provided),
    isValueFilled(ctr?.canadian_tax_resident),
    isValueFilled(ctr?.canadian_citizen),
    isValueFilled(ctr?.us_person),
    isValueFilled(emp?.employment_status),
    isValueFilled(sof?.primary_funding_source),
    isValueFilled(pep?.is_pep),
    // Suitability fields (7)
    isValueFilled(emp?.annual_income_range),
    isValueFilled(fp?.net_worth_range),
    isValueFilled(fp?.liquid_assets_range),
    isValueFilled(ik?.self_assessed_level) || isValueFilled(ik?.assessed_knowledge_level),
    isValueFilled(rp?.assessed_risk_tolerance) || isValueFilled(rp?.stated_risk_tolerance),
    isValueFilled(io?.primary_objective) || isValueFilled(pa?.account_purpose),
    isValueFilled(io?.time_horizon) || isValueFilled(pa?.investment_time_horizon),
  ];

  const filled = required.filter(Boolean).length;
  return { filled, pct: Math.min(100, Math.round((filled / 20) * 100)) };
}

// ─── Turn Summary Logger ──────────────────────────────────────────────────────

// Maps dot-notation extraction keys → [Category, Field Name] for display.
const FIELD_LABELS: Record<string, [string, string]> = {
  'personal_information.legal_first_name':                              ['Personal Info',   'First Name'],
  'personal_information.legal_last_name':                               ['Personal Info',   'Last Name'],
  'personal_information.date_of_birth':                                 ['Personal Info',   'Date of Birth'],
  'personal_information.estimated_birth_year':                          ['Personal Info',   'Est. Birth Year'],
  'personal_information.residential_address.city':                      ['Personal Info',   'City'],
  'personal_information.residential_address.province_territory':        ['Personal Info',   'Province'],
  'personal_information.residential_address.postal_code':               ['Personal Info',   'Postal Code'],
  'personal_information.email_address':                                  ['Personal Info',   'Email'],
  'personal_information.phone_number':                                   ['Personal Info',   'Phone'],
  'personal_information.sin_provided':                                   ['Personal Info',   'SIN Provided'],
  'citizenship_and_tax_residency.canadian_citizen':                     ['Citizenship',     'Canadian Citizen'],
  'citizenship_and_tax_residency.canadian_tax_resident':                ['Tax Residency',   'Canadian Tax Resident'],
  'citizenship_and_tax_residency.us_person':                            ['Citizenship',     'US Person'],
  'employment_and_income.employment_status':                            ['Employment',      'Status'],
  'employment_and_income.employer_name':                                ['Employment',      'Employer'],
  'employment_and_income.job_title':                                    ['Employment',      'Job Title'],
  'employment_and_income.industry':                                     ['Employment',      'Industry'],
  'employment_and_income.annual_income_range':                          ['Employment',      'Annual Income'],
  'employment_and_income.is_insider_or_control_person':                 ['Employment',      'Insider/Control Person'],
  'financial_profile.net_worth_range':                                  ['Financial',       'Net Worth'],
  'financial_profile.liquid_assets_range':                              ['Financial',       'Liquid Assets'],
  'financial_profile.fixed_monthly_expenses':                           ['Financial',       'Monthly Expenses'],
  'financial_profile.outstanding_debt':                                 ['Financial',       'Outstanding Debt'],
  'source_of_funds.primary_funding_source':                             ['Source of Funds', 'Primary Source'],
  'source_of_funds.funding_source_details':                             ['Source of Funds', 'Details'],
  'source_of_funds.initial_deposit_range':                              ['Source of Funds', 'Initial Deposit'],
  'source_of_funds.expected_annual_deposits':                           ['Source of Funds', 'Annual Deposits'],
  'pep_and_sanctions.is_pep':                                           ['PEP & Sanctions', 'Is PEP'],
  'pep_and_sanctions.pep_type':                                         ['PEP & Sanctions', 'PEP Type'],
  'pep_and_sanctions.is_family_of_pep':                                 ['PEP & Sanctions', 'Family of PEP'],
  'pep_and_sanctions.is_close_associate_of_pep':                        ['PEP & Sanctions', 'Close Associate'],
  'purpose_and_activity.account_purpose':                               ['Account Purpose', 'Goals'],
  'purpose_and_activity.investment_time_horizon':                       ['Account Purpose', 'Time Horizon'],
  'purpose_and_activity.expected_trading_frequency':                    ['Account Purpose', 'Trading Frequency'],
  'purpose_and_activity.third_party_involvement':                       ['Account Purpose', 'Third Party'],
  'risk_profile.stated_risk_tolerance':                                 ['Risk Profile',    'Stated Tolerance'],
  'risk_profile.assessed_risk_tolerance':                               ['Risk Profile',    'Assessed Tolerance'],
  'risk_profile.behavioral_risk_signals.loss_reaction':                 ['Risk Profile',    'Loss Reaction'],
  'risk_profile.behavioral_risk_signals.safety_first_language':         ['Risk Profile',    'Safety First Language'],
  'risk_profile.behavioral_risk_signals.experience_with_volatility':   ['Risk Profile',    'Volatility Experience'],
  'risk_profile.risk_mismatch_detected':                                ['Risk Profile',    'Mismatch Detected'],
  'risk_profile.risk_mismatch_explanation':                             ['Risk Profile',    'Mismatch Explanation'],
  'investment_knowledge.self_assessed_level':                           ['Inv. Knowledge',  'Self-Assessed Level'],
  'investment_knowledge.assessed_knowledge_level':                      ['Inv. Knowledge',  'Assessed Level'],
  'investment_knowledge.demonstrated_knowledge_signals.has_prior_investment_experience': ['Inv. Knowledge', 'Prior Experience'],
  'investment_objectives.primary_objective':                            ['Inv. Objectives', 'Primary Objective'],
  'investment_objectives.time_horizon':                                 ['Inv. Objectives', 'Time Horizon'],
  'investment_objectives.liquidity_needs':                              ['Inv. Objectives', 'Liquidity Needs'],
  'investment_objectives.specific_goals':                               ['Inv. Objectives', 'Specific Goals'],
  'suitability_determination.suitable_account_types':                   ['Recommendation',  'Account Types'],
  'suitability_determination.recommended_portfolio_approach':           ['Recommendation',  'Portfolio Approach'],
  'suitability_determination.suitability_score':                        ['Recommendation',  'Suitability Score'],
  'suitability_determination.suitability_rationale':                    ['Recommendation',  'Rationale'],
  'suitability_determination.recommended_asset_allocation.equities_pct':     ['Recommendation', 'Equities %'],
  'suitability_determination.recommended_asset_allocation.fixed_income_pct': ['Recommendation', 'Fixed Income %'],
  'suitability_determination.recommended_asset_allocation.alternatives_pct': ['Recommendation', 'Alternatives %'],
};

const FLAG_TYPE_LABEL: Record<string, string> = {
  pep_detected:                'PEP Detected',
  contradictory_information:   'Contradictory Info',
  high_risk_jurisdiction:      'High Risk Jurisdiction',
  unusual_source_of_funds:     'Unusual Source of Funds',
  non_resident_tax_complexity: 'Non-Resident Tax Complexity',
  suitability_mismatch:        'Suitability Mismatch',
  incomplete_information:      'Incomplete Information',
  sanctions_screening_required:'Sanctions Screening Required',
  age_eligibility_concern:     'Age Eligibility Concern',
};

// Recursively flattens a nested object to [dotKey, value] pairs.
// Arrays are kept as leaf values (not further expanded).
function flattenObject(obj: unknown, prefix = ''): Array<[string, unknown]> {
  if (obj === null || obj === undefined) return [];
  if (Array.isArray(obj) || typeof obj !== 'object') {
    return prefix ? [[prefix, obj]] : [];
  }
  const result: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v) || typeof v !== 'object') {
      result.push([key, v]);
    } else {
      result.push(...flattenObject(v, key));
    }
  }
  return result;
}

function formatGoalObject(obj: Record<string, unknown>): string {
  const label = String(obj.goal_type ?? 'unknown');
  const parts: string[] = [obj.priority ? String(obj.priority) : ''];
  if (obj.target_amount) parts.push(String(obj.target_amount));
  if (obj.target_date) parts.push(`by ${obj.target_date}`);
  const detail = parts.filter(Boolean).join(', ');
  return detail ? `${label} (${detail})` : label;
}

function formatFieldValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (value.length === 0) return '(empty)';
    if (typeof value[0] === 'object' && value[0] !== null) {
      const items = value as Record<string, unknown>[];
      if ('goal_type' in items[0]) {
        return items.map(formatGoalObject).join(', ');
      }
      const json = JSON.stringify(value);
      return json.length > 80 ? json.slice(0, 77) + '...' : json;
    }
    return value.join(', ');
  }
  return String(value);
}

function labelForKey(dotKey: string): [string, string] {
  if (FIELD_LABELS[dotKey]) return FIELD_LABELS[dotKey];
  // Fallback: derive category/field from the key segments
  const parts = dotKey.split('.');
  const toTitle = (s: string) =>
    s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return [toTitle(parts[0]), toTitle(parts[parts.length - 1])];
}

/**
 * Computes the true delta between the current extraction and what was already logged
 * in previous turns. Returns only fields that are new or changed.
 * Each entry is [dotKey, formattedValue, isUpdated].
 */
function computeDeltaFields(
  extraction: ExtractionResult,
  previousFields: Map<string, string>
): Array<[string, string, boolean]> {
  const current: Array<[string, unknown]> = [
    ...flattenObject(extraction.kyc_updates),
    ...flattenObject(extraction.suitability_updates),
  ];

  const delta: Array<[string, string, boolean]> = [];
  for (const [key, value] of current) {
    const formatted = formatFieldValue(value);
    if (!previousFields.has(key)) {
      delta.push([key, formatted, false]); // new field
    } else if (previousFields.get(key) !== formatted) {
      delta.push([key, formatted, true]);  // updated field
    }
    // else: unchanged repeat — skip
  }
  return delta;
}

function logTurnSummary(
  turnNumber: number,
  sessionId: string,
  deltaFields: Array<[string, string, boolean]>,
  escalationFlags: ExtractionResult['escalation_flags'],
  filledRequired: number
): void {
  const BOX = '═══════════════════════════════════════════════════════';
  const timestamp = new Date().toLocaleString('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });
  const shortId = sessionId.slice(0, 8);

  const newFlags = escalationFlags;
  const hasFlags = newFlags.length > 0;

  const lines: string[] = [''];
  lines.push(BOX);
  lines.push(` Turn ${turnNumber} | ${timestamp} | Session: ${shortId}...`);
  lines.push(BOX);

  if (deltaFields.length > 0) {
    lines.push(' NEW FIELDS EXTRACTED:');
    for (const [key, display, isUpdated] of deltaFields) {
      const [category, fieldName] = labelForKey(key);
      const marker = (key === 'risk_profile.risk_mismatch_detected' && display === 'Yes') ? '⚠' : ' ';
      const suffix = isUpdated ? '  [updated]' : '';
      lines.push(`  ${marker} ${category.padEnd(16)} → ${fieldName}: ${display}${suffix}`);
    }
  } else {
    lines.push(' NEW FIELDS EXTRACTED: No new fields this turn');
  }

  lines.push('');

  if (hasFlags) {
    lines.push(' ⚠ ESCALATION FLAGS:');
    for (const flag of newFlags) {
      const sev = flag.severity.toUpperCase();
      const label = FLAG_TYPE_LABEL[flag.flag_type] ?? flag.flag_type;
      lines.push(`   [${sev}] ${label} — ${flag.description}`);
    }
  } else {
    lines.push(' ESCALATION FLAGS: None');
  }

  lines.push('');
  const pct = Math.min(100, Math.round((filledRequired / 20) * 100));
  lines.push(` COMPLETION: ${pct}% (${filledRequired}/20 required fields)`);
  lines.push(BOX);

  console.log(lines.join('\n'));
}

// ─── Phase Transition Detection ───────────────────────────────────────────────

const PHASE2_TRANSITION_PHRASES = [
  'your legal name',
  'legal name',
  'for compliance',
  'for regulatory',
  'regulatory purposes',
  'account setup',
  'set up your account',
  'complete your profile',
  'personal details',
  'officially set up',
  'formally',
  'compliance purposes',
  'open your account',
];

function isPhase2Transition(assistantMessage: string): boolean {
  const lower = assistantMessage.toLowerCase();
  return PHASE2_TRANSITION_PHRASES.some((phrase) => lower.includes(phrase));
}

// ─── Guardrail Checks ─────────────────────────────────────────────────────────

function runGuardrailChecks(
  metrics: SessionMetrics,
  turnNumber: number,
  extractionFound: boolean,
  extractionRetryFired: boolean,
  completionPct: number,
  turnLatencyMs: number,
  deltaFields: Array<[string, string, boolean]>,
  userMessage: string
): Array<{ turn: number; type: string; message: string }> {
  const alerts: Array<{ turn: number; type: string; message: string }> = [];

  // 1. Extraction missing — no block found and retry also failed
  if (!extractionFound && extractionRetryFired) {
    alerts.push({
      turn: turnNumber,
      type: 'extraction_failure',
      message: 'No extraction block found even after retry',
    });
  }

  // 2. Stalled progress — last 3 turns all yielded 0 new fields
  const recentFields = metrics.fieldsPerTurn.slice(-3);
  if (recentFields.length === 3 && recentFields.every((n) => n === 0)) {
    alerts.push({
      turn: turnNumber,
      type: 'stalled_progress',
      message: 'No new fields extracted for 3 consecutive turns',
    });
  }

  // 3. Excessive turns — more than 20 turns and not 100% complete
  if (turnNumber > 20 && completionPct < 100) {
    alerts.push({
      turn: turnNumber,
      type: 'excessive_turns',
      message: `Conversation reached turn ${turnNumber} with only ${completionPct}% completion`,
    });
  }

  // 4. Consistency drift — field updated but user message doesn't reference it
  const updatedFields = deltaFields.filter(([, , isUpdated]) => isUpdated);
  if (updatedFields.length > 0) {
    const msgLower = userMessage.toLowerCase();
    for (const [key] of updatedFields) {
      // Derive searchable words from the field key (e.g. "annual_income_range" → ["annual", "income"])
      const keyWords = key.split('.').join('_').split('_').filter((w) => w.length > 3);
      const userMentionsField = keyWords.some((word) => msgLower.includes(word));
      if (!userMentionsField) {
        alerts.push({
          turn: turnNumber,
          type: 'consistency_drift',
          message: `Field "${key}" updated without apparent user correction`,
        });
        break; // one alert per turn is enough
      }
    }
  }

  // 5. High latency — turn's API latency exceeded 10000ms
  if (turnLatencyMs > 10000) {
    alerts.push({
      turn: turnNumber,
      type: 'high_latency',
      message: `API latency ${turnLatencyMs.toLocaleString('en-CA')}ms exceeded 10,000ms threshold`,
    });
  }

  return alerts;
}

// ─── Audit Summary Generator ──────────────────────────────────────────────────

// Formats machine-style or human-style money range strings into readable text.
// e.g. "under_25k" → "under $25K", "75k_to_100k" → "$75K-$100K", "$75K-$100K" → passes through
function formatMoneyRange(raw: string | undefined): string {
  if (!raw) return 'unknown';
  if (raw.includes('$') || raw.includes(' ')) return raw.replace(/_/g, ' ');
  const s = raw.toLowerCase();
  const underM = s.match(/^under[_]?(\d+)k?$/);
  if (underM) return `under $${underM[1]}K`;
  const overM = s.match(/^over[_]?(\d+)k?$/);
  if (overM) return `over $${overM[1]}K`;
  const rangeM = s.match(/^(\d+)k?[_]to[_](\d+)k?$/);
  if (rangeM) return `$${rangeM[1]}K-$${rangeM[2]}K`;
  return raw.replace(/_/g, ' ');
}

// Derives age from a YYYY-MM-DD date of birth string against 2026.
function ageFromDob(dob: string | undefined): number | null {
  if (!dob) return null;
  const year = parseInt(dob.split('-')[0], 10);
  return isNaN(year) ? null : 2026 - year;
}

// Builds a plain-text audit summary paragraph from session data.
// Called once when completion_status transitions to "complete".
// No Claude call — assembled entirely from already-extracted fields.
function buildConversationSummary(
  kyc: KycRecord,
  suit: SuitabilityAssessment,
  isHandoff = false,
): string {
  const pi  = kyc.personal_information;
  const ctr = kyc.citizenship_and_tax_residency;
  const emp = kyc.employment_and_income;
  const fp  = kyc.financial_profile;
  const sof = kyc.source_of_funds;
  const pep = kyc.pep_and_sanctions;
  const pa  = kyc.purpose_and_activity;
  const rp  = suit.risk_profile;
  const ik  = suit.investment_knowledge;
  const io  = suit.investment_objectives;
  const sd  = suit.suitability_determination;
  const flags = kyc.metadata.escalation_flags ?? [];

  // ── Identity ──────────────────────────────────────────────────────────────
  const firstName = pi?.legal_first_name ?? '';
  const lastName  = pi?.legal_last_name  ?? '';
  const fullName  = [firstName, lastName].filter(Boolean).join(' ') || 'Client';

  const age = ageFromDob(pi?.date_of_birth)
           ?? (pi?.estimated_birth_year != null ? 2026 - pi.estimated_birth_year : null);
  const ageStr = age != null ? `${age}-year-old` : '';

  const empStatus   = emp?.employment_status?.replace(/_/g, '-') ?? '';
  const jobTitle    = emp?.job_title ?? '';
  const employer    = emp?.employer_name;
  const employerStr = employer ? `at ${employer}` : '';

  const city     = pi?.residential_address?.city ?? '';
  const province = pi?.residential_address?.province_territory ?? '';
  const location = [city, province].filter(Boolean).join(', ');

  const identityParts = [fullName, 'is a', ageStr, empStatus, jobTitle, employerStr].filter(Boolean);
  let identitySentence = identityParts.join(' ');
  if (location) identitySentence += ` in ${location}`;
  identitySentence += '.';

  // ── Citizenship / tax ─────────────────────────────────────────────────────
  const citizenPart   = ctr?.canadian_citizen   === true  ? 'Canadian citizen'
                      : ctr?.canadian_citizen   === false ? 'non-Canadian citizen' : '';
  const taxPart       = ctr?.canadian_tax_resident === true  ? 'Canadian tax resident'
                      : ctr?.canadian_tax_resident === false ? 'not a Canadian tax resident' : '';
  const usPart        = ctr?.us_person === true  ? 'US person (FATCA)'
                      : ctr?.us_person === false ? 'not a US person' : '';
  const citizenStr = [citizenPart, taxPart, usPart].filter(Boolean).join(', ');
  const citizenshipSentence = citizenStr
    ? citizenStr.charAt(0).toUpperCase() + citizenStr.slice(1) + '.'
    : '';

  // ── Financials ────────────────────────────────────────────────────────────
  const income   = formatMoneyRange(emp?.annual_income_range);
  const netWorth = formatMoneyRange(fp?.net_worth_range);
  const liquid   = formatMoneyRange(fp?.liquid_assets_range);
  const source   = (sof?.primary_funding_source ?? 'unknown').replace(/_/g, ' ');
  const financialSentence =
    `Annual income: ${income}. Net worth: ${netWorth}, liquid assets: ${liquid}. Source of funds: ${source}.`;

  // ── PEP ───────────────────────────────────────────────────────────────────
  let pepSentence = '';
  if (pep?.is_pep === true) {
    const pepType   = (pep.pep_type ?? 'unknown type').replace(/_/g, ' ');
    const pepDetail = [emp?.job_title, emp?.industry].filter(Boolean).join(', ');
    pepSentence = `PEP: ${pepType}${pepDetail ? ` (${pepDetail})` : ''}.`;
  } else if (pep?.is_pep === false) {
    pepSentence = 'Not a PEP.';
  }

  // ── Suitability ───────────────────────────────────────────────────────────
  const objective    = (io?.primary_objective ?? pa?.account_purpose?.join(', ') ?? 'unknown').replace(/_/g, ' ');
  const timeHorizon  = (io?.time_horizon ?? pa?.investment_time_horizon ?? 'unknown').replace(/_/g, ' ');
  const risk         = (rp?.assessed_risk_tolerance ?? rp?.stated_risk_tolerance ?? 'unknown').replace(/_/g, ' ');
  const knowledge    = (ik?.assessed_knowledge_level ?? ik?.self_assessed_level ?? 'unknown').replace(/_/g, ' ');
  const suitabilitySentence =
    `Investment objective: ${objective} with a ${timeHorizon} horizon. ` +
    `Risk tolerance assessed as ${risk}. Investment knowledge: ${knowledge}.`;

  // ── Recommendation ────────────────────────────────────────────────────────
  let recSentence: string;
  if (isHandoff) {
    recSentence = 'No recommendation — handed off to advisor.';
  } else {
    const accountTypes = sd?.suitable_account_types?.map((a) => a.toUpperCase()).join(' + ') ?? 'unknown';
    const portfolio    = (sd?.recommended_portfolio_approach ?? 'unknown').replace(/_/g, ' ');
    const alloc        = sd?.recommended_asset_allocation;
    const equities     = alloc?.equities_pct   ?? '?';
    const fixedIncome  = alloc?.fixed_income_pct ?? '?';
    const score        = sd?.suitability_score;

    recSentence = `Recommended: ${accountTypes} with ${portfolio} portfolio`;
    if (alloc) recSentence += ` (${equities}% equities, ${fixedIncome}% fixed income)`;
    recSentence += score !== undefined ? `. Suitability score: ${score}/100.` : '.';
  }

  // ── Escalation ────────────────────────────────────────────────────────────
  const escalationSentence = flags.length === 0
    ? 'No escalation flags.'
    : `Escalation: ${flags.map((f) => `${f.flag_type.replace(/_/g, ' ')} — ${f.description}`).join('; ')}.`;

  return [
    identitySentence,
    citizenshipSentence,
    financialSentence,
    pepSentence,
    suitabilitySentence,
    recSentence,
    escalationSentence,
  ].filter(Boolean).join(' ');
}

// ─── Handoff Block Printer ────────────────────────────────────────────────────

function printHandoffBlock(
  sessionId: string,
  handoffReason: string,
  conversationSummary: string,
  turnNumber: number,
  kycRecord: KycRecord,
  suitabilityAssessment: SuitabilityAssessment,
  metrics: SessionMetrics
): void {
  const TOP    = '═══ HANDOFF REQUIRED ═══';
  const BOTTOM = '═══════════════════════';
  const shortId = sessionId.slice(0, 8);
  const { filled: filledRequired } = computeCompletionFromRequiredFields(kycRecord, suitabilityAssessment);
  const flags = kycRecord.metadata.escalation_flags ?? [];

  const flagLines = flags.length === 0
    ? 'None'
    : flags.map((f) => `[${f.severity.toUpperCase()}] ${f.flag_type.replace(/_/g, ' ')} — ${f.description}`).join('\n  ');

  const lines: string[] = [
    '',
    TOP,
    `Session: ${shortId}...`,
    `Reason: ${handoffReason}`,
    `Turn: ${turnNumber} (${metrics.totalTurns} total)`,
    `Fields Collected: ${filledRequired}/20`,
    `Escalation Flags: ${flagLines}`,
    `Audit Summary: ${conversationSummary}`,
    BOTTOM,
    '',
  ];

  console.log(lines.join('\n'));
}

// ─── Session Summary Printer ──────────────────────────────────────────────────

function printSessionSummary(
  sessionId: string,
  metrics: SessionMetrics,
  kycRecord: KycRecord,
  suitabilityAssessment: SuitabilityAssessment
): void {
  const BOX = '══════════════════════════════════════════════════════════════';
  const timestamp = new Date().toLocaleString('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });
  const shortId = sessionId.slice(0, 8);

  const flags = kycRecord.metadata.escalation_flags ?? [];
  const sd = suitabilityAssessment.suitability_determination;
  const { filled: filledRequired, pct: completionPct } = computeCompletionFromRequiredFields(kycRecord, suitabilityAssessment);

  const totalTurns = metrics.totalTurns;
  const extractionSuccessPct = totalTurns > 0
    ? Math.round((metrics.extractionSuccessCount / totalTurns) * 100)
    : 0;
  const avgFieldsPerTurn = metrics.fieldsPerTurn.length > 0
    ? (metrics.fieldsPerTurn.reduce((a, b) => a + b, 0) / metrics.fieldsPerTurn.length).toFixed(1)
    : '0.0';
  const avgLatencyFormatted = Math.round(metrics.avgResponseLatency).toLocaleString('en-CA') + 'ms';

  const modeLabel = metrics.mode === 'accelerated' ? 'Accelerated' : metrics.mode === 'exploratory' ? 'Exploratory' : 'Unknown';

  const lines: string[] = [''];
  lines.push(BOX);
  lines.push(` SESSION COMPLETE | ${timestamp}`);
  lines.push(` Session: ${shortId}...`);
  lines.push(BOX);

  lines.push(' CONVERSATION METRICS');
  lines.push(` Mode:                  ${modeLabel}`);
  lines.push(` Total Turns:           ${totalTurns}`);
  lines.push(` Phase 1 (Suitability): ${metrics.phase1Turns} turns`);
  lines.push(` Phase 2 (Compliance):  ${metrics.phase2Turns} turns`);
  lines.push(` Phase 3 (Recommend):   ${metrics.phase3Turns} turns`);

  lines.push('');
  lines.push(' MODEL QUALITY');
  lines.push(` Extraction Success:    ${metrics.extractionSuccessCount}/${totalTurns} (${extractionSuccessPct}%)`);
  lines.push(` Extraction Retries:    ${metrics.extractionRetryCount}`);
  lines.push(` Multi-Q Trims:         ${metrics.enforceOneQuestionTrims}`);
  lines.push(` Avg Fields/Turn:       ${avgFieldsPerTurn}`);
  lines.push(` Avg API Latency:       ${avgLatencyFormatted}`);

  lines.push('');
  lines.push(' COMPLIANCE');
  lines.push(` Required Fields:       ${filledRequired}/20 (${completionPct}%)`);
  if (flags.length === 0) {
    lines.push(` Escalation Flags:      None`);
  } else {
    lines.push(` Escalation Flags:      ${flags.length}`);
    for (const flag of flags) {
      lines.push(`   [${flag.severity.toUpperCase()}] ${flag.flag_type.replace(/_/g, ' ')} — ${flag.description}`);
    }
  }
  if (metrics.guardrailAlerts.length === 0) {
    lines.push(` Guardrail Alerts:      None`);
  } else {
    lines.push(` Guardrail Alerts:      ${metrics.guardrailAlerts.length}`);
    for (const alert of metrics.guardrailAlerts) {
      lines.push(`   Turn ${alert.turn} | ${alert.type} — ${alert.message}`);
    }
  }

  lines.push('');
  lines.push(' RECOMMENDATION');
  if (sd?.suitable_account_types && sd.suitable_account_types.length > 0) {
    lines.push(` Account Type(s):       ${sd.suitable_account_types.map((a) => a.toUpperCase()).join(', ')}`);
  } else {
    lines.push(` Account Type(s):       None`);
  }
  if (sd?.recommended_portfolio_approach) {
    lines.push(` Portfolio:             ${sd.recommended_portfolio_approach.replace(/_/g, ' ')}`);
  }
  if (sd?.suitability_score !== undefined) {
    lines.push(` Suitability Score:     ${sd.suitability_score}/100`);
  }
  lines.push(` Status:                Approved`);
  lines.push(BOX);

  console.log(lines.join('\n'));

  // Print audit summary block immediately after the session summary
  const summary = kycRecord.metadata.conversation_summary;
  if (summary) {
    const AUDIT_BOX = '══════════════════════════════════════════════════════════════';
    console.log([
      '',
      AUDIT_BOX,
      ' AUDIT SUMMARY',
      AUDIT_BOX,
      ` ${summary}`,
      AUDIT_BOX,
    ].join('\n'));
  }
}

// ─── POST /api/sessions ───────────────────────────────────────────────────────
// Creates a new conversation session and returns the agent's opening message.

router.post('/sessions', (_req: Request, res: Response) => {
  const session = createSession();

  const initialMessage: ChatMessage = {
    role: 'assistant',
    content: INITIAL_GREETING,
    timestamp: new Date().toISOString(),
    visible: true,
  };

  updateSession(session.id, { messages: [initialMessage] });

  res.json({
    sessionId: session.id,
    message: INITIAL_GREETING,
    kycRecord: session.kycRecord,
    suitabilityAssessment: session.suitabilityAssessment,
    sessionMetrics: session.sessionMetrics,
  });
});

// ─── POST /api/chat/:sessionId ────────────────────────────────────────────────
// Sends a user message, gets an AI response, and returns the updated records.

router.post('/chat/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { message } = req.body as ChatRequest;

  if (!message?.trim()) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const userMsg: ChatMessage = {
    role: 'user',
    content: message.trim(),
    timestamp: new Date().toISOString(),
    visible: true,
  };

  const updatedMessages = [...session.messages, userMsg];

  // Turn number = prior user messages + 1 (session.messages hasn't been updated yet)
  const turnNumber = session.messages.filter((m) => m.role === 'user').length + 1;

  try {
    const turnStart = Date.now();
    const { assistantMessage, extraction, rawResponse, extractionFound, oneQuestionTrimChars, extractionRetryFired } = await chat(
      session.messages,
      message.trim()
    );
    const turnLatencyMs = Date.now() - turnStart;

    let { kycRecord, suitabilityAssessment } = applyExtraction(
      session.kycRecord,
      session.suitabilityAssessment,
      extraction
    );

    // ── Backend SIN validation safety net ────────────────────────────────────
    // If the model set sin_provided = true this turn, verify the user's message
    // actually contains a valid 9-digit SIN. Override to false if not found.
    const sinExtractedThisTurn = extraction.kyc_updates.personal_information?.sin_provided === true;
    if (sinExtractedThisTurn) {
      // Accept plain 9-digit strings or 3-3-3 formatted SINs (spaces or hyphens).
      const validSinPattern = /\b(\d{9}|\d{3}[ -]\d{3}[ -]\d{3})\b/;
      if (!validSinPattern.test(message.trim())) {
        console.log('[chat route] SIN validation failed — no valid 9-digit SIN found in message, overriding sin_provided to false');
        kycRecord = {
          ...kycRecord,
          personal_information: {
            ...(kycRecord.personal_information ?? {}),
            sin_provided: false,
          },
        };
      }
    }

    // ── Handoff detection ──────────────────────────────────────────────────────
    // If Claude signals requires_handoff, transition to handed_off status,
    // generate audit summary, store handoff_reason, and log to console.
    // Allow both 'in_progress' and 'escalated': applyExtraction may have already
    // set status to 'escalated' via critical flags in the same extraction block.
    const currentStatus = kycRecord.metadata.completion_status;
    const isHandoff = extraction.requires_handoff === true &&
      (currentStatus === 'in_progress' || currentStatus === 'escalated');
    if (isHandoff) {
      const handoffReason = extraction.handoff_reason ?? 'Situation requires human advisor';
      const conversationSummary = buildConversationSummary(kycRecord, suitabilityAssessment, true);
      kycRecord = {
        ...kycRecord,
        metadata: {
          ...kycRecord.metadata,
          completion_status: 'handed_off',
          handoff_reason: handoffReason,
          conversation_summary: conversationSummary,
        },
      };
      console.log('[chat route] Handoff triggered — completion_status → handed_off');
    }

    // Mark complete when the agent has delivered a recommendation and the user approves it.
    // Condition: a full suitability_determination is present AND the user's message is affirmative.
    const sd = suitabilityAssessment.suitability_determination;
    const hasRecommendation =
      !!sd?.recommended_portfolio_approach &&
      !!sd?.suitable_account_types &&
      sd.suitable_account_types.length > 0;

    const AFFIRMATIVES = [
      'yes', 'yep', 'yeah', 'yup', 'sure', 'ok', 'okay',
      'sounds good', 'that works', 'go ahead', 'perfect', 'do it',
      'great', 'absolutely', 'definitely', "let's do it", "let's go",
      'approved', 'approve', 'confirm', 'confirmed', 'proceed',
    ];
    const msgLower = message.trim().toLowerCase();
    const isAffirmative = AFFIRMATIVES.some((w) => msgLower.includes(w));

    const wasInProgress = kycRecord.metadata.completion_status === 'in_progress';
    if (hasRecommendation && isAffirmative && wasInProgress) {
      const conversationSummary = buildConversationSummary(kycRecord, suitabilityAssessment);
      kycRecord = {
        ...kycRecord,
        metadata: {
          ...kycRecord.metadata,
          completion_status: 'complete',
          conversation_summary: conversationSummary,
        },
      };
      console.log('[chat route] Recommendation approved — completion_status → complete');
    }

    if (extractionFound) {
      const kycFields = countLeafFields(kycRecord);
      const suitFields = countLeafFields(suitabilityAssessment);
      console.log(
        `[chat route] Extraction OK — KYC: ${kycFields} fields, Suitability: ${suitFields} fields, Total: ${kycFields + suitFields}`
      );
    }

    // Pretty-print the per-turn summary (delta fields, flags, completion %)
    const { filled: filledRequired, pct: completionPct } = computeCompletionFromRequiredFields(kycRecord, suitabilityAssessment);

    // Compute true delta: only fields new or changed vs. what was logged in prior turns
    const previousFields = session.previousFields ?? new Map<string, string>();
    const deltaFields = computeDeltaFields(extraction, previousFields);

    // Advance the snapshot: merge current extraction's flat pairs into previousFields
    const updatedPreviousFields = new Map(previousFields);
    for (const [key, value] of [
      ...flattenObject(extraction.kyc_updates),
      ...flattenObject(extraction.suitability_updates),
    ]) {
      updatedPreviousFields.set(key, formatFieldValue(value));
    }

    logTurnSummary(turnNumber, sessionId, deltaFields, extraction.escalation_flags, filledRequired);

    // ── Session Metrics Update ──────────────────────────────────────────────
    const prevMetrics = session.sessionMetrics;
    const currentPhase = session._currentPhase;

    // Build updated latencies and avg
    const updatedTurnLatencies = [...prevMetrics.turnLatencies, turnLatencyMs];
    const avgResponseLatency =
      updatedTurnLatencies.reduce((a, b) => a + b, 0) / updatedTurnLatencies.length;

    // Mode: set on turn 1 based on how many new fields were extracted
    let mode = prevMetrics.mode;
    if (turnNumber === 1) {
      mode = deltaFields.length >= 3 ? 'accelerated' : 'exploratory';
    }

    // Phase counters
    const phase1Turns = prevMetrics.phase1Turns + (currentPhase === 1 ? 1 : 0);
    const phase2Turns = prevMetrics.phase2Turns + (currentPhase === 2 ? 1 : 0);
    const phase3Turns = prevMetrics.phase3Turns + (currentPhase === 3 ? 1 : 0);

    // Determine next phase
    let nextPhase: 1 | 2 | 3 = currentPhase;
    if (currentPhase === 1 && isPhase2Transition(assistantMessage)) {
      nextPhase = 2;
    } else if (currentPhase <= 2 && hasRecommendation) {
      nextPhase = 3;
    }

    // Guardrail alerts — build on the updated fieldsPerTurn (including this turn's count)
    const updatedFieldsPerTurn = [...prevMetrics.fieldsPerTurn, deltaFields.length];
    const metricsForGuardrail: SessionMetrics = {
      ...prevMetrics,
      fieldsPerTurn: updatedFieldsPerTurn,
    };
    const newAlerts = runGuardrailChecks(
      metricsForGuardrail,
      turnNumber,
      extractionFound,
      extractionRetryFired,
      completionPct,
      turnLatencyMs,
      deltaFields,
      message.trim()
    );

    for (const alert of newAlerts) {
      console.log(`[GUARDRAIL] Turn ${alert.turn} | ${alert.type} — ${alert.message}`);
    }

    const updatedMetrics: SessionMetrics = {
      mode,
      totalTurns: prevMetrics.totalTurns + 1,
      phase1Turns,
      phase2Turns,
      phase3Turns,
      extractionSuccessCount: prevMetrics.extractionSuccessCount + (extractionFound ? 1 : 0),
      extractionRetryCount: prevMetrics.extractionRetryCount + (extractionRetryFired ? 1 : 0),
      enforceOneQuestionTrims: prevMetrics.enforceOneQuestionTrims + (oneQuestionTrimChars > 2 ? 1 : 0),
      fieldsPerTurn: updatedFieldsPerTurn,
      avgResponseLatency,
      turnLatencies: updatedTurnLatencies,
      guardrailAlerts: [...prevMetrics.guardrailAlerts, ...newAlerts],
    };

    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: assistantMessage,
      timestamp: new Date().toISOString(),
      visible: true,
    };

    updateSession(sessionId, {
      messages: [...updatedMessages, assistantMsg],
      kycRecord,
      suitabilityAssessment,
      lastRawResponse: rawResponse,
      previousFields: updatedPreviousFields,
      sessionMetrics: updatedMetrics,
      _currentPhase: nextPhase,
    });

    // Print session summary when the session is newly completed
    if (kycRecord.metadata.completion_status === 'complete' && wasInProgress) {
      printSessionSummary(sessionId, updatedMetrics, kycRecord, suitabilityAssessment);
    }

    // Print handoff block when a handoff was just triggered
    if (isHandoff) {
      printHandoffBlock(
        sessionId,
        kycRecord.metadata.handoff_reason ?? 'Situation requires human advisor',
        kycRecord.metadata.conversation_summary ?? '',
        turnNumber,
        kycRecord,
        suitabilityAssessment,
        updatedMetrics
      );
    }

    res.json({
      message: assistantMessage,
      kycRecord,
      suitabilityAssessment,
      sessionId,
      sessionMetrics: updatedMetrics,
      ...(isHandoff ? { handoff: true, handoff_reason: kycRecord.metadata.handoff_reason } : {}),
    });
  } catch (err) {
    console.error('[chat route] Error calling Claude:', err);
    res.status(500).json({
      error: 'Failed to get a response from the AI agent. Please try again.',
    });
  }
});

// ─── GET /api/sessions/:sessionId ─────────────────────────────────────────────
// Returns the current session state (for reconnection).

router.get('/sessions/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const session = getSession(sessionId);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  res.json({
    sessionId: session.id,
    messages: session.messages.filter((m) => m.visible),
    kycRecord: session.kycRecord,
    suitabilityAssessment: session.suitabilityAssessment,
  });
});

// ─── GET /api/sessions/:sessionId/debug ───────────────────────────────────────
// Returns the raw last Claude response (before parsing) + full session state.
// Useful for diagnosing extraction failures.

router.get('/sessions/:sessionId/debug', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const session = getSession(sessionId);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const raw = session.lastRawResponse ?? null;
  const extractionBlockMatch = raw?.match(/<extraction>([\s\S]*?)<\/extraction>/);

  res.json({
    sessionId: session.id,
    messageCount: session.messages.length,
    lastRawResponse: raw,
    lastExtractionBlock: extractionBlockMatch ? extractionBlockMatch[1].trim() : null,
    hasExtractionBlock: extractionBlockMatch !== null && extractionBlockMatch !== undefined,
    kycRecord: session.kycRecord,
    suitabilityAssessment: session.suitabilityAssessment,
    sessionMetrics: session.sessionMetrics,
  });
});

export default router;
