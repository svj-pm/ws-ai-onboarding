# AI-Native Onboarding: Replacing the Legacy KYC & Suitability Funnel

A prototype AI system that transforms rigid, form-based financial onboarding into a natural conversation — while maintaining full regulatory compliance.

Built for the [Wealthsimple AI Builders Program](https://www.wealthsimple.com/en-ca/careers/ai-builders).

## The Problem

Financial onboarding is broken. The standard flow forces users through a series of static forms: personal information, employment details, suitability questionnaires, document uploads. Each step is a compliance checkbox, not a human conversation. The result? Massive drop-off between sign-up and funding.

This system replaces that entire funnel with a single conversational AI agent that:

- **Collects KYC information** through natural dialogue (not form fields)
- **Assesses suitability dynamically** as the conversation progresses (not as a separate step)
- **Recommends the right account type(s)** based on the user's actual goals and situation
- **Produces a structured compliance record** that a human reviewer can audit in real time
- **Flags edge cases for human escalation** (PEPs, contradictory risk signals, non-resident tax complexity)

## Human / AI Boundary

| Responsibility | Owner |
|---|---|
| Conversation, data collection, suitability assessment, account recommendation | AI Agent |
| Final approval of recommendation, edge case resolution, regulatory sign-off | Human Reviewer |
| Override authority on any AI decision | Human (always) |

The AI is not replacing compliance. It is making compliance invisible to the user while being *more thorough* than a static form.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  React Frontend                  │
│  ┌──────────────────┐  ┌──────────────────────┐ │
│  │  Chat Interface   │  │  Live Compliance     │ │
│  │  (User ↔ Agent)   │  │  Record Panel        │ │
│  └──────────────────┘  └──────────────────────┘ │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│              Backend API Server                   │
│  ┌──────────────┐  ┌───────────────────────────┐│
│  │ Conversation  │  │  Rules Engine             ││
│  │ State Manager │  │  (KYC + Suitability +     ││
│  │               │  │   Account Routing)        ││
│  └──────┬───────┘  └───────────┬───────────────┘│
│         │                      │                 │
│         ▼                      ▼                 │
│  ┌──────────────────────────────────────────┐   │
│  │         Anthropic Claude API              │   │
│  │   (Reasoning Engine + System Prompt)      │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

## Tech Stack

- **Frontend:** React + TypeScript
- **Backend:** Node.js + Express
- **AI Engine:** Anthropic Claude API (claude-sonnet-4-20250514)
- **State Management:** Server-side conversation state with structured extraction

## Getting Started

```bash
# Clone the repo
git clone https://github.com/[your-username]/ws-ai-onboarding.git
cd ws-ai-onboarding

# Install dependencies
npm install

# Set your Anthropic API key
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Start the development server
npm run dev
```

## Project Structure

```
ws-ai-onboarding/
├── README.md
├── docs/
│   ├── kyc-schema.json            # Canadian KYC data requirements
│   ├── suitability-framework.json # Investment suitability dimensions
│   ├── account-routing-rules.json # Account recommendation logic
│   └── system-prompt.md           # AI agent system prompt
├── src/
│   ├── server/                    # Express backend
│   ├── client/                    # React frontend
│   └── engine/                    # Rules engine + state manager
├── package.json
└── .env.example
```

## Regulatory Context

This prototype models Canadian KYC and suitability requirements, including:

- **Know Your Client (KYC):** FINTRAC requirements for identity verification, source of funds, PEP screening
- **Know Your Product (KYP):** CSA National Instrument 31-103 suitability obligations
- **Account-specific rules:** TFSA/RRSP/FHSA contribution eligibility, residency requirements

**Assumption:** This is a prototype. In production, identity verification would integrate with third-party providers (e.g., Equifax, TransUnion) and the compliance record would feed into Wealthsimple's existing regulatory infrastructure.

## Author

Santiago Vinoth Jeyaseelan — [LinkedIn](https://linkedin.com/in/santiago-v-jeyaseelan) — [sv-j.com](https://sv-j.com)
