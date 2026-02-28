import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import type { ChatMessage, ExtractionResult, KycRecord, SuitabilityAssessment } from '../types';
import { deepMerge } from '../state/sessions';

// ─── System Prompt ────────────────────────────────────────────────────────────

const DOCS_DIR = path.resolve(__dirname, '../../../docs');

const BASE_SYSTEM_PROMPT = fs.readFileSync(
  path.join(DOCS_DIR, 'system-prompt.md'),
  'utf-8'
);

// Simplified flat key-value extraction format.
// Asking Claude to reproduce the full nested KYC schema every turn is error-prone.
// Instead, we ask it to emit ONLY the new fields it learned, as flat dot-notation keys.
// The parser converts them back to nested structures before applying to the record.
const EXTRACTION_INSTRUCTIONS = `

---

## Structured Output Format (REQUIRED)

Every single response MUST end with an extraction block. This is invisible to the user and updates the live compliance record.

<extraction>
{
  "section.field": value,
  "section.field": value,
  "escalation_flags": []
}
</extraction>

Include ONLY fields where you learned NEW information in THIS exchange. Do not repeat previously captured data. If nothing new was learned: <extraction>{"escalation_flags":[]}</extraction>

### KYC Fields (use these exact dot-notation keys)

**Personal:**
- personal_information.legal_first_name — string
- personal_information.legal_last_name — string
- personal_information.date_of_birth — "YYYY-MM-DD" (current year is 2026; birth year = 2026 − stated age: age 39 → "1987-01-01", age 44 → "1982-01-01", age 35 → "1991-01-01")
- personal_information.residential_address.city — string
- personal_information.residential_address.province_territory — "ON"|"BC"|"AB"|"QC"|"MB"|"SK"|"NB"|"NS"|"NL"|"PE"|"NT"|"NU"|"YT"
- personal_information.residential_address.postal_code — string
- personal_information.email_address — string
- personal_information.phone_number — string
- personal_information.sin_provided — boolean

**Citizenship:**
- citizenship_and_tax_residency.canadian_citizen — boolean
- citizenship_and_tax_residency.canadian_tax_resident — boolean (true if they live in Canada)
- citizenship_and_tax_residency.us_person — boolean

**Employment:**
- employment_and_income.employment_status — "employed"|"self_employed"|"retired"|"student"|"unemployed"|"homemaker"
- employment_and_income.employer_name — string
- employment_and_income.job_title — string
- employment_and_income.industry — string (e.g. "education", "technology", "healthcare")
- employment_and_income.annual_income_range — "under_25k"|"25k_to_50k"|"50k_to_75k"|"75k_to_100k"|"100k_to_150k"|"150k_to_250k"|"250k_to_500k"|"over_500k"
- employment_and_income.is_insider_or_control_person — boolean

**Financial Profile:**
- financial_profile.net_worth_range — "under_25k"|"25k_to_100k"|"100k_to_250k"|"250k_to_500k"|"500k_to_1m"|"1m_to_5m"|"over_5m"
- financial_profile.liquid_assets_range — "under_10k"|"10k_to_50k"|"50k_to_100k"|"100k_to_250k"|"250k_to_500k"|"over_500k"
- financial_profile.fixed_monthly_expenses — "under_2k"|"2k_to_4k"|"4k_to_6k"|"6k_to_10k"|"over_10k"
- financial_profile.outstanding_debt — boolean

**Source of Funds:**
- source_of_funds.primary_funding_source — "employment_income"|"business_income"|"investments"|"inheritance"|"gift"|"pension"|"government_benefits"|"savings"|"sale_of_property"|"other"
- source_of_funds.funding_source_details — string
- source_of_funds.initial_deposit_range — "under_1k"|"1k_to_5k"|"5k_to_25k"|"25k_to_100k"|"100k_to_500k"|"over_500k"
- source_of_funds.expected_annual_deposits — "under_5k"|"5k_to_25k"|"25k_to_50k"|"50k_to_100k"|"over_100k"

**PEP & Sanctions:**
- pep_and_sanctions.is_pep — boolean
- pep_and_sanctions.pep_type — "domestic"|"foreign"|"head_of_international_org"|"family_member"|"close_associate"|"not_applicable"
- pep_and_sanctions.is_family_of_pep — boolean
- pep_and_sanctions.is_close_associate_of_pep — boolean

**Account Purpose:**
- purpose_and_activity.account_purpose — array, e.g. ["retirement_savings","first_home_savings"] — valid values: "retirement_savings"|"general_investing"|"first_home_savings"|"education_savings"|"emergency_fund"|"tax_optimization"|"active_trading"|"income_generation"|"wealth_preservation"
- purpose_and_activity.investment_time_horizon — "under_1_year"|"1_to_3_years"|"3_to_5_years"|"5_to_10_years"|"over_10_years"
- purpose_and_activity.expected_trading_frequency — "rarely"|"monthly"|"weekly"|"daily"
- purpose_and_activity.third_party_involvement — boolean

### Suitability Fields

- risk_profile.stated_risk_tolerance — "conservative"|"moderate"|"balanced"|"growth"|"aggressive"
- risk_profile.assessed_risk_tolerance — same values
- risk_profile.behavioral_risk_signals.loss_reaction — "would_sell_immediately"|"would_be_concerned"|"would_hold"|"would_buy_more"
- risk_profile.behavioral_risk_signals.safety_first_language — boolean
- risk_profile.behavioral_risk_signals.experience_with_volatility — boolean
- risk_profile.risk_mismatch_detected — boolean
- risk_profile.risk_mismatch_explanation — string
- investment_knowledge.self_assessed_level — "none"|"beginner"|"intermediate"|"advanced"|"expert"
- investment_knowledge.assessed_knowledge_level — same values
- investment_knowledge.demonstrated_knowledge_signals.has_prior_investment_experience — boolean
- investment_objectives.primary_objective — "capital_preservation"|"income_generation"|"balanced_growth_and_income"|"long_term_growth"|"aggressive_growth"|"speculation"
- investment_objectives.time_horizon — "under_1_year"|"1_to_3_years"|"3_to_5_years"|"5_to_10_years"|"over_10_years"
- investment_objectives.liquidity_needs — "high"|"moderate"|"low"
- investment_objectives.specific_goals — array of: {"goal_type":"buy_first_home"|"retirement"|"education_savings"|"emergency_fund"|"major_purchase"|"wealth_building"|"debt_payoff"|"income_replacement"|"other","target_amount":"$X","target_date":"YYYY","priority":"primary"|"secondary"|"aspirational"}

### Full Suitability Determination (when ready to recommend)

- suitability_determination.suitable_account_types — array: ["tfsa"|"rrsp"|"fhsa"|"resp"|"non_registered"|"corporate"]
- suitability_determination.recommended_portfolio_approach — "managed_conservative"|"managed_balanced"|"managed_growth"|"managed_aggressive"|"self_directed"|"direct_indexing"
- suitability_determination.recommended_asset_allocation.equities_pct — number
- suitability_determination.recommended_asset_allocation.fixed_income_pct — number
- suitability_determination.recommended_asset_allocation.alternatives_pct — number
- suitability_determination.suitability_score — number 0–100
- suitability_determination.suitability_rationale — string

### Escalation Flags

Add to escalation_flags array for any new concerns raised in this exchange:
{"flag_type":"pep_detected"|"contradictory_information"|"high_risk_jurisdiction"|"unusual_source_of_funds"|"non_resident_tax_complexity"|"suitability_mismatch"|"incomplete_information"|"sanctions_screening_required"|"age_eligibility_concern","description":"plain English explanation","severity":"low"|"medium"|"high"|"critical"}

CRITICAL: The extraction block must be the VERY LAST thing in your response. No text after </extraction>.
`;

// Short reminder injected into every user message so it appears immediately before generation.
// Claude tends to forget the extraction instruction when it is only in the (distant) system prompt.
const EXTRACTION_REMINDER =
  '\n\n[REQUIRED: End your response with an <extraction> block. ' +
  'Extract any fields learned in this exchange as dot-notation JSON. ' +
  'If nothing new: <extraction>{"escalation_flags":[]}</extraction>. ' +
  'DATE OF BIRTH: the current year is 2026. When a user states their age, calculate birth year as (2026 - age). ' +
  'A 39-year-old → 1987-01-01. A 44-year-old → 1982-01-01. Never use a year that would make the person a different age than stated. ' +
  'INCOME RANGES: boundary values go in the lower range. $100K = 75k_to_100k (not 100k_to_150k). ' +
  '$25K = under_25k, $50K = 25k_to_50k, $75K = 50k_to_75k, $100K = 75k_to_100k, $150K = 100k_to_150k, $250K = 150k_to_250k, $500K = 250k_to_500k. ' +
  'COMPLETENESS CHECK: before making a recommendation, verify your extraction contains legal name, ' +
  'residential address, phone, email, citizenship status, net worth range, and liquid assets range. ' +
  'If any are missing, ask for them — do not skip to a recommendation. ' +
  'TIME HORIZON: Once a time horizon is set from the user\'s explicit statement, do not change it in ' +
  'subsequent extractions unless the user explicitly states a different timeline. If the user said they ' +
  'want to retire in 16 years, that is over_10_years and it stays over_10_years for every subsequent ' +
  'extraction. Only update on explicit user correction, not reinterpretation. ' +
  'BUNDLING: When asking for multiple related pieces of information, phrase as a single statement with ' +
  'commas, not multiple questions. End with at most one question mark. ' +
  'Remember: ask only ONE question in your response.]';

const SYSTEM_PROMPT = BASE_SYSTEM_PROMPT + EXTRACTION_INSTRUCTIONS;

// The synthetic first exchange that provides Claude context about
// what it already said to the user. Not displayed in the UI.
const SYNTHETIC_INIT_USER = 'Hi, I want to open an investment account.';
const RAW_INITIAL_GREETING =
  "Hi! I'm here to help you find the right investment account at Wealthsimple. Instead of filling out a long form, we'll just have a conversation — I'll learn about your goals and situation, and recommend the accounts that make the most sense for you. What brings you to Wealthsimple today?";

export const INITIAL_GREETING = enforceOneQuestion(RAW_INITIAL_GREETING);

// The same greeting with a synthetic extraction block appended.
// This is ONLY used when building API messages for Claude — never stored or displayed.
// Without this, Claude sees its "first response" without an extraction block and
// treats that as a precedent, causing it to skip extraction blocks in subsequent turns.
const INITIAL_GREETING_WITH_EXTRACTION =
  INITIAL_GREETING +
  '\n\n<extraction>\n{"escalation_flags":[]}\n</extraction>';

// ─── Anthropic Client ─────────────────────────────────────────────────────────

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '4096', 10);

// ─── Flat → Nested Converter ──────────────────────────────────────────────────

// Section routing: determines whether a dot-notation key belongs to KYC or suitability.
const KYC_SECTIONS = new Set([
  'personal_information',
  'citizenship_and_tax_residency',
  'employment_and_income',
  'financial_profile',
  'source_of_funds',
  'pep_and_sanctions',
  'purpose_and_activity',
]);

const SUITABILITY_SECTIONS = new Set([
  'risk_profile',
  'investment_knowledge',
  'investment_objectives',
  'suitability_determination',
]);

function setNestedValue(
  obj: Record<string, unknown>,
  keyPath: string[],
  value: unknown
): void {
  let current = obj;
  for (let i = 0; i < keyPath.length - 1; i++) {
    const key = keyPath[i];
    if (typeof current[key] !== 'object' || current[key] === null || Array.isArray(current[key])) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keyPath[keyPath.length - 1]] = value;
}

function convertFlatExtraction(flat: Record<string, unknown>): {
  kyc_updates: Record<string, unknown>;
  suitability_updates: Record<string, unknown>;
  escalation_flags: ExtractionResult['escalation_flags'];
} {
  const kyc: Record<string, unknown> = {};
  const suitability: Record<string, unknown> = {};
  const flags: ExtractionResult['escalation_flags'] = [];

  for (const [dotKey, value] of Object.entries(flat)) {
    if (dotKey === 'escalation_flags') {
      if (Array.isArray(value)) {
        flags.push(...(value as ExtractionResult['escalation_flags']));
      }
      continue;
    }

    // Also handle old-style nested format (kyc_updates/suitability_updates) gracefully
    if (dotKey === 'kyc_updates' && typeof value === 'object' && value !== null) {
      Object.assign(kyc, value);
      continue;
    }
    if (dotKey === 'suitability_updates' && typeof value === 'object' && value !== null) {
      Object.assign(suitability, value);
      continue;
    }

    const parts = dotKey.split('.');
    if (parts.length < 2) {
      console.warn(`[claude] Ignoring flat key with no field part: "${dotKey}"`);
      continue;
    }

    const section = parts[0];
    const fieldPath = parts.slice(1);

    if (KYC_SECTIONS.has(section)) {
      if (!kyc[section]) kyc[section] = {};
      setNestedValue(kyc[section] as Record<string, unknown>, fieldPath, value);
    } else if (SUITABILITY_SECTIONS.has(section)) {
      if (!suitability[section]) suitability[section] = {};
      setNestedValue(suitability[section] as Record<string, unknown>, fieldPath, value);
    } else {
      console.warn(`[claude] Unknown section "${section}" in key "${dotKey}", skipping`);
    }
  }

  return { kyc_updates: kyc, suitability_updates: suitability, escalation_flags: flags };
}

// ─── Response Parsing ─────────────────────────────────────────────────────────

function parseClaudeResponse(rawText: string): {
  message: string;
  extraction: ExtractionResult;
  extractionFound: boolean;
} {
  const empty: ExtractionResult = { kyc_updates: {}, suitability_updates: {}, escalation_flags: [] };

  // Strip extraction block from the visible message regardless of parse outcome
  const message = rawText
    .replace(/<extraction>[\s\S]*?<\/extraction>/g, '')
    .trim();

  // Strategy 1: Look for <extraction>...</extraction> tags
  const tagMatch = rawText.match(/<extraction>([\s\S]*?)<\/extraction>/);
  let rawJson: string | null = null;
  // extractionFound is true only when the proper tags are present, which is what
  // the retry logic checks. The JSON fallback is a best-effort recovery, not "found".
  let extractionFound = false;

  if (tagMatch) {
    rawJson = tagMatch[1].trim();
    extractionFound = true;
    console.log('[claude] Extraction block found via tags, length:', rawJson.length);
  } else {
    // Strategy 2: Find any JSON object in the response as a fallback
    console.warn('[claude] ⚠ No <extraction> tags found. Trying JSON fallback...');
    const jsonMatch = rawText.match(/\{[\s\S]*"escalation_flags"[\s\S]*\}/);
    if (jsonMatch) {
      rawJson = jsonMatch[0];
      console.warn('[claude] Found JSON fallback via escalation_flags anchor, length:', rawJson.length);
    } else {
      console.warn('[claude] ✗ No extraction block found. Raw tail (last 300 chars):', rawText.slice(-300));
      return { message, extraction: empty, extractionFound: false };
    }
  }

  try {
    const parsed = JSON.parse(rawJson);
    const { kyc_updates, suitability_updates, escalation_flags } = convertFlatExtraction(parsed);

    const extraction: ExtractionResult = {
      kyc_updates: kyc_updates as Partial<KycRecord>,
      suitability_updates: suitability_updates as Partial<SuitabilityAssessment>,
      escalation_flags,
    };

    const kycSections = Object.keys(extraction.kyc_updates);
    const suitSections = Object.keys(extraction.suitability_updates);
    console.log(
      `[claude] Extraction OK — kyc sections: [${kycSections.join(', ') || 'none'}]` +
      ` | suitability sections: [${suitSections.join(', ') || 'none'}]` +
      ` | flags: ${escalation_flags.length}`
    );

    return { message, extraction, extractionFound };
  } catch (err) {
    console.error('[claude] ✗ Failed to parse extraction JSON:', err);
    console.error('[claude] Raw extraction content (first 500 chars):', rawJson.slice(0, 500));
    return { message, extraction: empty, extractionFound: false };
  }
}

// ─── One-Question Guardrail ───────────────────────────────────────────────────

/**
 * Hard programmatic filter: ensures the assistant asks at most one question per
 * response.  Finds the first "real" question mark — one that is NOT inside a
 * double-quoted string or a parenthetical aside — and drops everything that
 * follows it.
 *
 * Edge cases:
 *   - Zero questions → return text unchanged.
 *   - "?" inside "quoted speech" → skipped (ASCII " and smart quotes " ").
 *   - "?" inside (parenthetical asides) → skipped.
 *   - Paragraph breaks before the question sentence are preserved.
 */
export function enforceOneQuestion(text: string): string {
  let inDoubleQuote = false;
  let parenDepth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    // Track double-quote state (ASCII " and smart-quote pairs " ")
    if (ch === '"') {
      inDoubleQuote = !inDoubleQuote;
    } else if (ch === '\u201C') { // left smart double-quote "
      inDoubleQuote = true;
    } else if (ch === '\u201D') { // right smart double-quote "
      inDoubleQuote = false;
    } else if (ch === '(' && !inDoubleQuote) {
      parenDepth++;
    } else if (ch === ')' && !inDoubleQuote) {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (ch === '?' && !inDoubleQuote && parenDepth === 0) {
      // First real question mark found. Consume it plus any immediately
      // following closing delimiters (e.g. ?" or ?") that are part of
      // the same sentence boundary.
      let cut = i + 1;
      while (cut < text.length && '")\u201D'.includes(text[cut])) {
        cut++;
      }
      return text.slice(0, cut).trim();
    }
  }

  // No real question mark found — return unchanged.
  return text;
}

// ─── Record Update ────────────────────────────────────────────────────────────

export function applyExtraction(
  kycRecord: KycRecord,
  suitabilityAssessment: SuitabilityAssessment,
  extraction: ExtractionResult
): { kycRecord: KycRecord; suitabilityAssessment: SuitabilityAssessment } {
  const now = new Date().toISOString();

  let updatedKyc = deepMerge(kycRecord, extraction.kyc_updates) as KycRecord;
  const updatedSuitability = deepMerge(
    suitabilityAssessment,
    extraction.suitability_updates
  ) as SuitabilityAssessment;

  // Accumulate escalation flags (append, never replace)
  if (extraction.escalation_flags.length > 0) {
    const newFlags = extraction.escalation_flags.map((f) => ({
      ...f,
      triggered_at: now,
    }));
    updatedKyc = {
      ...updatedKyc,
      metadata: {
        ...updatedKyc.metadata,
        escalation_flags: [
          ...(updatedKyc.metadata.escalation_flags ?? []),
          ...newFlags,
        ],
        updated_at: now,
        completion_status:
          newFlags.some((f) => f.severity === 'critical')
            ? 'escalated'
            : updatedKyc.metadata.completion_status,
      },
    };
  } else {
    updatedKyc = {
      ...updatedKyc,
      metadata: { ...updatedKyc.metadata, updated_at: now },
    };
  }

  return { kycRecord: updatedKyc, suitabilityAssessment: updatedSuitability };
}

// ─── Main Chat Function ───────────────────────────────────────────────────────

export async function chat(
  conversationHistory: ChatMessage[],
  userMessage: string
): Promise<{
  assistantMessage: string;
  extraction: ExtractionResult;
  rawResponse: string;
  extractionFound: boolean;
  oneQuestionTrimChars: number;
  extractionRetryFired: boolean;
}> {
  const apiMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: SYNTHETIC_INIT_USER },
    { role: 'assistant', content: INITIAL_GREETING_WITH_EXTRACTION },
    ...conversationHistory
      .filter((m) => !(m.content === SYNTHETIC_INIT_USER || m.content === INITIAL_GREETING))
      .map((m) => {
        if (m.role === 'assistant' && !m.content.includes('<extraction>')) {
          return {
            role: m.role,
            content:
              m.content +
              '\n\n<extraction>\n{"escalation_flags":[]}\n</extraction>',
          };
        }
        return { role: m.role, content: m.content };
      }),
    // Append reminder to the last user message so it appears immediately before generation.
    { role: 'user', content: userMessage + EXTRACTION_REMINDER },
  ];

  console.log(
    `[claude] Sending ${apiMessages.length} messages (model: ${MODEL})` +
    ` — user: "${userMessage.slice(0, 80)}${userMessage.length > 80 ? '…' : ''}"`
  );

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: apiMessages,
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude returned no text content');
  }

  let rawResponse = textBlock.text;
  let { message: assistantMessage, extraction, extractionFound } = parseClaudeResponse(rawResponse);

  // ── Retry if no extraction block was produced ─────────────────────────────
  // Claude occasionally drops the block on later turns. One retry with an
  // explicit correction prompt reliably recovers it without changing the
  // conversational message.
  let extractionRetryFired = false;
  if (!extractionFound) {
    extractionRetryFired = true;
    console.warn('[claude] ⚠ No extraction block — retrying with explicit instruction...');

    const retryMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...apiMessages,
      { role: 'assistant', content: assistantMessage },
      {
        role: 'user',
        content:
          'You forgot to include the <extraction> block. Please respond again with the same ' +
          'conversational message AND include the <extraction> JSON block with any fields you ' +
          'can extract from the conversation so far.',
      },
    ];

    const retryResponse = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: retryMessages,
    });

    const retryTextBlock = retryResponse.content.find((b) => b.type === 'text');
    if (retryTextBlock && retryTextBlock.type === 'text') {
      const retryParsed = parseClaudeResponse(retryTextBlock.text);
      if (retryParsed.extractionFound) {
        console.log('[claude] ✓ Retry succeeded — extraction block recovered');
        rawResponse = retryTextBlock.text;
        assistantMessage = retryParsed.message;
        extraction = retryParsed.extraction;
        extractionFound = true;
      } else {
        console.warn('[claude] ✗ Retry also failed to produce extraction block');
      }
    }
  }

  // ── One-question guardrail ────────────────────────────────────────────────
  // Applied AFTER extraction is stripped, BEFORE the response reaches the UI.
  const preFilterLength = assistantMessage.length;
  const filtered = enforceOneQuestion(assistantMessage);
  const oneQuestionTrimChars = preFilterLength - filtered.length;
  if (oneQuestionTrimChars > 0) {
    console.log(`[claude] enforceOneQuestion trimmed ${oneQuestionTrimChars} chars`);
  }
  assistantMessage = filtered;

  return { assistantMessage, extraction, rawResponse, extractionFound, oneQuestionTrimChars, extractionRetryFired };
}
