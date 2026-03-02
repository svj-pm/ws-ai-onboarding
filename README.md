# AI-Native Onboarding for Wealth Management Companies in Canadian Market

An AI-powered conversational onboarding system that replaces traditional form-based KYC and suitability collection with a natural conversation. Built for the an AI Builders program.

## The Problem

Traditional investment account onboarding uses multi-page forms that kill conversion. Users abandon because the process is long, impersonal, and asks questions without context. At Gainbridge, I improved sign-to-funded rates from 30% to 70% by rethinking the onboarding funnel. This prototype applies the same philosophy using conversational AI.

## What This Does

A user opens a chat and says something like "I want to save for retirement" or "I'm a 39-year-old tech professional making $100K." The AI agent has a natural conversation, collecting the 20 data points required by Canadian regulations (FINTRAC KYC + CSA NI 31-103 suitability) while making it feel like talking to a knowledgeable advisor. At the end, the user gets a personalized account recommendation with a projected growth visualization.

## Key Features

### Dual Conversation Modes
- **Exploratory mode**: For vague openers like "I want to invest." Asks broad, open-ended questions targeting 2-3 data points per turn.
- **Accelerated mode**: For detailed openers like "I'm 39, tech professional in Toronto, $100K income, want to save for retirement." Extracts everything from the opener and skips redundant questions.

### Real-Time Compliance Panel
- Live compliance record updates as the conversation progresses
- 20-field completion tracker (13 KYC + 7 suitability) — the legal minimum for a Canadian investment account
- Escalation banners for PEP detection and suitability mismatches
- Conversation audit summary generated on completion

### Intelligent Data Extraction
- Flat dot-notation extraction format for reliable parsing
- Delta-only server logging showing exactly what's new each turn
- Inference rules: employment status from job mentions, tax residency from address, knowledge level from described experience
- Two-layer validation: agent-level prompting + backend safety nets (e.g., SIN format validation)

### Account Recommendation Engine
- Routes users to appropriate account types (TFSA, RRSP, FHSA, RESP, Non-Registered, Corporate)
- Portfolio approach recommendation based on assessed risk tolerance and investment knowledge
- Projected growth chart visualization with compound growth modeling
- Suitability score with written rationale

### Production Monitoring
- Session metrics: mode detection, phase breakdown, extraction success rate, API latency tracking
- Guardrail alerts: extraction failures, stalled progress, consistency drift, high latency, excessive turns
- Session summary printed on completion with full conversation analytics

### Edge Case Handling
- **PEP detection**: Identifies politically exposed persons, flags for enhanced due diligence, continues collecting all required fields
- **Risk mismatch**: Detects when stated risk tolerance contradicts behavioral signals, escalates appropriately
- **SIN validation**: 9-digit format enforcement with agent + backend dual validation
- **Postal code validation**: Canadian format checking with correction prompting

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     React Frontend                       │
│  ┌──────────────────┐  ┌──────────────────────────────┐ │
│  │  Chat Interface  │  │   Live Compliance Panel      │ │
│  │                  │  │   - Field tracking (20/20)   │ │
│  │  Conversational  │  │   - Escalation banners       │ │
│  │  onboarding flow │  │   - Growth chart             │ │
│  │                  │  │   - Session metrics          │ │
│  │                  │  │   - Audit summary            │ │
│  └──────────────────┘  └──────────────────────────────┘ │
└─────────────────────┬───────────────────────────────────┘
                      │ REST API
┌─────────────────────▼───────────────────────────────────┐
│                   Express Backend                        │
│  - Session management (in-memory)                        │
│  - Extraction parsing + deep merge                       │
│  - Completion tracking (20 required fields)              │
│  - Guardrail checks + metrics collection                 │
│  - SIN/postal code backend validation                    │
│  - Flag deduplication                                    │
└─────────────────────┬───────────────────────────────────┘
                      │ API
┌─────────────────────▼───────────────────────────────────┐
│           Claude (claude-sonnet-4-20250514)               │
│  - System prompt with conversation rules                 │
│  - Per-turn extraction reminder injection                │
│  - Structured data extraction (flat dot-notation)        │
│  - One-question enforcement                              │
│  - Behavioral risk assessment                            │
└─────────────────────────────────────────────────────────┘
```

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Node.js + Express + TypeScript
- **AI**: Anthropic Claude API (claude-sonnet-4-20250514)
- **State**: Server-side session management with progressive field accumulation

## Running Locally

```bash
# Clone the repo
git clone https://github.com/svj-pm/ws-ai-onboarding.git
cd ws-ai-onboarding

# Install dependencies
npm install
cd client && npm install && cd ..
cd server && npm install && cd ..

# Set up environment
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env

# Start development
npm run dev
# Frontend: http://localhost:5173
# Backend: http://localhost:3001
```

## Regulatory Context

This system is designed for the Canadian investment account opening process:
- **FINTRAC**: Know Your Client requirements for identity verification, source of funds, PEP screening
- **CSA NI 31-103**: Suitability assessment requirements including risk tolerance, investment knowledge, financial situation, and investment objectives
- **FATCA**: US person identification for cross-border tax compliance

## What I'd Build Next

- **Address contradiction detection**: Flag when opener location differs from provided address
- **Conversation branching**: Handle users who change their mind mid-conversation about goals or risk tolerance
- **Multi-language support**: French conversation flow for Quebec compliance
- **A/B testing framework**: Compare conversion rates between AI onboarding and traditional forms
- **Human handoff protocol**: Seamless escalation to a live advisor when the AI reaches its limits
- **Document upload**: ID verification and proof of address within the conversation flow

## Author

Santiago Vinoth Jeyaseelan — [LinkedIn](https://www.linkedin.com/in/santiago-v-jeyaseelan/) - [sv-j.com](https://sv-j.com/)
