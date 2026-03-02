# Written Explanation

## What the human can now do that they couldn't before

A user can open an investment account by having a conversation instead of filling out forms. That sounds simple, but that gap is where conversion dies. At Gainbridge, I watched the majority of users drop off between sign-up and funding because the onboarding flow felt like a compliance interrogation. When I redesigned it as a guided experience, sign-to-funded rates went from 30% to 70%.

This prototype applies the same principle with AI doing the guiding. A user says, "I'm 35, work in tech, want to save for retirement," and the system extracts age, employment, location, and investment objective from that single sentence. The compliance record fills in behind the scenes. The user never sees a form, but every FINTRAC and CSA NI 31-103 requirement gets collected.

The compliance officer gets something new too: a structured, audit-ready record with escalation flags, behavioral risk signals, and a suitability score — not a stack of form submissions to review manually.

## What AI is responsible for

The AI handles three jobs simultaneously during every conversation turn.

First, it manages the conversation — asking the right questions at the right time, inferring fields from natural language (e.g., mentioning a Toronto address means the user is a Canadian tax resident), and adjusting its approach based on how much the user volunteers upfront.

Second, it extracts structured data. Every response includes a machine-readable block that maps what the user said to specific compliance fields. A backend pipeline parses, validates, and progressively merges this into the session record.

Third, it monitors for edge cases in real time. When a user says they want aggressive crypto exposure but also can't afford to lose money, the system catches the contradiction, splits stated risk tolerance from assessed risk tolerance, and refuses to proceed until the mismatch is resolved. When it detects a politically exposed person, it flags for enhanced due diligence without blocking the conversation.

## Where AI must stop

Three boundaries are built into the system.

The AI will not recommend until all 20 mandatory compliance fields are collected. No shortcuts.

When it detects a situation beyond its capability — a multi-jurisdiction family trust, an offshore holding company, a user who asks for a human — it triggers a handoff. It packages the conversation context, the partial compliance record, and the reason, then routes to a human advisor. The chat locks. The AI is done.

The AI never has final authority. Every recommendation requires human approval. Escalated sessions require human review before any account opens.

## What would break first at scale

Latency. As conversations get longer, API response times climb. In testing, later turns hit 30+ seconds. At scale with thousands of concurrent sessions, this compounds. The fix is context summarization — compress earlier turns to keep the window manageable.

Second, extraction reliability. The system currently hits 100% extraction success, but that's with a retry mechanism masking occasional failures. At volume, even a 2% failure rate means thousands of incomplete records daily.

Third, the consistency drift guardrail produces false positives — flagging field refinements, not just genuine contradictions. At scale, this noise would overwhelm reviewers. The guardrail needs semantic comparison, not string equality.
