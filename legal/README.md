# ScrollTax — Legal & Compliance

This folder holds the legal foundation needed before a real-money (mainnet)
launch. The documents are **drafts grounded in how the app actually works**, with
`[BRACKET]` placeholders you must fill in.

| Document | What it is | Status |
|----------|-----------|--------|
| [PRIVACY_POLICY.md](./PRIVACY_POLICY.md) | User-facing privacy policy | Draft — needs counsel review + hosting at a public URL |
| [TERMS_OF_SERVICE.md](./TERMS_OF_SERVICE.md) | User-facing terms | Draft — needs counsel review |
| [PLAY_STORE_DECLARATIONS.md](./PLAY_STORE_DECLARATIONS.md) | Play Console declarations (Usage Access, FGS `specialUse`, Data Safety) | Ready to use; verify against the submitted build |
| [COMPLIANCE_REVIEW_MEMO.md](./COMPLIANCE_REVIEW_MEMO.md) | Briefing for a lawyer on gambling/MTL/AML | Ready to hand to counsel |

## What's done here vs. what still needs humans

**Done (this folder):** accurate draft Privacy Policy & Terms, complete Play
Store declaration text, and a compliance memo that frames the exact questions for
a lawyer.

**Cannot be done in-repo — requires qualified humans:**
1. **Gambling / money-transmitter / AML classification** — only a lawyer can
   determine whether the stake-and-redistribute mechanic is gambling, contests,
   or money transmission in your target jurisdictions. **This is the gating
   decision** (see the memo, §5). The draft Terms/Privacy Policy can only be
   finalized once it's answered.
2. **Third-party security audit** — by definition an external firm; recommended
   before holding real customer funds.
3. **Filling placeholders** — legal entity, contact addresses, governing law,
   age limits, fees, restricted territories.

## Before mainnet (legal track)

1. Engage counsel with [COMPLIANCE_REVIEW_MEMO.md](./COMPLIANCE_REVIEW_MEMO.md).
2. Finalize Privacy Policy & Terms per their guidance; fill placeholders.
3. Implement in-app consent (Usage Access disclosure) + account-deletion flow.
4. Host the Privacy Policy publicly; add the URL to Play Console + the app.
5. Commission the security audit; remediate.
6. Complete Play declarations ([PLAY_STORE_DECLARATIONS.md](./PLAY_STORE_DECLARATIONS.md)).
