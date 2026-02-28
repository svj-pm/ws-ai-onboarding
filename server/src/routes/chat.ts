import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  createSession,
  getSession,
  updateSession,
} from '../state/sessions';
import { chat, applyExtraction, INITIAL_GREETING } from '../services/claude';
import type { ChatRequest, ChatMessage, ExtractionResult } from '../types';

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

// ─── Turn Summary Logger ──────────────────────────────────────────────────────

// How many core fields we consider "complete" — used for the completion percentage.
// Covers the ~25 most meaningful KYC + suitability fields a user would fill in.
const TOTAL_CORE_FIELDS = 25;

// Maps dot-notation extraction keys → [Category, Field Name] for display.
const FIELD_LABELS: Record<string, [string, string]> = {
  'personal_information.legal_first_name':                              ['Personal Info',   'First Name'],
  'personal_information.legal_last_name':                               ['Personal Info',   'Last Name'],
  'personal_information.date_of_birth':                                 ['Personal Info',   'Date of Birth'],
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

function formatFieldValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
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

function logTurnSummary(
  turnNumber: number,
  sessionId: string,
  extraction: ExtractionResult,
  totalFields: number
): void {
  const BOX = '═══════════════════════════════════════════════════════';
  const timestamp = new Date().toLocaleString('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });
  const shortId = sessionId.slice(0, 8);

  // Collect delta fields from KYC + suitability updates
  const deltaFields: Array<[string, unknown]> = [
    ...flattenObject(extraction.kyc_updates),
    ...flattenObject(extraction.suitability_updates),
  ];

  const newFlags = extraction.escalation_flags;
  const hasFlags = newFlags.length > 0;

  const lines: string[] = [''];
  lines.push(BOX);
  lines.push(` Turn ${turnNumber} | ${timestamp} | Session: ${shortId}...`);
  lines.push(BOX);

  if (deltaFields.length > 0) {
    lines.push(' NEW FIELDS EXTRACTED:');
    for (const [key, value] of deltaFields) {
      const [category, fieldName] = labelForKey(key);
      const display = formatFieldValue(value);
      // Highlight risk mismatches with a warning marker
      const marker = (key === 'risk_profile.risk_mismatch_detected' && value === true) ? '⚠' : ' ';
      lines.push(`  ${marker} ${category.padEnd(16)} → ${fieldName}: ${display}`);
    }
  } else {
    lines.push(' NEW FIELDS EXTRACTED: (none)');
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
  const pct = Math.min(100, Math.round((totalFields / TOTAL_CORE_FIELDS) * 100));
  lines.push(` COMPLETION: ${pct}% (${totalFields}/${TOTAL_CORE_FIELDS} fields)`);
  lines.push(BOX);

  console.log(lines.join('\n'));
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
    const { assistantMessage, extraction, rawResponse, extractionFound } = await chat(
      session.messages,
      message.trim()
    );

    const { kycRecord, suitabilityAssessment } = applyExtraction(
      session.kycRecord,
      session.suitabilityAssessment,
      extraction
    );

    if (extractionFound) {
      const kycFields = countLeafFields(kycRecord);
      const suitFields = countLeafFields(suitabilityAssessment);
      console.log(
        `[chat route] Extraction OK — KYC: ${kycFields} fields, Suitability: ${suitFields} fields, Total: ${kycFields + suitFields}`
      );
    }

    // Pretty-print the per-turn summary (delta fields, flags, completion %)
    // Uses kycRecord minus metadata for the field count (metadata is internal bookkeeping)
    const { metadata: _meta, ...kycData } = kycRecord;
    const totalFields = countLeafFields(kycData) + countLeafFields(suitabilityAssessment);
    logTurnSummary(turnNumber, sessionId, extraction, totalFields);

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
    });

    res.json({
      message: assistantMessage,
      kycRecord,
      suitabilityAssessment,
      sessionId,
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
  });
});

export default router;
