# CLAUDE.md — Project Context for Claude Code

## What This Project Is

An AI-native onboarding prototype for Wealthsimple's AI Builders program. It replaces the traditional form-based KYC and suitability questionnaire with a conversational AI agent that collects compliance data through natural dialogue, assesses investment suitability dynamically, and recommends the right account type(s).

This is a prototype for a job application, not a production system. Prioritize demonstrating clear thinking, real regulatory awareness, and meaningful AI responsibility over polish.

## Architecture

- **Frontend:** React + TypeScript, split-pane layout (chat on left, live compliance record on right)
- **Backend:** Node.js + Express API server
- **AI Engine:** Anthropic Claude API (claude-sonnet-4-20250514) with a domain-specific system prompt
- **State:** Server-side conversation state with progressive structured data extraction

## Key Files

- `docs/kyc-schema.json` — The structured KYC data model (Canadian FINTRAC requirements)
- `docs/suitability-framework.json` — Investment suitability assessment dimensions
- `docs/account-routing-rules.json` — Decision logic for account type recommendations
- `docs/system-prompt.md` — The AI agent's system prompt (personality, rules, edge cases)

## Development Conventions

- Use TypeScript throughout (both frontend and backend)
- Keep the AI agent's system prompt in a separate file, not hardcoded in the API route
- The backend maintains conversation state per session (in-memory for the prototype)
- Every AI response should return both the chat message AND an updated structured record
- The frontend should show the structured record updating in real time as the conversation progresses
- Handle edge cases explicitly (PEP detection, risk mismatches, SIN refusal, etc.)

## Regulatory Context (Important)

This models Canadian financial regulations:
- **FINTRAC** — KYC, source of funds, PEP screening
- **CSA NI 31-103** — Know Your Client, Know Your Product, suitability
- **CRA** — TFSA/RRSP/FHSA/RESP contribution rules and eligibility

Assumptions are acceptable (this is a prototype) but should be stated explicitly in the code and documentation.

## What "Done" Looks Like

A working demo where you can:
1. Start a conversation with the AI agent
2. Talk naturally about your financial goals and situation
3. Watch the compliance record fill in on the right side in real time
4. Receive a personalized account recommendation with clear rationale
5. See edge case handling (contradictory info, PEP flags, risk mismatches)
6. Approve or modify the recommendation

## Commands

```bash
npm run dev        # Start both frontend and backend in development mode
npm run server     # Start backend only
npm run client     # Start frontend only
npm run build      # Build for production
```
