# mLearn Cloud Terms of Service

**Version 1.0 — Effective Date: 2026-05-17**

**Operator:** Adrian Vlasov, Vaud, Switzerland  
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
the right to modify, reduce, or discontinue free quota at any time.

### 6.2 Future Paid Tier
If paid quotas are introduced, they will be billed through a separate
payment processor. You must be notified before any charges occur.

### 6.3 No Refunds
Quota is consumed on use. We do not refund consumed quota except in cases
of demonstrable service error on our part.

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
Upon termination, your quota is forfeited and sync data may be deleted.

## 9. Governing Law

These Terms are governed by the laws of Switzerland. Disputes shall be
resolved in the courts of the canton of Vaud, unless mandatory consumer
law requires otherwise.

## 10. Changes

We may update these Terms. Material changes will be notified via email
or in-app notice. Continued use after changes constitutes acceptance.