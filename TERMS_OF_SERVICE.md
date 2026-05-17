# mLearn Cloud Terms of Service

**Version 1.1 — Effective Date: 2026-05-18**

**Operator:** Adrian Vlasov, Vaud, Switzerland  
**Contact:** adrian@kikan.net (legal) | support@kikan.net (technical)  
**Service:** mLearn Cloud relay and sync infrastructure (mlearn-cloud.kikan.net)

---

## 1. Scope

These Terms of Service ("ToS") apply ONLY to the cloud-hosted services
accessible through a mLearn Cloud account, including:

- Cloud LLM relay (mlearn-cloud.kikan.net)
- Cloud OCR processing
- Cloud TTS / voice cloning (via Modal infrastructure)
- Watch Together session coordination (playback state sync only)
- Flashcard and settings sync (via Cloudflare Durable Objects and Supabase)
- Quota tracking and billing

These ToS do NOT apply to self-hosted, local-only, or forked versions
of the software.

### 1.1 Definitions

For the purposes of these Terms:
- **"Service"** means the mLearn Cloud relay and sync infrastructure accessible at mlearn-cloud.kikan.net.
- **"Software"** means the mLearn language immersion application, browser extension, installer, and associated documentation.
- **"Cloud Features"** means features that require a connection to the Service, including but not limited to Cloud LLM relay, Cloud OCR, Cloud TTS, Watch Together, and flashcard sync.
- **"Plugin"** means a third-party software module loaded via the local plugin manifest system.
- **"Quota"** means the allocated usage limit for Cloud Features.
- **"Institutional User"** means a school, university, tutoring center, or other educational institution.
- **"Operator"**, **"We"**, or **"Us"** means Adrian Vlasov.
- **"You"** or **"User"** means the individual using the Service.

### 1.2 Hierarchy

To the extent of any conflict between the mLearn End User License Agreement (EULA) and these Terms of Service, these Terms govern Cloud Services and the EULA governs the Software.

### 1.3 Disclaimer of Warranties

THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.

YOU ASSUME ALL RISKS ASSOCIATED WITH USE. WE DO NOT GUARANTEE
AVAILABILITY, COMPATIBILITY, OR ERROR-FREE OPERATION OF THE SERVICE.

## 2. Account & Eligibility

You must create an account to use cloud features. By creating an account,
you certify that:

- You are at least 18 years of age, or the age of majority in your
  jurisdiction, whichever is higher;
- You will provide accurate account information;
- You are legally capable of entering into a binding contract.

One person per account. We may suspend accounts used for credential
sharing, abuse, or circumvention of rate limits.

### 2.1 No Institutional or Minor Use
These cloud terms apply to individual adult users only. Schools,
universities, tutoring centers, and other institutions may NOT create
accounts on behalf of students under 18. If you are an educator,
consult SCHOOL_DEPLOYMENT.md for the self-hosting package.

## 3. Cloud AI Features

### 3.1 Nature of Service
The Cloud LLM relay forwards your messages to third-party AI providers
(e.g., Cerebras). We do not train or fine-tune models on your data. We
do not store the content of your conversations. All AI outputs are
probabilistic and may be inaccurate, inappropriate, or unexpected.

### 3.2 Safety Screening
An optional automated screening tool may analyze conversation content for
potentially harmful references. If triggered, the conversation is
terminated and crisis resources are displayed. This tool:

- is NOT 100% accurate;
- is NOT medically validated;
- is NOT emergency services or human monitoring;
- is provided for convenience only.

You may disable this tool in Settings, subject to quota implications.

### 3.3 No Professional Advice
The cloud AI features are language-learning tools only. They do not
provide medical, legal, psychological, or safety-critical advice.

## 4. Acceptable Use

You agree NOT to use the cloud service to:

- Generate or distribute illegal content (CSAM, hate speech, incitement
  to violence);
- Clone voices without the speaker's explicit consent;
- Harass, impersonate, or defame any person;
- Circumvent rate limits, quotas, or authentication;
- Reverse-engineer, scrape, or abuse the API endpoints;
- Upload copyrighted material for OCR unless you have the right to do so.

Violations may result in immediate account suspension and forfeiture of
remaining quota.

## 5. Data & Privacy

We process data only to provide the service. See the Privacy Policy for
retention periods and third-party processors.

Briefly:

- We do NOT store chat logs or conversation content
- OCR images and TTS audio are deleted immediately after processing
- Job metadata may be retained briefly for status tracking
- We do NOT train AI models on your data
- We do NOT sell your data

## 6. Quotas & Payments

### 6.1 Free Tier
Cloud features are currently offered with limited free quota. We reserve
the right to modify, reduce, or discontinue free quota with reasonable
notice, or at the end of the current billing period.

### 6.2 Future Paid Tier
If paid quotas are introduced, they will be billed through a separate
payment processor. You must be notified before any charges occur.

### 6.3 No Refunds
Quota is consumed on use. We do not refund consumed quota except in cases
of demonstrable service error on our part, or at our sole discretion.

## 7. Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE TOTAL LIABILITY
OF THE OPERATOR FOR ANY CLAIMS ARISING OUT OF OR RELATING TO YOUR USE OF
THE CLOUD SERVICE SHALL NOT EXCEED THE TOTAL FEES PAID BY YOU TO THE
OPERATOR DURING THE TWELVE (12) MONTHS IMMEDIATELY PRECEDING THE EVENT
GIVING RISE TO LIABILITY.

THIS LIMITATION DOES NOT APPLY TO: (A) GROSS NEGLIGENCE OR WILLFUL
MISCONDUCT; (B) DEATH OR PERSONAL INJURY CAUSED BY NEGLIGENCE; OR (C)
LIABILITY THAT CANNOT BE EXCLUDED UNDER MANDATORY SWISS LAW.

## 8. Termination

You may delete your account at any time. We may suspend or terminate your
account for violations of this ToS, abuse, or if required by law.
Upon termination, your quota is forfeited and sync data will be deleted
within thirty (30) days, except where retention is required by law or
for fraud prevention.

## 9. Governing Law and Dispute Resolution

These Terms are governed by the laws of Switzerland. Disputes shall be
resolved in the courts of the canton of Vaud, unless mandatory consumer
law requires otherwise.

Before filing any claim, you agree to attempt to resolve the dispute
informally by contacting us. If unresolved within thirty (30) days,
either party may pursue mediation. Nothing in this clause prevents either
party from seeking injunctive relief. Mandatory consumer protection law
in your jurisdiction — including, where applicable, EU consumer protection
law — may override the governing law and jurisdiction clauses above to the
extent required by mandatory law.

## 10. Changes

We may update these Terms. Material changes will be notified via email
and/or in-app notice at least thirty (30) days before they take effect.
Continued use after the effective date constitutes acceptance.

## 11. Indemnification

You agree to indemnify, defend, and hold harmless the Operator from and
against any and all claims, damages, losses, liabilities, costs, and
expenses (including reasonable attorneys' fees) arising out of or relating
to: (a) your misuse of the Service; (b) your violation of any third-party
intellectual property rights through your use of the Service; (c) your
violation of any applicable law or regulation; or (d) your breach of these
Terms.

## 12. Force Majeure

Neither party shall be liable for any failure or delay in performance
under these Terms due to causes beyond its reasonable control, including
but not limited to acts of God, natural disasters, war, terrorism, riots,
embargoes, acts of civil or military authorities, fire, floods, accidents,
strikes, shortages of transportation, facilities, fuel, energy, labor, or
materials, or failure of telecommunications or internet service providers.

## 13. Copyright Policy

If you believe that your copyrighted work has been copied in a way that
constitutes copyright infringement and is accessible via the Service,
please notify us at adrian@kikan.net with the following information:
(a) identification of the copyrighted work; (b) identification of the
infringing material and its location; (c) your contact information;
(d) a statement that you have a good faith belief that the use is not
authorized; (e) a statement that the information is accurate; and
(f) your physical or electronic signature. We reserve the right to remove
content and terminate accounts for repeat infringers.

## 14. Severability

If any provision of these Terms is held to be invalid, illegal, or
unenforceable, the remaining provisions shall continue in full force and
effect.

## 15. Entire Agreement

These Terms constitute the entire agreement between you and the Operator
regarding the subject matter hereof and supersede all prior or
contemporaneous agreements, representations, warranties, and understandings.

## 16. Assignment

You may not assign or transfer these Terms without the prior written consent
of the Operator. The Operator may assign these Terms without restriction.

## 17. Acceptance

BY CREATING AN ACCOUNT OR USING THE CLOUD SERVICE, YOU ACKNOWLEDGE THAT YOU HAVE
READ, UNDERSTOOD, AND AGREE TO BE BOUND BY THESE TERMS AND THE PRIVACY POLICY.

If you do not agree, do not use the Service.

## 18. Version History

Your continued use of the Service after a version change constitutes
acceptance of the updated terms. A version history is maintained as part
of this document.