# No Under 40 — Platform Technical Specification
**Version:** 1.0  
**Date:** March 2026  
**Status:** Ready for Development

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Tech Stack](#2-tech-stack)
3. [User Roles & Permissions](#3-user-roles--permissions)
4. [Role Relations & Chat Matrix](#4-role-relations--chat-matrix)
5. [Authentication & Onboarding](#5-authentication--onboarding)
6. [HQ Panel](#6-hq-panel)
7. [School Panel](#7-school-panel)
8. [Teacher Panel](#8-teacher-panel)
9. [Student Panel](#9-student-panel)
10. [Credits & Subscription System](#10-credits--subscription-system)
11. [Booking Flow](#11-booking-flow)
12. [Attendance Flow](#12-attendance-flow)
13. [Payment Architecture](#13-payment-architecture)
14. [Calendar Architecture](#14-calendar-architecture)
15. [Chat Architecture](#15-chat-architecture)
16. [Notification System](#16-notification-system)
17. [Metodo Library](#17-metodo-library)
18. [Shop](#18-shop)
19. [Email Templates](#19-email-templates)
20. [Database Schema Overview](#20-database-schema-overview)
21. [API Routes Overview](#21-api-routes-overview)
22. [PWA Configuration](#22-pwa-configuration)
23. [Development Phases](#23-development-phases)

---

## 1. Platform Overview

**No Under 40** is a centralized SaaS platform (Operating System) for managing a network of affiliated classical dance schools. It enables the platform owner (HQ) to scale their teaching methodology, maintain quality standards, and simplify the operational management of affiliated schools.

### Core Concept
- HQ owns and governs the platform and the methodology
- Affiliated schools operate under HQ's network
- Teachers are managed by schools
- Students register and book lessons across the network
- Payments flow through Stripe Connect with automatic platform fee split

### Key Principles
- Supabase is the **single source of truth** for all data
- Calendar is **Supabase-native** — all views and availability are powered by Supabase queries + Realtime
- iCal feeds allow optional export to external calendar apps (Google Calendar, Apple Calendar) — read-only
- All writes happen through the application
- Row Level Security (RLS) enforces multi-tenancy at database level
- Chat permissions are enforced at database level via RLS

---

## 2. Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| Next.js 14+ (App Router) | Frontend framework |
| Tailwind CSS | Styling |
| TypeScript | Type safety |
| PWA (next-pwa) | Mobile app experience |

### Backend
| Technology | Purpose |
|---|---|
| Next.js API Routes | Business logic, webhooks |
| Supabase Edge Functions | Background jobs, scheduled tasks |

### Database & Services
| Technology | Purpose |
|---|---|
| Supabase PostgreSQL | Primary database |
| Supabase Auth | Authentication (all roles) |
| Supabase Realtime | Chat, notifications, live updates |
| Supabase Storage | Documents, videos, images |
| Supabase RLS | Multi-tenancy, permission enforcement |

### Third Party Services
| Service | Purpose |
|---|---|
| Stripe Connect (Express) | Payments, platform fees |
| ZeptoMail | Transactional emails |
| Google OAuth | Social login |

> **Calendar approach:** No external calendar API. All calendar data lives in Supabase. iCal feeds (`/api/calendar/[id].ics`) allow users to subscribe from external apps.

### Infrastructure
| Technology | Purpose |
|---|---|
| Vercel | Deployment (frontend + API routes) |
| GitHub (private) | Version control, multi-contributor |

---

## 3. User Roles & Permissions

### Role Hierarchy

```
HQ (Platform Owner Organization)
├── HQ Super Admin
├── HQ Operations
├── HQ Tech Support
├── HQ Analytics
└── HQ Support
        ↓
School (Affiliated Dance School)
├── School Admin
└── School Staff
        ↓
Teacher (Instructor within a school)
        ↓
Student (End user, web + PWA)
```

### HQ Sub-Roles & Permissions

| Permission | Super Admin | Operations | Tech Support | Analytics | Support |
|---|---|---|---|---|---|
| Create/manage HQ team | ✅ | ❌ | ❌ | ❌ | ❌ |
| Create school accounts | ✅ | ✅ | ❌ | ❌ | ❌ |
| Activate/deactivate schools | ✅ | ✅ | ❌ | ❌ | ❌ |
| Configure platform fees | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage Metodo Library | ✅ | ✅ | ❌ | ❌ | ❌ |
| Approve special events | ✅ | ✅ | ❌ | ❌ | ❌ |
| View all analytics | ✅ | ✅ | ❌ | ✅ | ❌ |
| Handle tech tickets | ✅ | ❌ | ✅ | ❌ | ❌ |
| Chat with schools | ✅ | ✅ | ✅ | ❌ | ✅ |
| Manage email templates | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage shop (HQ products) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Configure free trials | ✅ | ✅ | ❌ | ❌ | ❌ |
| View network map | ✅ | ✅ | ❌ | ✅ | ❌ |

### School Sub-Roles & Permissions

| Permission | School Admin | School Staff |
|---|---|---|
| Manage teachers | ✅ | ❌ |
| Create/edit lessons & courses | ✅ | ✅ |
| Manage students | ✅ | ✅ |
| Manage packages & subscriptions | ✅ | ❌ |
| View payments & transactions | ✅ | ❌ |
| Connect Stripe | ✅ | ❌ |
| Manage calendar settings | ✅ | ❌ |
| Chat with students & HQ | ✅ | ✅ |
| Manage discount codes | ✅ | ❌ |
| Configure cancellation policy | ✅ | ❌ |
| Manage locations/rooms | ✅ | ❌ |
| Upload school content (library) | ✅ | ✅ |
| Assign credits manually | ✅ | ✅ |
| Manage compensation plans | ✅ | ❌ |
| Configure grace period | ✅ | ❌ |
| Manage email templates | ✅ | ❌ |

---

## 4. Role Relations & Chat Matrix

### 2-Way Relations

**HQ ↔ School**
- HQ creates school accounts and activates them
- HQ configures platform fee per school
- HQ monitors school KPIs, payments, activities network-wide
- HQ approves/rejects special events and workshops
- HQ manages methodology content (Metodo Library)
- HQ can offer free trial periods to new schools
- School reports activity to HQ
- School requests approvals from HQ
- School receives methodology, rules, content from HQ

**HQ ↔ Teacher**
- HQ defines official lesson types (Metodo catalog)
- HQ monitors teacher certificates expiry network-wide
- HQ publishes Metodo Library content accessible to teachers
- Teacher accesses HQ methodology content for training

**HQ ↔ Student**
- HQ manages platform-wide video courses (paid)
- HQ manages shop products
- HQ tracks referral commissions from student purchases
- Student purchases visible in HQ analytics

**School ↔ Teacher**
- School creates teacher profiles and assigns compensation plans
- School assigns courses and lessons to teachers
- School monitors teacher performance, attendance rates, ratings
- School may reassign or cancel lessons (teacher on leave)
- Teacher marks attendance per lesson
- Teacher views their compensation simulation
- Teacher can be assigned to multiple schools

**School ↔ Student**
- School manages student packages, subscriptions, documents
- School assigns credits manually (cash payments)
- School blocks student booking on expired documents
- School validates student documents (medical cert, privacy, image release)
- School chats with students, handles support
- Student books lessons, purchases packages/subscriptions
- Student can attend lessons at any school (separate credits per school)

**Teacher ↔ Student**
- Teacher marks student attendance (present/no-show) per lesson
- Teacher visible to student on booking page (name, specialty)
- Student attendance counts toward teacher compensation

### Chat Permission Matrix (enforced via Supabase RLS)

| Sender | Can chat with |
|---|---|
| HQ (any sub-role with chat permission) | Schools only |
| School | HQ + own students only |
| Student | Own school only |
| Teacher | No chat access |

```sql
-- RLS Policy: Chat permissions
CREATE POLICY "chat_permissions"
ON messages FOR ALL
USING (
  (sender_role = 'hq' AND recipient_role = 'school')
  OR
  (sender_role = 'school' AND recipient_role = 'hq')
  OR
  (sender_role = 'school' AND recipient_role = 'student'
    AND recipient_id IN (
      SELECT student_id FROM school_students
      WHERE school_id = auth.uid()
    ))
  OR
  (sender_role = 'student' AND recipient_role = 'school'
    AND recipient_id = (
      SELECT school_id FROM school_students
      WHERE student_id = auth.uid()
    ))
);
```

---

## 5. Authentication & Onboarding

### Login Flow
```
Single login page (/login)
    ↓
Google OAuth OR Email/Password
    ↓
Supabase Auth detects role from profiles table
    ↓
Redirect to role dashboard:
  HQ        → /hq/dashboard
  School    → /school/dashboard
  Teacher   → /teacher/dashboard
  Student   → /student/dashboard
```

### Auth Rules
- Single login page for all roles
- Google OAuth enabled for all roles
- Email/password enabled for all roles
- One person = one role only (no multi-role accounts)
- Route protection via Next.js middleware + Supabase session

### HQ Team Member Registration
- HQ Super Admin creates team member accounts from dashboard
- Invitation email sent via ZeptoMail
- Team member sets password on first login

### School Registration
- HQ Operations creates school account from HQ dashboard
- School receives activation email with login credentials
- School completes their profile (name, address, logo, locations)
- School connects Stripe Express account
- School is live on network once profile is complete
- School can use platform without Stripe (no credit/subscription sales until connected)

### Teacher Registration
- School Admin creates teacher profile from school dashboard
- Invitation email sent to teacher via ZeptoMail
- Teacher sets password on first login
- Teacher assigned to one or more schools

### Student Registration
- Students self-register at /register
- Google OAuth or email/password
- Profile completion (name, phone, date of birth, address, city)
- Student can browse all school schedules immediately
- Student must purchase package/subscription per school to book lessons

---

## 6. HQ Panel

### 6.1 Dashboard
- Network KPIs: active schools, total students, weekly lessons, active subscriptions
- Performance table: all schools with city, teachers, students, status
- Recent alerts feed
- Quick actions

### 6.2 School Management
- School list with filters (status, city, country)
- Create new school account (name, city, country, platform fee %, free trial config)
- View school detail (metrics, Stripe status, calendar activity)
- Activate / deactivate school
- Configure platform fee per school
- Configure free trial period per school

### 6.3 HQ Team Management
- List of HQ team members
- Create team member with sub-role assignment
- Edit permissions per member
- Deactivate team member

### 6.4 Lesson Types (Metodo Catalog)
- Define official lesson types available to all schools
- Fields: name (multilingual: IT/EN/FR/ES), level, code, description
- AI-assisted translation (manually editable)
- Schools can only use lesson types from this catalog

### 6.5 Network Map
- Interactive map of all school locations (Europe-wide)
- Filter by status (active, onboarding, inactive)
- School pin popup: name, city, students, teachers, monthly revenue
- Link to school dashboard

### 6.6 Alert Center & Automations
- Network activity log
- Alert rules configuration:
  - New school registered
  - Price changes detected
  - Stripe sync errors
  - Certificate expiry alerts
  - Affiliation renewal alerts (30 days before)
  - Weekly KPI report (email)
- Global reminder settings
- Email system status

### 6.7 Payments (HQ Level)
- Consolidated transaction view (all schools)
- Platform fee tracking
- Payout overview
- Filter by school, date, status, product
- CSV export

### 6.8 Special Event Approvals
- Queue of pending workshop/event approval requests from schools
- Approve / reject with optional note
- Approved events go live on school calendar

### 6.9 Inbox (HQ Chat)
- Conversations with schools only
- Team assignment (Operations, Tech, Support)
- Priority levels
- SLA tracking
- Internal notes
- Ticket status (open, in progress, resolved)
- Search & filters
- CSV export

### 6.10 Metodo Library Management
- Upload official lesson videos (stored in Supabase Storage)
- Categorize by lesson type and language
- Mark as available to: all schools / specific schools
- Mark as available to: teachers only / students (included or paid)
- Edit/delete content

### 6.11 Email Templates
- Manage all transactional email templates
- Templates for: welcome, activation, booking confirmation, cancellation, payment, reminders, etc.
- Multilingual (IT/EN/FR/ES)
- Rich text editor
- Variable placeholders ({{student_name}}, {{lesson_date}}, etc.)
- Preview before save
- Sent via ZeptoMail

### 6.12 Reports
- Network-level analytics
- School performance comparison
- Revenue trends
- Student retention rates
- Export CSV / PDF

---

## 7. School Panel

### 7.1 Dashboard
- School KPIs: active students, weekly lessons, monthly revenue, active subscriptions
- Recent activity feed
- Upcoming lessons (next 7 days)
- Pending actions (document validations, attendance reminders)

### 7.2 Calendar
- Weekly / monthly / daily view
- Color-coded by lesson type
- Filter by: lesson type, teacher, location/room
- Click lesson → lesson detail
- Create new lesson button
- Powered by Supabase (real-time data, no external sync)
- iCal feed for external apps: `/api/calendar/[schoolId].ics`
- Multilingual (IT/EN/FR/ES)

### 7.3 Course & Lesson Management

#### Create Course Wizard (4 Steps)
**Step 1 — Basic Details**
- Lesson type (from HQ catalog)
- Course name (multilingual)
- Teacher assignment
- Description

**Step 2 — Schedule & Capacity**
- Start date
- Location / Room
- Start time, duration
- Maximum capacity
- Minimum booking notice (hours) — defined by school
- VIP early booking window (hours before general) — defined by school
- Credit cost per lesson (1, 2, custom)
- Calendar color

**Step 3 — Frequency**
- Single lesson
- Recurring (weekly)
- Bi-weekly
- Intensive / Workshop
- Start date, end date
- Auto-generates all lesson instances

**Step 4 — Options**
- Waitlist enable/disable
- Reserve spots (for make-up lessons)
- Cancellation policy (linked to school policy)

#### Special Event / Workshop
- One-time event creation
- Requires HQ approval before publishing
- Status: Draft → Pending Approval → Approved → Published
- Student-facing preview card

#### Lesson Management
- Edit individual lesson or all future occurrences
- Cancel lesson → auto-refund all booked students (credits/accesses)
- Cancel lesson → ZeptoMail notification to all booked students
- Reassign teacher
- Add guest teacher (visible on booking page)

### 7.4 Locations & Rooms
- Manage multiple locations (sedi)
- Each location: name, address, Google Maps link
- Each location: multiple rooms with capacity
- Room availability conflict detection on lesson creation

### 7.5 Teacher Management
- Teacher list with filters (specialty, status)
- Create teacher profile:
  - Personal details (name, email, phone, address, photo)
  - Disciplines/specialties (from HQ lesson type catalog)
  - Bio
  - Assigned courses
  - Compensation plan assignment
- Teacher can be assigned to multiple schools
- Teacher status (active, on leave, inactive)
- Teacher performance metrics

### 7.6 Compensation Plans
- Create multiple compensation plans
- Plan fields:
  - Name
  - Base fee per lesson
  - Bonus threshold (min students)
  - Bonus per student above threshold
  - Different rates per lesson type (optional)
- Assign plan to teacher
- Compensation simulator (preview for a given lesson scenario)
- Monthly aggregate report per teacher

### 7.7 Student Management
- Student list with filters (package, document status, attendance frequency)
- Student profile:
  - Personal info
  - Active packages (per this school)
  - Active subscriptions (per this school)
  - Credit balance
  - Document status
  - Booking history
  - Payment history
  - LTV (lifetime value)
- Assign package manually (school admin → student → product → payment method)
- Assign credits manually (cash payments)
- Block/unblock booking
- Document validation

### 7.8 Packages
- Create package:
  - Name (multilingual)
  - Number of credits
  - Validity (days from purchase)
  - Price
  - Lesson type restrictions (all or specific types)
  - Color
  - Active/inactive toggle
- Synced with Stripe product catalog
- "Most popular" badge toggle
- Live student-facing preview

### 7.9 Subscriptions
- Create subscription:
  - Name (multilingual)
  - Description (multilingual)
  - Period (days / weeks / months / years)
  - Number of accesses (unlimited or fixed number)
  - Lesson type restrictions
  - Price
  - Auto-renewal toggle
  - VIP features (priority booking, special events access, freeze option)
  - Color
  - Active/inactive toggle
- Stripe recurring billing product
- Live student-facing preview
- Overlap rule: new subscription starts day after current expires (no days lost)

### 7.10 Payments
- Bank Account Connect (Stripe Express status)
- Multi-gateway management (Stripe, PayPal, Bonifico, POS, Cash)
- Transaction table:
  - Status (completed, pending, refunded)
  - Amount
  - Product
  - Payment method
  - Date
  - Student
  - Refund action
- Summary KPIs: monthly revenue, next payout, total transactions
- Filter by date, status, product, method
- CSV export
- Subscription grace period configuration (default 7 days, configurable)

### 7.11 Documents
- Required documents configuration (medical cert, privacy, image release)
- Per-student document management
- Document status: valid, expiring (<30 days), expired
- Manual document validation (school approves uploads)
- Auto-reminders: 30 days and 7 days before expiry (ZeptoMail)
- Auto-booking block on expiry
- Reminder toggles (email, push)

### 7.12 Cancellation Policy
- Per-school, per-lesson configuration
- Threshold in hours (e.g., 24h, 12h, 3h, 1h — freely configurable)
- Rule: before threshold → credit/access refunded
- Rule: after threshold → credit/access burned
- Rule: no-show → credit/access always burned
- Applies to both credits (packages) and accesses (subscriptions)

### 7.13 Discount Codes
- Create coupon:
  - Name (public)
  - Code (auto-generated, manually editable)
  - Type: percentage (%) or fixed amount (€)
  - Value
  - Minimum order amount
  - Expiry date
  - Valid for: packages / subscriptions / shop
- Active/inactive toggle
- Usage tracking

### 7.14 Metodo Library (School View)
- Access HQ official content
- Filter by lesson type, language, level
- Upload school-specific content (videos, PDFs)
- Mark school content as visible to: teachers only / students

### 7.15 Inbox (School Chat)
- Conversations with HQ (all HQ team members with chat permission)
- Conversations with own students only
- Internal notes (staff only, not visible to student)
- Quick replies: Orari, Link Pagamento, Certificato
- File/image attachments (Supabase Storage)
- Ticket status (open, in progress, resolved)
- Priority levels
- SLA tracking
- Team assignment
- Student profile sidebar (credits, packages, documents)
- Search & filters

### 7.16 Operational Settings
- Closure days calendar (full day or partial hours)
- Cancellation policy (per lesson)
- Subscription grace period (default 7 days)
- Notification preferences
- Email templates (school-level override)
- Free lesson configuration (first lesson free for new students)

### 7.17 Reports & Analytics

#### Lesson Analytics
- Lessons completed, unique students, total attendance, no-shows, cancellations
- Credits used, estimated revenue
- Filter by period, lesson type, teacher, location
- CSV export

#### Student Analytics
- Active students, packages, subscriptions, credits remaining
- Retention rate, documents expired
- Per-student: LTV, frequency, last attendance
- CSV export

#### Teacher Analytics
- Lessons taught, hours, students, attendance rate, no-show rate, credits generated
- Performance score (based on attendance rate + feedback)
- Monthly compensation calculation

---

## 8. Teacher Panel

### 8.1 Dashboard
- Today's lessons
- Weekly schedule overview
- Personal performance stats (this month)
- Recent attendance logs

### 8.2 Calendar
- View assigned lessons only
- Weekly / monthly / daily view
- Filter by location
- Click lesson → attendance marking
- iCal subscription link

### 8.3 Attendance Marking
- Open lesson detail (before lesson starts)
- Student list with package/subscription type
- Mark each student: Present / No-show
- Save attendance → triggers:
  - Credit/access deduction confirmed
  - No-show → credit/access burned
  - Report sent to school dashboard
- Cannot be overridden by school after submission
- Reminder sent to school if not marked (Supabase Edge Function)

### 8.4 Performance Stats
- Lessons taught, total hours, students followed
- Average attendance rate, no-show rate
- Credits generated
- Performance score
- Monthly compensation simulation

### 8.5 Compensation View
- View assigned compensation plan
- Monthly earnings breakdown (base + bonuses per lesson)
- Lesson-by-lesson detail

### 8.6 Metodo Library
- Access HQ official content (lesson types matching their specialties)
- Access school-uploaded content
- Filter by type, language, level

### 8.7 Profile
- View/edit personal info
- Disciplines & specialties
- Bio
- Assigned schools & courses

---

## 9. Student Panel

### 9.1 Dashboard (PWA Home)
- Credit balance (per school)
- Upcoming bookings
- Quick book button
- Streak tracker
- Recent notifications

### 9.2 Lesson Booking
- City-based search (defaults to profile city)
- Search by lesson type OR by time slot
- Filter by: type, location, day, school
- Map view with school pins
- Lesson card: type, teacher, school, location, date/time, spots available, credit cost
- Book button → confirmation screen
- Shows credit deduction warning (subscription first, then credits)
- Multi-date booking (select multiple dates of same course)
- Minimum booking notice enforced (school-defined per lesson)
- VIP early booking window enforced
- If full: "Unavailable" (no waitlist — first come first served)
- Students can book at any school (credits/subscriptions are school-specific)

### 9.3 My Bookings
- Tabs: upcoming / past / cancelled
- Upcoming: modify / cancel with policy timeline countdown
- Past: attended / no-show / cancelled status
- Cancelled: credit refunded / burned status
- "Book again" shortcut on past lessons
- Add to calendar (Google / Apple / iCal)

### 9.4 Booking Modification
- Policy timeline displayed clearly:
  - Before threshold: free modification
  - After threshold: 50% penalty or no modification (school-defined)
- Date picker for new slot (same course)
- Countdown timer to free modification deadline

### 9.5 My Packages & Subscriptions
- Tabs: Packages / Subscriptions
- Per school (separate wallets)
- Package card: name, credits used/total, expiry, progress bar, status
- Subscription card: name, period, accesses used, renewal date, status
- Detail view: usage history (lesson, date, teacher, credit change, balance)
- Donut chart: % utilized
- Statistics: completed, cancelled, no-shows

### 9.6 Purchase Packages
- School-specific catalog
- Package cards with credits, validity, price, lesson type restrictions
- Subscription cards with period, accesses, price, VIP features
- Checkout → Stripe payment
- Discount code input
- School referral selection (3% discount for student, commission for school)
- Auto-activation after payment confirmation

### 9.7 Video Courses
- Catalog filtered by: lesson type, language, level
- Included (with subscription/package) vs paid extra
- Progress tracking (% watched)
- Resume last course
- Purchase extra content (Stripe)

### 9.8 Shop
- Product catalog: clothing, shoes, accessories, equipment
- Filter by category
- Product card: name, rating, price, stock badge
- Cart
- Discount code
- School referral (3% discount)
- Stripe checkout
- Digital/unlimited inventory (no stock tracking)

### 9.9 Profile
- Personal info (name, email, phone, DOB, address, city)
- Stats: total lessons, total hours, streak, credits
- Badge (Premium Gold etc.)
- My Packages tab
- Documents tab (upload medical cert, privacy, image release)
- History tab (all activity log)

### 9.10 Notifications (Alert Center)
- Categories: Lessons / Payments / Documents / System
- Mark all as read
- Per-notification actions (book, upload, view)
- Notification preferences:
  - Email reminders (24h before lesson)
  - Push notifications (PWA)
  - Document expiry alerts
  - New lessons available
  - Teacher/schedule changes
  - Promotions & offers
- Multilingual based on user language preference

### 9.11 Support Center
- Live chat (Supabase Realtime, school operator)
- Email support (ZeptoMail)
- FAQ by category (Bookings, Payments, Documents, Technical)
- Operator online status indicator
- Typing indicator
- File/image attachments
- Quick replies (school-defined templates)

---

## 10. Credits & Subscription System

### 10.1 Credits (Packages)

Credits are the currency for package-based access:

```
Student purchases Package
    ↓
Credits added to student wallet (school-specific)
    ↓
Student books lesson
    ↓
System deducts credits (if no active subscription)
    ↓
Lesson attended → credit confirmed deducted
Cancelled within policy → credit refunded
Cancelled outside policy → credit burned
No-show → credit burned
```

**Package Rules:**
- Fixed number of credits
- Expiry date calculated from purchase date
- Credits expire with package (no rollover)
- Can be restricted to specific lesson types
- No automatic renewal
- No sharing between students
- Credit cost per lesson: school defines per lesson (1, 2 or custom)
- School creates their own packages, synced with Stripe

### 10.2 Subscription Accesses

Subscriptions use a separate access counter:

```
Student purchases Subscription
    ↓
Access counter initialized (school-specific)
    ↓
Student books lesson
    ↓
System deducts 1 access (PRIORITY over credits)
    ↓
Lesson attended → access confirmed deducted
Cancelled within policy → access refunded
Cancelled outside policy → access burned
No-show → access burned
```

**Subscription Rules:**
- Recurring billing via Stripe
- Access counter: unlimited OR fixed number (school decides)
- Period: configurable in days, weeks, months, years
- Lesson type restrictions: All Access / Flex only / Sbarra only / Custom
- Auto-renewal (Stripe recurring)
- VIP tier: priority booking + special events + freeze (30 days)
- Overlap rule: new subscription starts day after current expires (no days lost)
- Grace period on failed payment: default 7 days (school-configurable)

### 10.3 Deduction Priority

```
Student attempts to book lesson
    ↓
1. Check active subscription for this lesson type
   → YES: deduct 1 access (PRIORITY)
   → NO: go to step 2
    ↓
2. Check active package for this lesson type
   → YES: deduct credits (per lesson cost)
   → NO: booking blocked (no valid access)
```

### 10.4 Cancellation Policy

Each school configures cancellation thresholds per lesson:

```
Student cancels booking
    ↓
Calculate time until lesson start
    ↓
Compare against school's policy threshold (XX hours)
    ↓
Before threshold → refund credit/access
After threshold → burn credit/access
    ↓
No-show (teacher marks) → ALWAYS burn credit/access
```

**Policy Configuration (per lesson, school-defined):**
- Threshold in hours (freely configurable: 1h, 3h, 12h, 24h, 48h, etc.)
- Applied to both credits and accesses equally

### 10.5 Manual Credit Assignment (Cash Payments)

```
Student pays cash to school
    ↓
School Admin opens student profile
    ↓
Selects package to assign
    ↓
Selects payment method: Cash
    ↓
Credits added to student wallet
    ↓
Transaction recorded in payments table
```

### 10.6 Free First Lesson

- School can configure free first lesson for new students
- System checks: is this student's first booking at this school?
- If yes: no credit/access deduction
- Tracked in `free_lesson_used` flag per student per school

---

## 11. Booking Flow

### 11.1 Standard Booking

```
Student opens booking page
    ↓
City pre-filled from profile
    ↓
Browse lessons (all schools in city)
    ↓
Filter by type / day / location
    ↓
Select lesson
    ↓
System validates:
  ✓ Medical certificate valid?
  ✓ Spot available? (capacity check)
  ✓ VIP window respected?
  ✓ Minimum notice respected?
  ✓ Valid access (subscription or credits)?
    ↓
All checks pass → show confirmation screen
    ↓
Confirm → deduct access/credit (subscription first)
    ↓
Booking saved to Supabase
    ↓
Confirmation email via ZeptoMail
    ↓
Push notification (PWA)
    ↓
Booking added to student's personal iCal feed (auto-updated)
```

### 11.2 Booking Rules

| Rule | Detail |
|---|---|
| Spot availability | First come first served, no waitlist |
| Full lesson | Shows as unavailable, cannot book |
| VIP priority window | School-defined hours before general booking opens |
| Minimum booking notice | School-defined per lesson (hours) |
| Cross-school booking | Allowed, separate credits/subscriptions per school |
| Medical cert expired | Booking blocked, redirect to upload |
| No valid access | Redirect to purchase page |
| No booking limit | No maximum advance booking window |

### 11.3 Multi-Date Booking

```
Student selects a recurring course
    ↓
Calendar shows all available future dates
    ↓
Student selects multiple dates
    ↓
Summary shows: X lessons selected, X credits needed, balance after
    ↓
Confirm all → batch deduction
    ↓
Individual booking records created per date
    ↓
Confirmation email lists all dates
```

---

## 12. Attendance Flow

### 12.1 Teacher Marks Attendance

```
Before lesson starts:
Teacher opens lesson in their panel
    ↓
Student list displayed (all booked students)
    ↓
Teacher marks each: Present / No-show
    ↓
Teacher saves attendance
    ↓
System processes:
  Present → credit/access confirmed deducted
  No-show → credit/access burned (no refund)
    ↓
Attendance report sent to school dashboard
    ↓
Teacher compensation counter updated
```

### 12.2 Attendance Rules

| Rule | Detail |
|---|---|
| Who marks | Teacher only |
| When | Before lesson starts |
| Override | School cannot override teacher submission |
| Reminder | If not marked: school receives reminder (Supabase Edge Function scheduled job) |
| Auto-present | Not implemented (manual only) |
| No-show | Credit/access always burned |

### 12.3 Lesson Cancellation by School

```
School cancels a lesson
    ↓
All booked students automatically refunded (credit/access returned)
    ↓
ZeptoMail notification sent to all booked students
    ↓
Lesson marked as cancelled in Supabase
    ↓
iCal feeds auto-updated (cancellation reflected in external calendar apps)
    ↓
Option: reassign to another teacher or cancel permanently
```

---

## 13. Payment Architecture

### 13.1 Stripe Connect (Express Accounts)

```
Student pays for package/subscription
    ↓
Stripe processes payment
    ↓
Automatic split:
  → School's Connected Account (amount - platform fee)
  → HQ Master Account (platform fee %)
    ↓
Single webhook → /api/webhooks/stripe
    ↓
Filter by event.account (school's stripe_account_id)
    ↓
Update Supabase: credits, subscriptions, transactions
    ↓
ZeptoMail: payment confirmation email
```

### 13.2 Platform Fee Configuration

- Configured per school by HQ Super Admin
- Set when creating school account
- Editable from HQ school management panel
- Stored in `schools.platform_fee_percentage`
- Applied automatically via Stripe `application_fee_amount`

### 13.3 Webhook Handler

**Endpoint:** `POST /api/webhooks/stripe`

**Events handled:**
| Stripe Event | Action |
|---|---|
| `payment_intent.succeeded` | Add credits to student wallet |
| `customer.subscription.created` | Activate subscription, add accesses |
| `customer.subscription.renewed` | Renew subscription, reset accesses |
| `customer.subscription.deleted` | Deactivate subscription |
| `invoice.payment_failed` | Start grace period, notify school + student |
| `invoice.payment_succeeded` | Resolve grace period |
| `charge.refunded` | Update transaction status |
| `account.updated` | Update school Stripe Connect status |

### 13.4 Payment Methods

| Method | Type | School Config Required |
|---|---|---|
| Stripe (cards, wallets) | Auto API | Stripe Connect |
| PayPal | Auto API | PayPal Business connect |
| Google Pay | Auto via Stripe | Stripe Connect |
| Apple Pay | Auto via Stripe | Stripe Connect |
| Revolut | Manual | Contact HQ |
| Satispay | Auto API | Satispay connect |
| Bank Transfer (Bonifico) | Manual | School records manually |
| POS | Manual | School records manually |
| Cash | Manual | School assigns credits manually |

### 13.5 Invoice Generation

- Automatic after every completed payment
- Sent to student via ZeptoMail
- Stored in Supabase Storage
- Accessible from student profile and school payments panel

### 13.6 Refund Policy

- Partial refunds on packages: NOT supported
- Full refund: manual by school admin (via Stripe dashboard or platform)
- Credit/access refund on cancellation: automatic (policy-based)
- Subscription: no refund on remaining period

### 13.7 Subscription Grace Period

- Default: 7 days after failed payment
- Configurable per school on school settings dashboard
- During grace period: student retains access
- After grace period: subscription suspended, booking blocked
- ZeptoMail reminder sent to student on day 1, day 4, day 7

### 13.8 Free Trial (Schools)

- Configured by HQ per school
- Trial period: X days free (school doesn't pay platform fee)
- After trial: platform fee applies automatically
- School notified 7 days before trial ends

### 13.9 Free First Lesson (Students)

- Configured by school per lesson or globally
- No payment required for first booking at that school
- One-time per student per school
- Tracked via `free_lesson_used` flag

---

## 14. Calendar Architecture

### 14.1 Architecture Overview (Supabase Hybrid)

```
Lesson created/updated/deleted in app
    ↓
Saved in Supabase (SINGLE SOURCE OF TRUTH)
    ↓
Supabase Realtime pushes live updates to all connected clients
    ↓
In-app calendar views re-render automatically
    ↓
iCal feed auto-generated on-demand from Supabase data
    ↓
External calendar apps (Google Calendar, Apple Calendar) subscribe via iCal URL
```

**Hybrid** means:
- **In-app:** Calendar is 100% Supabase-powered (PostgreSQL queries + Realtime)
- **External:** iCal endpoints allow users to subscribe from any calendar app — read-only export

No Google Calendar API integration. No OAuth tokens for calendar. No server-side calendar sync jobs.

### 14.2 In-App Calendar (Supabase Native)

- All lesson data queried directly from `lessons` table in Supabase
- Live updates via Supabase Realtime (new bookings, cancellations, teacher changes appear instantly)
- Calendar views rendered client-side from Supabase data
- Filters (type, teacher, location, date) applied as Supabase query filters
- HQ aggregated view: queries across all schools with school filter
- No external service dependency for calendar rendering

### 14.3 iCal Feed (External Export)

- Endpoint per school: `GET /api/calendar/[schoolId].ics`
- Public (no auth required, school ID is the access key)
- Filter options: `?type=flex`, `?teacher=id`, `?location=id`
- Student personal feed: `GET /api/calendar/student/[token].ics` (private token per student)
- Generated on-demand from Supabase `lessons` + `bookings` tables
- Reflects current state: cancellations and changes auto-included on next sync

### 14.4 Calendar Event Lifecycle

| App Action | In-App Result | iCal Result |
|---|---|---|
| Lesson created | Appears instantly via Realtime | Included on next iCal fetch |
| Lesson updated (time/teacher/location) | Updates instantly via Realtime | Reflected on next iCal fetch |
| Lesson cancelled | Removed/greyed instantly | Removed from iCal feed |
| Lesson fully booked | Marked unavailable instantly | Description updated |
| Workshop approved | Appears on calendar | Included in iCal |

### 14.5 Calendar Views (App)

| Role | Calendar Features |
|---|---|
| HQ | All schools, filter by school, network map |
| School | Own lessons, filter by type/teacher/location, real-time updates |
| Teacher | Assigned lessons only, iCal subscription link |
| Student | Available lessons (all schools in city) + personal bookings, iCal export |

---

## 15. Chat Architecture

### 15.1 Technical Stack

- **Delivery:** Supabase Realtime (WebSocket subscriptions)
- **Storage:** Supabase PostgreSQL (`messages`, `conversations` tables)
- **Files:** Supabase Storage (`chat-attachments` bucket)
- **Permissions:** Supabase RLS (enforced at DB level)
- **Presence:** Supabase Realtime Presence (online status, typing indicator)

### 15.2 Features

| Feature | Implementation |
|---|---|
| Real-time messaging | Supabase Realtime channel subscription |
| Typing indicator | Supabase Realtime Presence |
| Read receipts | `read_at` timestamp on messages |
| File attachments | Supabase Storage upload → URL in message |
| Internal notes | `is_internal: boolean` flag (visible to staff only) |
| SLA tracking | `created_at` + `first_response_at` timestamps |
| Ticket assignment | `assigned_to` FK → HQ/School team member |
| Priority | `priority: low/medium/high` enum |
| Status | `status: open/in_progress/resolved` enum |
| Tags | Array field on conversation |
| Quick replies | `quick_reply_templates` table per school |
| Operator status | Supabase Realtime Presence |
| Search | Full-text search on messages (PostgreSQL) |
| CSV export | API route generates CSV from messages table |

### 15.3 Conversation Structure

```
conversations
├── id
├── type: 'hq_school' | 'school_student'
├── hq_id (nullable)
├── school_id
├── student_id (nullable)
├── status: 'open' | 'in_progress' | 'resolved'
├── priority: 'low' | 'medium' | 'high'
├── assigned_to (FK → team member)
├── tags: string[]
├── created_at
├── first_response_at
└── last_message_at

messages
├── id
├── conversation_id (FK)
├── sender_id (FK → auth.users)
├── sender_role: 'hq' | 'school' | 'student'
├── content: text
├── attachment_url (nullable)
├── is_internal: boolean
├── read_at (nullable)
└── created_at
```

---

## 16. Notification System

### 16.1 Channels

| Channel | Provider | Used for |
|---|---|---|
| Transactional Email | ZeptoMail | All role-based emails |
| PWA Push | Web Push API | Student mobile alerts |
| In-app | Supabase Realtime | All roles, real-time |

### 16.2 Notification Events

| Event | Email | Push | In-App | Recipients |
|---|---|---|---|---|
| Welcome / registration | ✅ | ❌ | ❌ | New user |
| Booking confirmed | ✅ | ✅ | ✅ | Student |
| Booking cancelled (by student) | ✅ | ✅ | ✅ | Student |
| Booking cancelled (by school) | ✅ | ✅ | ✅ | All booked students |
| Booking reminder (24h before) | ✅ | ✅ | ✅ | Student |
| No-show recorded | ✅ | ✅ | ✅ | Student |
| Credit low warning | ✅ | ✅ | ✅ | Student |
| Package expiring (7 days) | ✅ | ✅ | ✅ | Student |
| Subscription renewal | ✅ | ✅ | ✅ | Student |
| Payment failed | ✅ | ✅ | ✅ | Student |
| Payment succeeded | ✅ | ✅ | ✅ | Student |
| Invoice generated | ✅ | ❌ | ✅ | Student |
| Medical cert expiring (30 days) | ✅ | ✅ | ✅ | Student |
| Medical cert expiring (7 days) | ✅ | ✅ | ✅ | Student |
| Medical cert expired → blocked | ✅ | ✅ | ✅ | Student |
| Document validated by school | ✅ | ✅ | ✅ | Student |
| New lesson available | ✅ | ✅ | ✅ | Student |
| Teacher change | ✅ | ✅ | ✅ | Booked students |
| Schedule change | ✅ | ✅ | ✅ | Booked students |
| New message received | ✅ | ✅ | ✅ | Recipient |
| Attendance reminder | ✅ | ❌ | ✅ | Teacher |
| New school registered | ❌ | ❌ | ✅ | HQ Operations |
| School Stripe error | ✅ | ❌ | ✅ | HQ Tech + School |
| Special event pending approval | ❌ | ❌ | ✅ | HQ Operations |
| Special event approved/rejected | ✅ | ❌ | ✅ | School |
| Affiliation expiring (30 days) | ✅ | ❌ | ✅ | HQ + School |
| Platform fee change | ✅ | ❌ | ✅ | School |
| Compensation report ready | ✅ | ❌ | ✅ | Teacher |
| Grace period warning | ✅ | ✅ | ✅ | Student |
| Subscription suspended | ✅ | ✅ | ✅ | Student |
| Free trial ending (7 days) | ✅ | ❌ | ✅ | School + HQ |

### 16.3 Notification Preferences

Students can configure:
- Email reminders on/off
- Push notifications on/off
- Document expiry alerts on/off
- New lessons on/off
- Teacher/schedule changes on/off
- Promotions on/off

### 16.4 Multilingual

All notifications sent in user's language preference (IT/EN/FR/ES).

---

## 17. Metodo Library

### 17.1 Content Types

- Video lessons (MP4, stored in Supabase Storage)
- PDF documents (guides, notes)
- Categorized by: lesson type, language, level (entry/intermediate/advanced/all)

### 17.2 Access Levels

| Content | HQ | School | Teacher | Student |
|---|---|---|---|---|
| HQ official content (all schools) | ✅ | ✅ | ✅ | Configured per content |
| HQ content (specific schools) | ✅ | Only if assigned | Only if assigned | Only if assigned |
| School-uploaded content | ✅ | Own school | Own school | If school allows |
| Paid video courses | ✅ | ✅ | ✅ | After purchase |

### 17.3 Video Storage

- Videos stored in Supabase Storage (`metodo-library` bucket)
- Signed URLs for authenticated access (time-limited)
- Streaming via Supabase Storage signed URL
- Progress tracking stored in `video_progress` table

### 17.4 Student Video Courses

- Subset of Metodo Library accessible to students
- Some included in packages/subscriptions
- Some available for purchase (Stripe one-time payment)
- Progress bar and resume functionality
- Multilingual filter (IT/EN/FR/ES)

---

## 18. Shop

### 18.1 Product Management

- HQ manages platform-wide products
- Schools can add their own products
- Product types: clothing, shoes, accessories, equipment
- Digital/unlimited inventory (no stock tracking needed)
- Product fields: name, description, price, category, images, active toggle

### 18.2 Shop Flow

```
Student browses shop
    ↓
Add to cart
    ↓
Apply discount code (optional)
    ↓
Select school referral (optional → 3% student discount)
    ↓
Stripe checkout
    ↓
Payment processed
    ↓
Order confirmed → ZeptoMail
    ↓
School referral commission auto-calculated
    ↓
HQ platform fee applied
```

### 18.3 Referral Commission

- Student selects their school at checkout
- Student receives 3% discount
- School receives commission (% configured by HQ)
- Commission tracked in `shop_referral_commissions` table
- Visible in school payments dashboard

### 18.4 Digital Only

- No shipping management
- No physical stock tracking
- Orders fulfilled digitally or in-person by school/HQ

---

## 19. Email Templates

### 19.1 Template Management

- HQ manages global templates (all schools)
- Schools can override templates for their own emails
- Rich text editor with variable placeholders
- Multilingual (IT/EN/FR/ES)
- Preview before save
- All emails sent via ZeptoMail

### 19.2 Available Variables

```
{{user_name}}, {{user_email}}
{{school_name}}, {{school_address}}
{{lesson_name}}, {{lesson_date}}, {{lesson_time}}
{{teacher_name}}, {{location_name}}
{{credits_remaining}}, {{credits_deducted}}
{{package_name}}, {{package_expiry}}
{{subscription_name}}, {{subscription_renewal}}
{{payment_amount}}, {{payment_method}}
{{invoice_url}}, {{booking_url}}
{{cancellation_policy}}, {{refund_status}}
{{document_type}}, {{document_expiry}}
{{platform_name}} = "No Under 40"
```

### 19.3 Template List

All templates listed in Section 16.2 (Notification Events) require a corresponding ZeptoMail template.

---

## 20. Database Schema Overview

### Core Tables

```sql
-- HQ Team
hq_members (id, email, name, sub_role, active, created_at)

-- Schools
schools (
  id, name, slug, email, phone, address, city, country,
  logo_url, active, platform_fee_percentage,
  stripe_account_id, stripe_onboarding_complete,
  ical_token,
  free_trial_ends_at, created_at
)

-- School Locations
school_locations (id, school_id, name, address, google_maps_url)

-- School Rooms
school_rooms (id, location_id, name, capacity)

-- Teachers
teachers (
  id, user_id, name, email, phone, address,
  bio, photo_url, active, created_at
)

-- Teacher-School assignments
teacher_schools (teacher_id, school_id, compensation_plan_id, active)

-- Lesson Types (HQ Metodo Catalog)
lesson_types (
  id, code, name_it, name_en, name_fr, name_es,
  level, description_it, description_en, active
)

-- Compensation Plans
compensation_plans (
  id, school_id, name,
  base_fee, bonus_threshold, bonus_per_student
)

-- Compensation Plan Rates (per lesson type)
compensation_plan_rates (
  id, plan_id, lesson_type_id, base_fee, bonus_per_student
)

-- Courses
courses (
  id, school_id, lesson_type_id, teacher_id,
  room_id, name, description,
  frequency, start_date, end_date,
  start_time, duration_minutes,
  max_capacity, reserve_spots,
  credit_cost, color,
  vip_booking_hours_before,
  min_booking_notice_hours,
  waitlist_enabled, active, created_at
)

-- Lessons (individual instances)
lessons (
  id, course_id, school_id, teacher_id, room_id,
  lesson_type_id, date, start_time, end_time,
  max_capacity, current_bookings,
  status: 'scheduled'|'cancelled'|'completed',
  created_at
)

-- Students
students (
  id, user_id, name, email, phone,
  date_of_birth, address, city, country,
  language_preference, badge, created_at
)

-- Student-School relationship
school_students (
  id, school_id, student_id,
  free_lesson_used, enrolled_at
)

-- Packages
packages (
  id, school_id, name_it, name_en, name_fr, name_es,
  description_it, description_en,
  credits, validity_days, price,
  lesson_type_restriction: 'all' | lesson_type_id,
  stripe_product_id, stripe_price_id,
  color, is_popular, active
)

-- Subscriptions
subscriptions_catalog (
  id, school_id, name_it, name_en, name_fr, name_es,
  description_it, description_en,
  period_value, period_unit: 'days'|'weeks'|'months'|'years',
  access_count: integer | null (null = unlimited),
  lesson_type_restriction,
  price, auto_renewal,
  is_vip, priority_booking_hours,
  freeze_days_allowed,
  stripe_product_id, stripe_price_id,
  color, active
)

-- Student Packages (owned)
student_packages (
  id, student_id, school_id, package_id,
  credits_total, credits_remaining,
  purchased_at, expires_at,
  payment_method, stripe_payment_id,
  status: 'active'|'expired'|'exhausted'
)

-- Student Subscriptions (active)
student_subscriptions (
  id, student_id, school_id, subscription_catalog_id,
  access_total: integer | null,
  access_remaining: integer | null,
  started_at, current_period_end,
  grace_period_ends_at,
  stripe_subscription_id,
  status: 'active'|'grace_period'|'suspended'|'cancelled'
)

-- Bookings
bookings (
  id, student_id, lesson_id, school_id,
  access_source: 'subscription'|'package'|'free_lesson',
  student_package_id (nullable),
  student_subscription_id (nullable),
  credits_deducted: integer,
  status: 'confirmed'|'cancelled'|'attended'|'no_show',
  cancelled_at, cancellation_type: 'within_policy'|'outside_policy',
  credit_refunded: boolean,
  booked_at
)

-- Attendance
attendance (
  id, lesson_id, booking_id, student_id, teacher_id,
  status: 'present'|'no_show',
  marked_at
)

-- Transactions
transactions (
  id, school_id, student_id,
  type: 'package'|'subscription'|'video'|'shop'|'manual',
  product_id, product_name,
  amount, currency,
  platform_fee, school_amount,
  payment_method, stripe_payment_id,
  status: 'completed'|'pending'|'refunded'|'failed',
  invoice_url,
  referral_school_id, referral_commission,
  created_at
)

-- Documents
student_documents (
  id, student_id, school_id,
  type: 'medical_cert'|'privacy'|'image_release',
  file_url, uploaded_at, expires_at,
  status: 'valid'|'expiring'|'expired',
  validated_by, validated_at
)

-- Discount Codes
discount_codes (
  id, school_id, name, code,
  type: 'percentage'|'fixed',
  value, minimum_order,
  valid_for: 'packages'|'subscriptions'|'shop'|'all',
  expires_at, active, usage_count
)

-- Messages & Conversations
conversations (
  id, type: 'hq_school'|'school_student',
  hq_id, school_id, student_id,
  status, priority, assigned_to,
  tags, created_at, first_response_at, last_message_at
)

messages (
  id, conversation_id, sender_id, sender_role,
  content, attachment_url,
  is_internal, read_at, created_at
)

-- Notifications
notifications (
  id, user_id, user_role, type, title, body,
  data (jsonb), read_at, created_at
)

-- Metodo Library
library_content (
  id, school_id (null = HQ), lesson_type_id,
  title_it, title_en, title_fr, title_es,
  description, file_url, thumbnail_url,
  type: 'video'|'pdf', duration_seconds,
  level, language,
  visible_to_students: boolean,
  student_access: 'included'|'paid',
  price (if paid), stripe_product_id,
  restricted_to_school_ids: uuid[],
  active, created_at
)

-- Video Progress
video_progress (
  id, user_id, content_id,
  progress_seconds, completed, last_watched_at
)

-- Shop Products
shop_products (
  id, school_id (null = HQ), name, description,
  category, price, images: text[],
  stripe_product_id, active
)

-- Shop Orders
shop_orders (
  id, student_id, school_id,
  items: jsonb, subtotal, discount_amount,
  referral_school_id, referral_discount,
  total, stripe_payment_id,
  status, created_at
)

-- Closure Days
school_closures (
  id, school_id, date,
  type: 'full_day'|'partial',
  from_time, notes
)

-- Email Templates
email_templates (
  id, school_id (null = HQ global),
  template_key, language,
  subject, body_html,
  updated_at
)
```

---

## 21. API Routes Overview

### Auth
```
POST /api/auth/google          → Google OAuth callback
POST /api/auth/logout          → Sign out
GET  /api/auth/session         → Get current session + role
```

### Stripe
```
POST /api/webhooks/stripe      → Stripe Connect webhook handler
POST /api/stripe/onboard       → Start school Stripe Express onboarding
GET  /api/stripe/onboard/status → Check onboarding completion
POST /api/stripe/checkout      → Create checkout session (package/sub/video/shop)
POST /api/stripe/refund        → Process refund
```

### Calendar
```
GET  /api/calendar/[schoolId].ics          → iCal feed per school (public, filterable)
GET  /api/calendar/student/[token].ics     → Student personal iCal (private token)
GET  /api/calendar/lessons                 → Lessons query endpoint (used by in-app calendar)
```

### Bookings
```
POST /api/bookings             → Create booking (validates all rules)
POST /api/bookings/multiple    → Create multiple bookings
PUT  /api/bookings/[id]        → Modify booking
DELETE /api/bookings/[id]      → Cancel booking (apply policy)
```

### Attendance
```
POST /api/attendance/[lessonId]  → Teacher submits attendance
```

### Notifications
```
POST /api/notifications/send     → Send notification (internal)
POST /api/push/subscribe         → Register PWA push subscription
DELETE /api/push/unsubscribe     → Remove push subscription
```

### Credits
```
POST /api/credits/assign         → Manual credit assignment (school admin)
GET  /api/credits/[studentId]/[schoolId] → Get student credit balance
```

---

## 22. PWA Configuration

### Setup
- `next-pwa` package
- Service worker for offline caching
- Web App Manifest

### Manifest
```json
{
  "name": "No Under 40",
  "short_name": "NoUnder40",
  "theme_color": "#6B1F3A",
  "background_color": "#ffffff",
  "display": "standalone",
  "orientation": "portrait",
  "start_url": "/student/dashboard",
  "icons": [...]
}
```

### PWA Features
- Add to Home Screen prompt shown to students
- Push notifications (Web Push API)
- App-like navigation (bottom nav bar)
- Offline: NOT supported (requires live data)
- Mobile-optimized layouts for all student views
- Swipe actions on booking list
- Progress rings (credit usage)
- Sticky CTAs

### Mobile UX Elements
- Bottom navigation bar (Home, Book, My Lessons, Packages, Shop)
- Pull-to-refresh
- Swipe left on booking → Modify / Cancel actions
- Toast notifications
- Loading skeletons
- Haptic feedback (where supported)

---

## 23. Development Phases

> **How to read this section:**
> Each phase has a **Goal** (what problem it solves), **Who benefits** (which roles are unblocked), **Key components** (main tech areas touched), a **Task list**, and a **Done when** checkpoint (how to verify completion before moving on).
> Phases are sequential — each phase unlocks the next.

---

### Phase 1 — Foundation & Infrastructure
**Goal:** Working skeleton with auth, CI/CD, and all 4 role dashboards live

**Who benefits:** Dev team — unblocks all subsequent phases

**Key components:** Next.js, Supabase Auth, Vercel, ZeptoMail

**Tasks:**
- GitHub repo setup (branching strategy: `main`, `develop`, `feature/*`)
- Next.js 14 project (App Router, TypeScript, Tailwind CSS)
- Supabase project (database, auth, storage buckets: `documents`, `chat-attachments`, `metodo-library`)
- Core database schema: `profiles`, `schools`, `hq_members` tables + role enum
- Supabase Auth: email/password + Google OAuth
- Role-based middleware: route protection per role (`/hq/*`, `/school/*`, `/teacher/*`, `/student/*`)
- Layout & navigation shell per role (sidebar/topbar, no content yet)
- Vercel deployment pipeline (auto-deploy from `develop`)
- Environment variables management (`.env.example` documented)
- ZeptoMail: basic transactional email setup + test send

**Done when:** All 4 roles can log in and see their empty dashboard. A push to `develop` auto-deploys to Vercel.

---

### Phase 2 — HQ Panel & School Onboarding
**Goal:** HQ can manage the network, create schools, and configure global settings

**Who benefits:** HQ team, Schools (receive invitations)

**Key components:** HQ dashboard, school CRUD, ZeptoMail invitations, email templates

**Tasks:**
- HQ team member management (sub-roles, permissions matrix)
- HQ dashboard (network KPIs: active schools, students, lessons, subscriptions)
- School creation by HQ (name, city, platform fee %, free trial config)
- School activation / deactivation
- School onboarding invitation email (ZeptoMail)
- HQ network map (static pins with school data)
- HQ alert center (basic activity log)
- HQ inbox (ticket structure: status, priority, assignment)
- School profile management (name, address, logo, locations, rooms)
- Location/room CRUD with capacity fields
- Teacher invitation + profile creation by school
- School settings page (closure days, cancellation policy, grace period)
- Email templates management (HQ level, multilingual)

**Done when:** HQ creates a school → school receives email → school logs in → school sets up profile, adds a location/room, invites a teacher.

---

### Phase 3 — Calendar & Lesson Management
**Goal:** Schools can create and manage their full lesson schedule with real-time calendar

**Who benefits:** Schools, Teachers (can see their schedule)

**Key components:** Supabase Realtime calendar, iCal feeds, lesson CRUD, HQ approval flow

**Tasks:**
- HQ Metodo lesson type catalog (multilingual: IT/EN/FR/ES)
- Course creation wizard (4 steps: details → schedule → frequency → options)
- Recurring lesson auto-generation from course (weekly, bi-weekly, intensive)
- School calendar view (daily/weekly/monthly) — queries Supabase `lessons` table
- Supabase Realtime subscription: calendar updates instantly on lesson changes
- Lesson detail view (teacher, room, capacity, bookings)
- Lesson edit: individual instance or all future occurrences
- Lesson cancel: refund logic placeholder (no credits yet), ZeptoMail to booked students
- Room conflict detection on lesson creation
- Special event/workshop creation + HQ approval flow (draft → pending → approved → published)
- iCal feed per school: `GET /api/calendar/[schoolId].ics` (generated from Supabase)
- Student personal iCal feed: `GET /api/calendar/student/[token].ics`
- Teacher calendar view (assigned lessons only) + iCal subscription link

**Done when:** School creates a recurring course → lessons appear on calendar in real-time → teacher sees their lessons → iCal URL works in Google/Apple Calendar.

---

### Phase 4 — Students, Packages & Booking
**Goal:** Students can register, purchase access, and book lessons

**Who benefits:** Students (end-to-end booking), Schools (revenue + student management)

**Key components:** Student registration, Stripe checkout, booking engine, credit/access logic, documents, PWA

**Tasks:**
- Student self-registration (`/register`): Google OAuth + email/password
- Student profile completion (name, phone, DOB, address, city)
- Package catalog (school creates packages, synced to Stripe products)
- Subscription catalog (school creates subscriptions, Stripe recurring)
- Student-facing purchase flow: browse → Stripe checkout → auto-activation
- Manual credit assignment by school (cash payments)
- Booking flow: search by city → filter → select lesson → validate → confirm
- Booking validation engine: capacity, min notice, VIP window, medical cert, valid access
- Credit/access deduction logic: subscription priority over credits
- Cancellation policy engine: threshold-based refund or burn
- Multi-date booking (batch select recurring course dates)
- Booking modification flow with policy countdown
- Medical certificate upload + school validation
- Document management (privacy, image release)
- Document expiry tracking + booking block on expiry
- Free first lesson feature (per student per school)
- Student notification center (in-app: bookings, documents, payments)
- Discount codes system
- PWA manifest + Add to Home Screen prompt
- Mobile-optimized student layouts (bottom nav, swipe actions)

**Done when:** Student registers → buys a package → books a lesson → can cancel within policy (credit refunded) → cancels outside policy (credit burned).

---

### Phase 5 — Attendance & Teacher Panel
**Goal:** Teachers mark attendance; credits finalized; compensation calculated

**Who benefits:** Teachers, Schools (attendance reports), Students (no-show logic)

**Key components:** Attendance marking UI, credit finalization, compensation engine, Supabase Edge Functions

**Tasks:**
- Teacher dashboard (today's lessons, weekly schedule, monthly stats)
- Attendance marking: student list per lesson → mark Present / No-show → save
- Credit/access confirmation on Present; burn on No-show (no override by school)
- Attendance report pushed to school dashboard
- Attendance reminder to school if not marked (Supabase Edge Function scheduled job)
- Teacher performance stats (lessons, hours, attendance rate, no-show rate)
- Compensation plan management: school creates plans (base fee + bonus threshold)
- Compensation plan rates per lesson type (optional)
- Monthly compensation calculation engine (aggregate per teacher)
- Compensation simulator (preview earnings for a given lesson scenario)
- Teacher compensation report (ZeptoMail + in-app)
- Teacher iCal subscription link (personal feed)
- Metodo Library (teacher view: HQ content + school content filtered by specialty)

**Done when:** Teacher opens lesson → marks students → present students' credits confirmed → no-show credits burned → school sees attendance report → monthly compensation is calculated correctly.

---

### Phase 6 — Payments & Finance
**Goal:** Full end-to-end payment cycle with automatic platform fee splitting

**Who benefits:** Schools (receive payments), HQ (receives platform fee), Students (invoices)

**Key components:** Stripe Connect Express, webhooks, grace period, multi-gateway, invoices

**Tasks:**
- Stripe Connect Express: school onboarding flow (link → complete → verified)
- Platform fee split: automatic via Stripe `application_fee_amount`
- Stripe webhook handler (`/api/webhooks/stripe`): all events (payment, subscription, refund, account)
- Subscription recurring billing: Stripe handles renewal → webhook updates Supabase
- Payment failed → grace period logic (default 7 days, configurable per school)
- Grace period ZeptoMail reminders (day 1, day 4, day 7)
- Subscription suspended after grace period
- Transaction table (school view + HQ consolidated view)
- Invoice auto-generation on payment → stored in Supabase Storage → sent via ZeptoMail
- Refund management (school admin triggers full refund via platform)
- Multi-gateway support: PayPal connect, Bonifico (manual), POS (manual), Cash (manual)
- HQ payment consolidated view (all schools, filter by school/date/status)
- Free trial management: HQ configures per school, auto-applies fee after trial ends
- ZeptoMail: all payment emails (confirmation, invoice, failed, refund, grace period)

**Done when:** Student buys a package → Stripe splits payment to school + HQ → webhook activates credits → invoice emailed → school sees transaction → payment failure triggers grace period correctly.

---

### Phase 7 — Chat & Communication
**Goal:** All roles can communicate through the platform; support tickets managed

**Who benefits:** HQ (school support), Schools (student support), Students (live chat)

**Key components:** Supabase Realtime chat, RLS permissions, ticket system, file attachments

**Tasks:**
- Supabase Realtime chat infrastructure (`conversations` + `messages` tables)
- RLS policies enforcing chat matrix (HQ↔School, School↔Student only)
- HQ ↔ School chat (all HQ sub-roles with chat permission)
- School ↔ Student chat (own students only)
- Internal notes (staff-only, `is_internal: true`, not visible to student)
- Typing indicator (Supabase Realtime Presence)
- Read receipts (`read_at` timestamp)
- File/image attachments (upload to Supabase Storage `chat-attachments`)
- Ticket system: status (open/in_progress/resolved), priority, SLA tracking, team assignment
- Quick reply templates (per school)
- Student profile sidebar in school inbox (credits, packages, documents)
- HQ inbox: team assignment, search, filters, CSV export
- School inbox: student list, search, filters
- Student support center: live chat + FAQ by category
- Operator online status indicator (Supabase Realtime Presence)
- ZeptoMail: new message notification email
- PWA push notification for new messages

**Done when:** Student sends message to school → school sees it in inbox with student profile sidebar → school replies → student gets push notification → HQ can open a ticket with a school and assign it to a team member.

---

### Phase 8 — Analytics & Reporting
**Goal:** All roles have full visibility into performance data; reports exportable

**Who benefits:** HQ (network overview), Schools (business insights), Teachers (performance), Students (personal stats)

**Key components:** Analytics queries, charts, CSV export, scheduled email reports

**Tasks:**
- HQ network analytics: active schools, students, revenue, subscriptions
- HQ school performance comparison table
- HQ revenue trends charts
- HQ network map with live school data
- Weekly KPI report email to HQ (ZeptoMail, Supabase Edge Function cron)
- School lesson analytics: attendance, no-shows, cancellations, credits used
- School student analytics: retention rate, LTV, frequency, document status
- School teacher analytics: performance score, compensation, attendance rate
- Student personal stats: total lessons, hours, streak, credits used
- Teacher performance dashboard: lessons, hours, earnings
- CSV export for all major tables (transactions, attendance, students, bookings)

**Done when:** HQ sees network KPIs, school can export their attendance CSV, student sees their streak and credit history.

---

### Phase 9 — Content, Metodo Library & Shop
**Goal:** Video content library and e-commerce shop fully operational

**Who benefits:** HQ (content monetization), Schools (branded content), Students (learning + shopping)

**Key components:** Supabase Storage video streaming, progress tracking, Stripe one-time payments, shop cart

**Tasks:**
- Metodo Library: HQ uploads content (video/PDF), categorized by lesson type + language + level
- Content restriction per school (visible to all or specific schools)
- School content upload (school-specific videos/PDFs)
- Teacher access to HQ + school content filtered by their specialties
- Student video course catalog (included vs paid)
- Video streaming via Supabase Storage signed URLs
- Video progress tracking (`video_progress` table: seconds watched, completed flag)
- Resume last position functionality
- Video course purchase flow (Stripe one-time payment)
- Shop: product management (HQ + school products)
- Shop cart + Stripe checkout
- School referral at checkout (3% student discount, school commission)
- Discount codes in shop
- Shop order history (student profile)
- ZeptoMail: order confirmation email
- Shop referral commission tracking (`shop_referral_commissions`)

**Done when:** HQ uploads a video → teachers see it filtered by specialty → student buys a course → can resume from last position → student buys from shop → school sees commission.

---

### Phase 10 — PWA Polish, QA & Launch
**Goal:** Production-ready, fully tested platform

**Who benefits:** All roles (polished experience), Dev team (confidence to launch)

**Key components:** PWA service worker, push notifications, performance, security audit, QA

**Tasks:**
- PWA full configuration (service worker, manifest, icons for all sizes)
- Mobile UX polish: bottom nav bar, pull-to-refresh, swipe actions, progress rings, sticky CTAs
- Full push notification implementation (all events from Section 16.2)
- Performance optimization: image optimization, lazy loading, Supabase query caching
- Accessibility audit (WCAG 2.1 AA)
- Security audit: RLS policy review, API route hardening, OWASP checklist
- Full regression QA (all flows × all roles × desktop + mobile)
- Bug fixing sprint
- Load testing (concurrent users, booking race conditions)
- API documentation + deployment guide + contributor guide
- Production environment setup on Vercel (env vars, domains, Stripe live keys)
- Post-launch monitoring (Vercel Analytics, Supabase dashboard alerts)

**Done when:** All QA test cases pass on production URL. Push notifications work on Android + iOS. No open critical bugs. Load test passes.

---

## Summary

| Phase | Focus | Who it Unblocks | Priority |
|---|---|---|---|
| 1 | Foundation & Infrastructure | Dev team | 🔴 Critical |
| 2 | HQ Panel & School Onboarding | HQ, Schools | 🔴 Critical |
| 3 | Calendar & Lesson Management | Schools, Teachers | 🔴 Critical |
| 4 | Students, Packages & Booking | Students | 🔴 Critical |
| 5 | Attendance & Teacher Panel | Teachers, Schools | 🟠 High |
| 6 | Payments & Finance | Schools, HQ | 🔴 Critical |
| 7 | Chat & Communication | All roles | 🟠 High |
| 8 | Analytics & Reporting | HQ, Schools | 🟡 Medium |
| 9 | Content, Library & Shop | Students, HQ | 🟡 Medium |
| 10 | PWA Polish & Launch | All roles | 🟠 High |

---

*Document generated: March 2026 — No Under 40 Platform v1.0*
