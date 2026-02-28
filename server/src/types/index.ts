// ─── KYC Record Types (aligned with docs/kyc-schema.json) ───────────────────

export interface EscalationFlag {
  flag_type:
    | 'pep_detected'
    | 'contradictory_information'
    | 'high_risk_jurisdiction'
    | 'unusual_source_of_funds'
    | 'non_resident_tax_complexity'
    | 'suitability_mismatch'
    | 'incomplete_information'
    | 'sanctions_screening_required'
    | 'age_eligibility_concern';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  triggered_at: string;
}

export interface KycRecord {
  metadata: {
    record_id: string;
    created_at: string;
    updated_at: string;
    conversation_id: string;
    agent_version: string;
    completion_status: 'in_progress' | 'complete' | 'escalated' | 'abandoned';
    escalation_flags: EscalationFlag[];
  };
  personal_information?: {
    legal_first_name?: string;
    legal_last_name?: string;
    date_of_birth?: string;
    residential_address?: {
      street_address?: string;
      city?: string;
      province_territory?: string;
      postal_code?: string;
      country?: string;
    };
    phone_number?: string;
    email_address?: string;
    sin_provided?: boolean;
    social_insurance_number?: string; // always stored masked
  };
  citizenship_and_tax_residency?: {
    canadian_citizen?: boolean;
    canadian_tax_resident?: boolean;
    us_person?: boolean;
    other_tax_residencies?: Array<{
      country: string;
      tax_identification_number?: string;
    }>;
  };
  employment_and_income?: {
    employment_status?: string;
    employer_name?: string;
    job_title?: string;
    industry?: string;
    annual_income_range?: string;
    is_insider_or_control_person?: boolean;
    insider_company_name?: string;
  };
  financial_profile?: {
    net_worth_range?: string;
    liquid_assets_range?: string;
    fixed_monthly_expenses?: string;
    outstanding_debt?: boolean;
    debt_details?: string;
  };
  source_of_funds?: {
    primary_funding_source?: string;
    funding_source_details?: string;
    initial_deposit_range?: string;
    expected_annual_deposits?: string;
  };
  pep_and_sanctions?: {
    is_pep?: boolean;
    pep_type?: string;
    pep_position_details?: string;
    is_family_of_pep?: boolean;
    is_close_associate_of_pep?: boolean;
  };
  purpose_and_activity?: {
    account_purpose?: string[];
    investment_time_horizon?: string;
    expected_trading_frequency?: string;
    third_party_involvement?: boolean;
  };
}

// ─── Suitability Assessment Types (aligned with docs/suitability-framework.json) ──

export interface SuitabilityAssessment {
  risk_profile?: {
    stated_risk_tolerance?: string;
    behavioral_risk_signals?: {
      loss_reaction?: string;
      time_pressure_language?: boolean;
      safety_first_language?: boolean;
      experience_with_volatility?: boolean;
    };
    assessed_risk_tolerance?: string;
    risk_mismatch_detected?: boolean;
    risk_mismatch_explanation?: string;
  };
  investment_knowledge?: {
    self_assessed_level?: string;
    demonstrated_knowledge_signals?: {
      understands_diversification?: boolean;
      understands_compound_growth?: boolean;
      understands_registered_accounts?: boolean;
      understands_risk_return_tradeoff?: boolean;
      uses_financial_terminology?: boolean;
      has_prior_investment_experience?: boolean;
      prior_investment_types?: string[];
    };
    assessed_knowledge_level?: string;
    knowledge_gaps_identified?: string[];
  };
  investment_objectives?: {
    primary_objective?: string;
    specific_goals?: Array<{
      goal_type: string;
      target_amount?: string;
      target_date?: string;
      priority: string;
    }>;
    time_horizon?: string;
    liquidity_needs?: string;
  };
  suitability_determination?: {
    suitable_account_types?: string[];
    recommended_portfolio_approach?: string;
    recommended_asset_allocation?: {
      equities_pct?: number;
      fixed_income_pct?: number;
      alternatives_pct?: number;
    };
    suitability_score?: number;
    suitability_rationale?: string;
    warnings?: Array<{
      warning_type: string;
      description: string;
      severity: string;
      action_taken: string;
    }>;
  };
}

// ─── Session / Conversation Types ────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  /** If false, this message is part of internal Claude context but not shown in the UI */
  visible: boolean;
}

export interface Session {
  id: string;
  messages: ChatMessage[];
  kycRecord: KycRecord;
  suitabilityAssessment: SuitabilityAssessment;
  lastRawResponse?: string; // Raw Claude text before parsing — for debug endpoint
  /** Flat key→value snapshot of all fields logged in prior turns, used for delta computation. */
  previousFields?: Map<string, string>;
  createdAt: string;
  updatedAt: string;
}

// ─── API Request / Response Types ────────────────────────────────────────────

export interface CreateSessionResponse {
  sessionId: string;
  message: string;
  kycRecord: KycRecord;
  suitabilityAssessment: SuitabilityAssessment;
}

export interface ChatRequest {
  message: string;
}

export interface ChatResponse {
  message: string;
  kycRecord: KycRecord;
  suitabilityAssessment: SuitabilityAssessment;
  sessionId: string;
}

// ─── Claude Extraction Types ──────────────────────────────────────────────────

export interface ExtractionResult {
  kyc_updates: Partial<KycRecord>;
  suitability_updates: Partial<SuitabilityAssessment>;
  escalation_flags: Array<Omit<EscalationFlag, 'triggered_at'>>;
}
