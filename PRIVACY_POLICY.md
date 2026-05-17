# mLearn Privacy Policy

**Version 1.1 — Effective Date: 2026-05-18**

**Contact:** adrian@kikan.net (privacy) | support@kikan.net (technical)
**Operator:** Adrian Vlasov, Vaud, Switzerland

---

## 1. Overview

mLearn is local-first software. Most of your data never leaves your
device. This policy explains what happens when you use cloud features
at mlearn-cloud.kikan.net.

---

## 2. Data We Collect

### 2.1 Account Data (Cloud only)
- Email address
- Authentication tokens / session IDs (encrypted at rest)
- Quota usage and transaction logs

### 2.2 Job Processing Data (Transient, up to 1 day)
When you use Cloud OCR or Cloud TTS, we create a minimal job record to
track processing status. This includes:
- **OCR:** Extracted text and bounding boxes (metadata only)
- **TTS:** Source text reference
- **Job metadata:** Processing status, timestamps, error messages

**OCR images are deleted immediately after processing completes.**
**TTS audio files are deleted immediately after you download them.**
Job metadata is retained for up to 1 day to allow status tracking, then
automatically deleted.

### 2.3 Watch Together Session Data
- Room state (playback time, pause/play status, media URL, media title,
  subtitle settings)
- Room membership (who joined, when)
- Usage segments (session start/end times)

**Retention:** Active room data persists while the room is open. Closed
rooms, usage segments, and orphaned memberships are automatically deleted
after 30 days.

### 2.4 Waitlist
- Email address (if you signed up for the waitlist)

**Retention:** Deleted immediately upon notification. A 1-day safety
net exists for edge cases, then purged by garbage collection.

### 2.5 Sync Data (Cloud only)
- Flashcard text and metadata (synced via Cloudflare Durable Objects)
- Application settings

### 2.6 What We Do NOT Collect
- The content of AI conversations (no chat logs)
- Voice cloning samples (processed transiently and discarded)
- OCR images after processing (deleted immediately)
- Generated TTS audio after delivery (deleted immediately)
- Video, audio, or subtitle files from your local media

---

## 3. How We Use Data

- To authenticate you and provide cloud relay services
- To process OCR and TTS jobs
- To coordinate Watch Together sessions
- To track quota consumption
- To sync flashcards and settings across devices

We do NOT:
- Train AI models on your data
- Sell your data
- Profile you for advertising

---

## 4. Data Retention & Deletion

| Data Type | Retention Period | Automatic Deletion |
|-----------|------------------|-------------------|
| Account & quota | Until account deletion | Manual (account deletion) |
| Job metadata | Up to 1 day | Yes (Worker GC cron) |
| OCR images | **Deleted immediately after processing** | Yes |
| TTS audio | **Deleted immediately after download** | Yes |
| Watch Together rooms | Active session / 30 days after close | Yes |
| Waitlist emails | Deleted on notification / 1-day safety net | Yes |
| Auth codes/tokens | 5–15 minutes | Yes (Worker GC cron) |

---

## 5. Third-Party Services

| Service | Purpose | Data Shared |
|---------|---------|-------------|
| Cloudflare | Edge network / Worker / Durable Objects | Encrypted requests, flashcard chunks |
| Supabase | Auth, job tracking, Watch Together, quota | Account email, job metadata, room state |
| Cerebras | LLM inference | Conversation messages (transient, not stored by us) |
| Modal | TTS / voice cloning | Text, 3s voice sample (transient, not stored by us) |

### 5.1 International Data Transfers

Some of our processors (Cloudflare, Supabase, Cerebras, Modal) operate in
the United States. For transfers of personal data from Switzerland or the
European Economic Area (EEA) to the United States, we rely on Standard
Contractual Clauses (SCCs) approved by the Swiss Federal Data Protection
and Information Commissioner (FDPIC) and/or the European Commission.
Where applicable, we also rely on the Swiss-US Data Privacy Framework.

---

## 6. Security

- Encryption in transit (TLS 1.3)
- Row Level Security (RLS) enabled on all database tables
- Private Storage bucket with path-based access control
- Desktop authentication tokens encrypted at rest (AES-GCM)

---

## 7. Your Rights

Under Swiss and EU data protection law, you have the right to:
- Access your data
- Correct inaccurate data
- Delete your account and associated data
- Object to processing
- Receive a copy of your data

Contact: adrian@kikan.net

---

## 8. Children's Privacy

Our cloud services are not intended for users under 18. If you believe
a minor has provided us with personal data, contact us and we will delete
it.

---

## 9. Changes

We may update this policy. Material changes will be notified via email
and/or in-app notice at least thirty (30) days before they take effect.
Continued use after the effective date constitutes acceptance.

## 10. Cookies and Tracking Technologies

If you access our web properties (e.g., mlearn.morisinc.net,
mlearn-app.kikan.net), we may use essential cookies and similar
technologies for authentication, security, and session management. We do
not use third-party advertising cookies. You can manage cookie preferences
through your browser settings.

## 11. Version History

Your continued use of our services after a policy change constitutes
acceptance of the updated terms. A version history is maintained as part
of this document.