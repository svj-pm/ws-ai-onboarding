import { useState, useEffect, useRef } from 'react';
import type { KycRecord, SuitabilityAssessment, EscalationFlag, SessionMetrics } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    return value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).replace(/_/g, ' ');
}

// ─── Field Row ────────────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  value: unknown;
  sensitive?: boolean;
  highlight?: boolean;
}

function Field({ label, value, sensitive, highlight }: FieldProps) {
  const isEmpty = value === null || value === undefined;
  const display = sensitive && !isEmpty ? '●●●-●●●-●●●' : formatValue(value);

  return (
    <div className={`record-field ${isEmpty ? 'field-empty' : 'field-filled'} ${highlight ? 'field-highlight' : ''}`}>
      <span className="field-label">{label}</span>
      <span className={`field-value ${isEmpty ? 'value-empty' : ''}`}>
        {isEmpty ? '—' : display}
        {!isEmpty && <span className="field-dot" />}
      </span>
    </div>
  );
}

// ─── Section Card (collapsible) ───────────────────────────────────────────────

interface FieldDef {
  label: string;
  value: unknown;
}

interface SectionProps {
  title: string;
  icon: string;
  children: React.ReactNode;
  filledCount: number;
  totalCount: number;
  filledFields: FieldDef[];
}

function Section({ title, icon, children, filledCount, totalCount, filledFields }: SectionProps) {
  const [isOpen, setIsOpen] = useState(filledCount > 0);
  const prevFilledRef = useRef(filledCount);

  // Auto-expand when new data arrives in a previously empty or partial section
  useEffect(() => {
    if (filledCount > prevFilledRef.current) {
      setIsOpen(true);
    }
    prevFilledRef.current = filledCount;
  }, [filledCount]);

  const pct = totalCount === 0 ? 0 : Math.round((filledCount / totalCount) * 100);
  const isEmpty = filledCount === 0;

  return (
    <div className={`record-section ${isEmpty ? 'section-empty' : ''} ${isOpen ? 'section-open' : ''}`}>
      <button
        className="section-header"
        onClick={() => setIsOpen((o) => !o)}
        aria-expanded={isOpen}
      >
        <span className="section-icon">{icon}</span>
        <span className="section-title">{title}</span>
        <span className={`section-count ${isEmpty ? 'count-empty' : 'count-filled'}`}>
          {filledCount}/{totalCount}
        </span>
        <div className="section-progress-bar">
          <div className="section-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="section-chevron" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}>
          ▸
        </span>
      </button>

      {/* Collapsed preview: chips visible only when collapsed and data exists */}
      {!isOpen && filledCount > 0 && (
        <div className="section-preview">
          {filledFields.map((f, i) => (
            <span key={i} className="preview-chip">
              <span className="preview-label">{f.label}</span>
              <span className="preview-value">{formatValue(f.value)}</span>
            </span>
          ))}
        </div>
      )}

      {/* Smooth height animation via CSS grid trick */}
      <div className={`section-body-wrapper${isOpen ? ' section-body-open' : ''}`}>
        <div className="section-body-inner">
          <div className="section-body">{children}</div>
        </div>
      </div>
    </div>
  );
}

// ─── countFields helper ───────────────────────────────────────────────────────
// Takes [label, value] pairs, returns filled/total counts + the filled ones for preview.

function countFields(...fields: Array<[string, unknown]>): {
  filledCount: number;
  totalCount: number;
  filledFields: FieldDef[];
} {
  const filled = fields.filter(([, v]) => v !== undefined && v !== null);
  return {
    filledCount: filled.length,
    totalCount: fields.length,
    filledFields: filled.map(([label, value]) => ({ label, value })),
  };
}

// ─── Escalation Flags ─────────────────────────────────────────────────────────

function EscalationFlags({ flags }: { flags: EscalationFlag[] }) {
  if (flags.length === 0) return null;

  return (
    <div className="escalation-section">
      <div className="escalation-header">
        <span>⚠ Escalation Flags</span>
        <span className="flag-count">{flags.length}</span>
      </div>
      {flags.map((flag, i) => (
        <div key={i} className={`flag-item flag-${flag.severity}`}>
          <div className="flag-top">
            <span className="flag-type">{flag.flag_type.replace(/_/g, ' ')}</span>
            <span className={`flag-badge badge-${flag.severity}`}>{flag.severity}</span>
          </div>
          <p className="flag-desc">{flag.description}</p>
          <span className="flag-time">
            {new Date(flag.triggered_at).toLocaleTimeString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Recommendation Card ──────────────────────────────────────────────────────

function Recommendation({
  determination,
}: {
  determination: NonNullable<SuitabilityAssessment['suitability_determination']>;
}) {
  const alloc = determination.recommended_asset_allocation;
  return (
    <div className="recommendation-card">
      <div className="rec-header">
        <span className="rec-icon">✦</span>
        <span className="rec-title">Account Recommendation</span>
        {determination.suitability_score !== undefined && (
          <span className="rec-score">Score: {determination.suitability_score}/100</span>
        )}
      </div>

      {determination.suitable_account_types && determination.suitable_account_types.length > 0 && (
        <div className="rec-accounts">
          {determination.suitable_account_types.map((a) => (
            <span key={a} className="account-tag">{a.toUpperCase()}</span>
          ))}
        </div>
      )}

      {determination.recommended_portfolio_approach && (
        <div className="rec-portfolio">
          <span className="rec-label">Portfolio:</span>
          <span className="rec-val">{formatValue(determination.recommended_portfolio_approach)}</span>
        </div>
      )}

      {alloc && (
        <div className="rec-alloc">
          {alloc.equities_pct !== undefined && (
            <div className="alloc-bar">
              <span className="alloc-label">Equities</span>
              <div className="alloc-track">
                <div className="alloc-fill equities" style={{ width: `${alloc.equities_pct}%` }} />
              </div>
              <span className="alloc-pct">{alloc.equities_pct}%</span>
            </div>
          )}
          {alloc.fixed_income_pct !== undefined && (
            <div className="alloc-bar">
              <span className="alloc-label">Fixed Income</span>
              <div className="alloc-track">
                <div className="alloc-fill fixed-income" style={{ width: `${alloc.fixed_income_pct}%` }} />
              </div>
              <span className="alloc-pct">{alloc.fixed_income_pct}%</span>
            </div>
          )}
          {alloc.alternatives_pct !== undefined && alloc.alternatives_pct > 0 && (
            <div className="alloc-bar">
              <span className="alloc-label">Alternatives</span>
              <div className="alloc-track">
                <div className="alloc-fill alternatives" style={{ width: `${alloc.alternatives_pct}%` }} />
              </div>
              <span className="alloc-pct">{alloc.alternatives_pct}%</span>
            </div>
          )}
        </div>
      )}

      {determination.suitability_rationale && (
        <p className="rec-rationale">{determination.suitability_rationale}</p>
      )}

      {determination.warnings && determination.warnings.length > 0 && (
        <div className="rec-warnings">
          {determination.warnings.map((w, i) => (
            <div key={i} className={`rec-warning sev-${w.severity}`}>
              <strong>{w.warning_type.replace(/_/g, ' ')}:</strong> {w.description}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Completion Score ─────────────────────────────────────────────────────────

// Returns true if a field value has been provided (false counts as filled for booleans).
function isValueFilled(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true; // boolean (including false) and number are always filled
}

// Tracks exactly 20 required fields — the legal minimum for a Canadian investment
// account recommendation. Returns { filled, pct } where pct never exceeds 100.
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

  // Address counts as one field only when city + province + postal_code are all present
  const addressFilled =
    isValueFilled(addr?.city) &&
    isValueFilled(addr?.province_territory) &&
    isValueFilled(addr?.postal_code);

  const required: boolean[] = [
    // KYC fields (13)
    isValueFilled(pi?.legal_first_name),          // 1
    isValueFilled(pi?.legal_last_name),            // 2
    isValueFilled(pi?.date_of_birth),              // 3
    addressFilled,                                  // 4 (city + province + postal)
    isValueFilled(pi?.phone_number),               // 5
    isValueFilled(pi?.email_address),              // 6
    isValueFilled(pi?.sin_provided),               // 7 (false = refused, still answered)
    isValueFilled(ctr?.canadian_tax_resident),     // 8
    isValueFilled(ctr?.canadian_citizen),          // 9
    isValueFilled(ctr?.us_person),                 // 10
    isValueFilled(emp?.employment_status),         // 11
    isValueFilled(sof?.primary_funding_source),    // 12
    isValueFilled(pep?.is_pep),                    // 13

    // Suitability fields (7)
    isValueFilled(emp?.annual_income_range),       // 14
    isValueFilled(fp?.net_worth_range),            // 15
    isValueFilled(fp?.liquid_assets_range),        // 16
    // 17: either self_assessed or assessed knowledge level counts
    isValueFilled(ik?.self_assessed_level) || isValueFilled(ik?.assessed_knowledge_level),
    // 18: either assessed or stated risk tolerance counts
    isValueFilled(rp?.assessed_risk_tolerance) || isValueFilled(rp?.stated_risk_tolerance),
    // 19: investment objective from suitability OR account purpose from KYC
    isValueFilled(io?.primary_objective) || isValueFilled(pa?.account_purpose),
    // 20: time horizon from suitability OR from KYC purpose_and_activity
    isValueFilled(io?.time_horizon) || isValueFilled(pa?.investment_time_horizon),
  ];

  const filled = required.filter(Boolean).length;
  return { filled, pct: Math.min(100, Math.round((filled / 20) * 100)) };
}

// ─── Session Metrics Panel ────────────────────────────────────────────────────

function SessionMetricsPanel({ metrics }: { metrics: SessionMetrics }) {
  const [isOpen, setIsOpen] = useState(true);

  const totalTurns = metrics.totalTurns;
  const extractionSuccessPct =
    totalTurns > 0 ? Math.round((metrics.extractionSuccessCount / totalTurns) * 100) : 0;
  const avgFieldsPerTurn =
    metrics.fieldsPerTurn.length > 0
      ? (metrics.fieldsPerTurn.reduce((a, b) => a + b, 0) / metrics.fieldsPerTurn.length).toFixed(1)
      : '0.0';
  const avgLatencyFormatted =
    Math.round(metrics.avgResponseLatency).toLocaleString('en-CA') + 'ms';
  const modeLabel =
    metrics.mode === 'accelerated'
      ? 'Accelerated'
      : metrics.mode === 'exploratory'
        ? 'Exploratory'
        : 'Unknown';

  return (
    <div className="metrics-panel">
      <button
        className="metrics-header"
        onClick={() => setIsOpen((o) => !o)}
        aria-expanded={isOpen}
      >
        <span className="metrics-icon">⚙</span>
        <span className="metrics-title">Session Metrics</span>
        <span className="metrics-chevron" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}>
          ▸
        </span>
      </button>

      <div className={`metrics-body-wrapper${isOpen ? ' metrics-body-open' : ''}`}>
        <div className="metrics-body-inner">
          <div className="metrics-body">
            <div className="metrics-group">
              <span className="metrics-group-label">Conversation</span>
              <div className="metrics-row">
                <span className="metrics-key">Mode</span>
                <span className="metrics-val">{modeLabel}</span>
              </div>
              <div className="metrics-row">
                <span className="metrics-key">Total Turns</span>
                <span className="metrics-val">{totalTurns}</span>
              </div>
              <div className="metrics-row">
                <span className="metrics-key">Phase 1 (Suitability)</span>
                <span className="metrics-val">{metrics.phase1Turns} turns</span>
              </div>
              <div className="metrics-row">
                <span className="metrics-key">Phase 2 (Compliance)</span>
                <span className="metrics-val">{metrics.phase2Turns} turns</span>
              </div>
              <div className="metrics-row">
                <span className="metrics-key">Phase 3 (Recommend)</span>
                <span className="metrics-val">{metrics.phase3Turns} turns</span>
              </div>
            </div>

            <div className="metrics-group">
              <span className="metrics-group-label">Model Quality</span>
              <div className="metrics-row">
                <span className="metrics-key">Extraction Success</span>
                <span className="metrics-val">
                  {metrics.extractionSuccessCount}/{totalTurns} ({extractionSuccessPct}%)
                </span>
              </div>
              <div className="metrics-row">
                <span className="metrics-key">Extraction Retries</span>
                <span className="metrics-val">{metrics.extractionRetryCount}</span>
              </div>
              <div className="metrics-row">
                <span className="metrics-key">Multi-Q Trims</span>
                <span className="metrics-val">{metrics.enforceOneQuestionTrims}</span>
              </div>
              <div className="metrics-row">
                <span className="metrics-key">Avg Fields/Turn</span>
                <span className="metrics-val">{avgFieldsPerTurn}</span>
              </div>
              <div className="metrics-row">
                <span className="metrics-key">Avg API Latency</span>
                <span className="metrics-val">{avgLatencyFormatted}</span>
              </div>
            </div>

            {metrics.guardrailAlerts.length > 0 && (
              <div className="metrics-group">
                <span className="metrics-group-label metrics-alerts-label">
                  Guardrail Alerts ({metrics.guardrailAlerts.length})
                </span>
                {metrics.guardrailAlerts.map((alert, i) => (
                  <div key={i} className="metrics-alert">
                    <span className="alert-turn">Turn {alert.turn}</span>
                    <span className="alert-type">{alert.type.replace(/_/g, ' ')}</span>
                    <span className="alert-msg">{alert.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface ComplianceRecordProps {
  kycRecord: KycRecord;
  suitabilityAssessment: SuitabilityAssessment;
  sessionMetrics?: SessionMetrics;
}

export function ComplianceRecord({ kycRecord, suitabilityAssessment, sessionMetrics }: ComplianceRecordProps) {
  const pi = kycRecord.personal_information;
  const ctr = kycRecord.citizenship_and_tax_residency;
  const emp = kycRecord.employment_and_income;
  const fp = kycRecord.financial_profile;
  const sof = kycRecord.source_of_funds;
  const pep = kycRecord.pep_and_sanctions;
  const pa = kycRecord.purpose_and_activity;
  const rp = suitabilityAssessment.risk_profile;
  const ik = suitabilityAssessment.investment_knowledge;
  const io = suitabilityAssessment.investment_objectives;
  const sd = suitabilityAssessment.suitability_determination;
  const flags = kycRecord.metadata.escalation_flags ?? [];

  const rawCompletion = computeCompletionFromRequiredFields(kycRecord, suitabilityAssessment);
  const status = kycRecord.metadata.completion_status;

  // When complete but high/critical flags exist, surface a distinct visual state.
  const hasHighFlags = flags.some((f) => f.severity === 'high' || f.severity === 'critical');
  const visualStatus =
    status === 'complete' && hasHighFlags ? 'complete_review' : status;

  const statusLabel =
    visualStatus === 'complete_review'
      ? 'Complete — Human Review Required'
      : visualStatus.replace(/_/g, ' ');

  // Pin progress bar to 100% once the onboarding is complete.
  const completionPct = status === 'complete' ? 100 : rawCompletion.pct;
  const completionFilled = status === 'complete' ? 20 : rawCompletion.filled;

  // Section field counts — each entry is [label, value] so the Section can show a preview
  const piData = countFields(
    ['First Name', pi?.legal_first_name],
    ['Last Name', pi?.legal_last_name],
    ['Date of Birth', pi?.date_of_birth],
    ['City', pi?.residential_address?.city],
    ['Province', pi?.residential_address?.province_territory],
    ['Email', pi?.email_address],
    ['SIN Provided', pi?.sin_provided],
  );
  const ctrData = countFields(
    ['Canadian Citizen', ctr?.canadian_citizen],
    ['Canadian Tax Resident', ctr?.canadian_tax_resident],
    ['US Person (FATCA)', ctr?.us_person],
  );
  const empData = countFields(
    ['Employment Status', emp?.employment_status],
    ['Job Title', emp?.job_title],
    ['Annual Income', emp?.annual_income_range],
    ['Insider / Control Person', emp?.is_insider_or_control_person],
  );
  const fpData = countFields(
    ['Net Worth', fp?.net_worth_range],
    ['Liquid Assets', fp?.liquid_assets_range],
    ['Outstanding Debt', fp?.outstanding_debt],
  );
  const sofData = countFields(
    ['Primary Source', sof?.primary_funding_source],
    ['Initial Deposit', sof?.initial_deposit_range],
    ['Expected Annual Deposits', sof?.expected_annual_deposits],
  );
  const pepData = countFields(
    ['Politically Exposed Person', pep?.is_pep],
  );
  const paData = countFields(
    ['Account Purpose(s)', pa?.account_purpose],
    ['Time Horizon', pa?.investment_time_horizon],
    ['Trading Frequency', pa?.expected_trading_frequency],
  );
  const rpData = countFields(
    ['Stated Risk Tolerance', rp?.stated_risk_tolerance],
    ['Assessed Risk Tolerance', rp?.assessed_risk_tolerance],
    ['Risk Mismatch', rp?.risk_mismatch_detected],
    ['Loss Reaction', rp?.behavioral_risk_signals?.loss_reaction],
    ['Safety-First Language', rp?.behavioral_risk_signals?.safety_first_language],
    ['Volatility Experience', rp?.behavioral_risk_signals?.experience_with_volatility],
  );
  const ikData = countFields(
    ['Self-Assessed Level', ik?.self_assessed_level],
    ['Assessed Level', ik?.assessed_knowledge_level],
    ['Prior Experience', ik?.demonstrated_knowledge_signals?.has_prior_investment_experience],
  );
  const ioData = countFields(
    ['Primary Objective', io?.primary_objective],
    ['Time Horizon', io?.time_horizon],
    ['Liquidity Needs', io?.liquidity_needs],
    ['Specific Goals', io?.specific_goals?.length ? io.specific_goals : undefined],
  );

  return (
    <div className="compliance-pane">
      {/* Header */}
      <div className="compliance-header">
        <div className="compliance-header-top">
          <span className="compliance-title">Live Compliance Record</span>
          <span className={`status-badge status-${visualStatus}`}>
            {statusLabel}
          </span>
        </div>
        <div className="completion-row">
          <div className="completion-track">
            <div className="completion-fill" style={{ width: `${completionPct}%` }} />
          </div>
          <span className="completion-pct">{completionFilled}/20 complete</span>
        </div>
        {flags.length > 0 && (
          <div className="flag-summary">
            ⚠ {flags.length} escalation {flags.length === 1 ? 'flag' : 'flags'} — human review required
          </div>
        )}
      </div>

      <div className="compliance-body">
        <EscalationFlags flags={flags} />

        {sd?.suitable_account_types && sd.suitable_account_types.length > 0 && (
          <Recommendation determination={sd} />
        )}

        {/* Personal Information */}
        <Section title="Personal Information" icon="👤" {...piData}>
          <Field label="First Name" value={pi?.legal_first_name} />
          <Field label="Last Name" value={pi?.legal_last_name} />
          <Field label="Date of Birth" value={pi?.date_of_birth} />
          <Field label="City" value={pi?.residential_address?.city} />
          <Field label="Province" value={pi?.residential_address?.province_territory} />
          <Field label="Postal Code" value={pi?.residential_address?.postal_code} />
          <Field label="Email" value={pi?.email_address} />
          <Field label="Phone" value={pi?.phone_number} />
          <Field label="SIN Provided" value={pi?.sin_provided} />
          {pi?.sin_provided && (
            <Field label="SIN" value={pi?.social_insurance_number ?? '●●●-●●●-provided'} sensitive />
          )}
        </Section>

        {/* Citizenship & Tax */}
        <Section title="Citizenship & Tax Residency" icon="🍁" {...ctrData}>
          <Field label="Canadian Citizen" value={ctr?.canadian_citizen} />
          <Field label="Canadian Tax Resident" value={ctr?.canadian_tax_resident} />
          <Field label="US Person (FATCA)" value={ctr?.us_person} highlight={ctr?.us_person === true} />
          {ctr?.other_tax_residencies && ctr.other_tax_residencies.length > 0 && (
            <Field
              label="Other Tax Residencies"
              value={ctr.other_tax_residencies.map((r) => r.country).join(', ')}
            />
          )}
        </Section>

        {/* Employment & Income */}
        <Section title="Employment & Income" icon="💼" {...empData}>
          <Field label="Employment Status" value={emp?.employment_status} />
          <Field label="Job Title" value={emp?.job_title} />
          <Field label="Employer" value={emp?.employer_name} />
          <Field label="Industry" value={emp?.industry} />
          <Field label="Annual Income" value={emp?.annual_income_range} />
          <Field label="Insider / Control Person" value={emp?.is_insider_or_control_person} highlight={emp?.is_insider_or_control_person === true} />
          {emp?.is_insider_or_control_person && (
            <Field label="Insider Company" value={emp?.insider_company_name} />
          )}
        </Section>

        {/* Financial Profile */}
        <Section title="Financial Profile" icon="📊" {...fpData}>
          <Field label="Net Worth" value={fp?.net_worth_range} />
          <Field label="Liquid Assets" value={fp?.liquid_assets_range} />
          <Field label="Monthly Expenses" value={fp?.fixed_monthly_expenses} />
          <Field label="Outstanding Debt" value={fp?.outstanding_debt} />
          {fp?.outstanding_debt && (
            <Field label="Debt Details" value={fp?.debt_details} />
          )}
        </Section>

        {/* Source of Funds */}
        <Section title="Source of Funds" icon="💰" {...sofData}>
          <Field label="Primary Source" value={sof?.primary_funding_source} />
          <Field label="Source Details" value={sof?.funding_source_details} />
          <Field label="Initial Deposit" value={sof?.initial_deposit_range} />
          <Field label="Expected Annual Deposits" value={sof?.expected_annual_deposits} />
        </Section>

        {/* PEP & Sanctions */}
        <Section title="PEP & Sanctions" icon="🔍" {...pepData}>
          <Field label="Politically Exposed Person" value={pep?.is_pep} highlight={pep?.is_pep === true} />
          {pep?.is_pep && (
            <>
              <Field label="PEP Type" value={pep?.pep_type} />
              <Field label="Position Details" value={pep?.pep_position_details} />
            </>
          )}
          <Field label="Family of PEP" value={pep?.is_family_of_pep} highlight={pep?.is_family_of_pep === true} />
          <Field label="Close Associate of PEP" value={pep?.is_close_associate_of_pep} highlight={pep?.is_close_associate_of_pep === true} />
        </Section>

        {/* Account Purpose & Activity */}
        <Section title="Account Purpose & Activity" icon="🎯" {...paData}>
          <Field label="Account Purpose(s)" value={pa?.account_purpose} />
          <Field label="Time Horizon" value={pa?.investment_time_horizon} />
          <Field label="Trading Frequency" value={pa?.expected_trading_frequency} />
          <Field label="Third-Party Authority" value={pa?.third_party_involvement} />
        </Section>

        {/* Risk Profile */}
        <Section title="Risk Profile" icon="📈" {...rpData}>
          <Field label="Stated Risk Tolerance" value={rp?.stated_risk_tolerance} />
          <Field label="Assessed Risk Tolerance" value={rp?.assessed_risk_tolerance} />
          <Field label="Risk Mismatch" value={rp?.risk_mismatch_detected} highlight={rp?.risk_mismatch_detected === true} />
          {rp?.risk_mismatch_detected && (
            <Field label="Mismatch Explanation" value={rp?.risk_mismatch_explanation} />
          )}
          <Field label="Loss Reaction" value={rp?.behavioral_risk_signals?.loss_reaction} />
          <Field label="Safety-First Language" value={rp?.behavioral_risk_signals?.safety_first_language} />
          <Field label="Volatility Experience" value={rp?.behavioral_risk_signals?.experience_with_volatility} />
        </Section>

        {/* Investment Knowledge */}
        <Section title="Investment Knowledge" icon="🎓" {...ikData}>
          <Field label="Self-Assessed Level" value={ik?.self_assessed_level} />
          <Field label="Assessed Level" value={ik?.assessed_knowledge_level} />
          <Field label="Prior Experience" value={ik?.demonstrated_knowledge_signals?.has_prior_investment_experience} />
          {ik?.demonstrated_knowledge_signals?.prior_investment_types && (
            <Field label="Prior Investment Types" value={ik.demonstrated_knowledge_signals.prior_investment_types} />
          )}
          {ik?.knowledge_gaps_identified && ik.knowledge_gaps_identified.length > 0 && (
            <Field label="Knowledge Gaps" value={ik.knowledge_gaps_identified} />
          )}
        </Section>

        {/* Investment Objectives */}
        <Section title="Investment Objectives" icon="🏆" {...ioData}>
          <Field label="Primary Objective" value={io?.primary_objective} />
          <Field label="Time Horizon" value={io?.time_horizon} />
          <Field label="Liquidity Needs" value={io?.liquidity_needs} />
          {io?.specific_goals && io.specific_goals.length > 0 && (
            <div className="goals-list">
              {io.specific_goals.map((g, i) => (
                <div key={i} className="goal-item">
                  <span className="goal-type">{g.goal_type.replace(/_/g, ' ')}</span>
                  <span className={`goal-priority priority-${g.priority}`}>{g.priority}</span>
                  {g.target_amount && <span className="goal-meta">Target: {g.target_amount}</span>}
                  {g.target_date && <span className="goal-meta">By: {g.target_date}</span>}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Session Metrics — shown when session is complete */}
        {status === 'complete' && sessionMetrics && (
          <SessionMetricsPanel metrics={sessionMetrics} />
        )}

        {/* Footer */}
        <div className="record-footer">
          <span>Record ID: {kycRecord.metadata.record_id.slice(0, 8)}…</span>
          <span>Updated: {new Date(kycRecord.metadata.updated_at).toLocaleTimeString()}</span>
          <span className="disclaimer">Prototype — not a real compliance record</span>
        </div>
      </div>
    </div>
  );
}
