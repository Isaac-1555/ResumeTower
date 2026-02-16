# Product Requirements Document (PRD)
## Resume Tower

---

# 1. Product Overview

AutoJob Assistant is a web application that:

- Monitors Gmail for job listing emails
- Extracts job listings automatically
- Generates tailored resumes and cover letters
- Displays prepared applications in a dashboard
- Tracks application status (applied, rejected, interview)

The system runs background processing without requiring the frontend to be open.

---

# 2. Goals

## Primary Goals

- Reduce manual job application effort
- Automatically tailor resume and cover letter per job
- Maintain structured job tracking
- Provide clean, fast, responsive UI
- Fully automated background processing

## Non-Goals (MVP)

- Automatic job submission
- Multi-user system
- Complex AI rewriting beyond structured tailoring

---

# 3. System Architecture

## Frontend
- React
- Tailwind CSS
- shadcn/ui components
- Hosted on Vercel (or similar)

## Backend
- Supabase
- PostgreSQL
- Supabase Edge Functions
- Supabase Storage
- Gmail API with OAuth2

## Background Processing
- Scheduled Edge Functions (cron jobs)
- Database triggers (if needed)

---

# 4. Frontend Requirements

## 4.1 Pages

### Dashboard

Tabs:
- Prepared Jobs
- Applied Jobs
- Rejected
- Interviews

Each row contains:
- Job Title
- Company
- Location
- Skills Match Score
- Resume Download Button
- Cover Letter Download Button
- View Job Link
- Mark as Applied Button

Features:
- Sortable table
- Search and filtering
- Status badges
- Modal preview for resume/cover letter

---

### Job Detail Page

Displays:
- Full job description
- Generated resume preview
- Generated cover letter preview
- JSON resume configuration used
- Apply button
- Manual status override

---

### Settings Page

Sections:
- Gmail OAuth connection status
- Base Resume JSON editor
- Cover Letter template editor
- Job keyword filters
- Email source whitelist

---

# 5. Database Schema (PostgreSQL)

## users (future-proofing)

- id (uuid, primary key)
- email
- created_at

## jobs

- id (uuid, primary key)
- email_id (unique)
- job_title
- company
- location
- description
- job_link
- extracted_skills (jsonb)
- status (prepared | applied | rejected | interview)
- created_at
- applied_at (nullable)

## resumes

- id (uuid)
- job_id (foreign key)
- resume_json (jsonb)
- resume_pdf_url
- created_at

## cover_letters

- id (uuid)
- job_id (foreign key)
- cover_letter_text
- cover_letter_pdf_url
- created_at

## base_profile

- id
- profile_json (jsonb)
- updated_at

---

# 6. Resume JSON Configuration

Example structure:

```json
{
  "personal_info": {
    "name": "Your Name",
    "email": "your@email.com",
    "phone": "123456789"
  },
  "skills": [],
  "experience": [],
  "education": []
}
```

Logic:
- Extract keywords from job description
- Match against skills
- Reorder skills based on relevance
- Select relevant experience bullets
- Generate formatted resume from template
- Convert to PDF
- Store in Supabase Storage

---

# 7. Gmail Integration

## Authentication

- OAuth2 flow
- Scope: gmail.readonly

## Email Filtering Flow

1. Fetch unread emails using query filters
2. Check subject line for:
   - "job"
   - "opportunity"
   - "recommendation"
   - "matches"
3. If matched → fetch full email body
4. Parse job listings
5. Store in database

## Optimization

Use Gmail search queries:
- from:indeed.com
- from:linkedin.com
- is:unread

---

# 8. Background Processing

## Important Answer

Supabase Edge Functions run independently of the frontend.

The app does NOT need to be open.

## Recommended Setup

Use Scheduled Edge Functions:

- Run every 5–10 minutes
- Pull new emails
- Parse job listings
- Generate resume and cover letter
- Insert into database

This runs entirely server-side.

---

# 9. Application Flow

1. Email arrives
2. Scheduled function runs
3. Email is parsed
4. Job stored in database
5. Resume generated
6. Cover letter generated
7. Visible in dashboard

---

# 10. Status Tracking Logic

When user clicks "Mark as Applied":

- Update job.status = applied
- Store applied_at timestamp

Background email scan checks:

If email contains:
- "interview"
- "schedule"
- "regret"
- "unfortunately"

Then update:
- status = interview OR rejected

---

# 11. File Generation

Resume & Cover Letter:

1. Generate HTML template
2. Convert to PDF using:
   - Puppeteer in Edge Function
   OR
   - External PDF microservice
3. Store PDF in Supabase Storage
4. Save file URL in database

---

# 12. Security Considerations

- Encrypt OAuth tokens
- Enable Row Level Security
- Restrict Gmail scopes
- Sanitize email HTML
- Avoid duplicate processing
- Rate-limit scheduled jobs

---

# 13. Performance Considerations

- Only fetch unread emails
- Use Gmail query filters
- Avoid reprocessing same email_id
- Cache parsing results if needed

---

# 14. MVP Scope

Start with:

1. Subject filtering
2. Support 1–2 known email formats
3. Resume generation from JSON
4. Dashboard with Prepared and Applied tabs

Avoid complex AI ranking in v1.

---

# 15. Future Enhancements

- AI job scoring
- Resume optimization suggestions
- Analytics dashboard
- Chrome extension
- Multi-user support
- Interview preparation generator

---

# End of PRD
