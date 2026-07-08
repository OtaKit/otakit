# OtaKit — Google Search Ads Plan

Internal playbook for the first paid acquisition campaign. Keep this out of the
public repo (the repo is MIT/public — don't commit competitor strategy).

**Scope:** Google Search only. Three keyword themes — `capacitor ota`, `capgo`,
`capawesome` — mapped to three landing pages that already exist:

| Ad group | Intent | Landing page |
|---|---|---|
| Capacitor OTA | Category ("I need OTA for Capacitor") | `https://www.otakit.app/` |
| Capgo | Competitor (evaluating or unhappy) | `https://www.otakit.app/vs/capgo` |
| Capawesome | Competitor (evaluating or unhappy) | `https://www.otakit.app/vs/capawesome` |

---

## 1. Economics first (decide before spending)

- Pro = $25/mo billed yearly ($300/yr). Assume ~2-year average retention →
  **LTV ≈ $600** per paying customer.
- Funnel assumption to sanity-check spend: click → signup ~10–20% (these are
  high-intent keywords), signup → paying ~10–20% over 90 days.
  → One paying customer per ~30–70 clicks.
- Dev-tool CPCs for these terms typically run **$2–6**. So expect roughly
  **$100–350 per paying customer** at baseline — fine against $600 LTV, but the
  volume is small, so treat this as a learning + brand-capture play, not a
  growth engine.
- **Starting budget: $15–20/day** ($450–600/mo), shared across both campaigns.
  These keywords have low search volume; a bigger budget just buys broader,
  worse queries.

## 2. Account structure

Two campaigns (not one) so competitor and category budgets/bids stay separate:

```
Campaign 1: Search — Competitors   ($8–12/day)
  Ad group: Capgo        → /vs/capgo
  Ad group: Capawesome   → /vs/capawesome

Campaign 2: Search — Category      ($7–8/day)
  Ad group: Capacitor OTA → /
```

Campaign settings (both):

- **Networks: Search only.** Turn OFF Display Network. Turn OFF Search
  Partners (low quality for dev tools).
- **Locations:** start with US, Canada, UK, Ireland, Australia, New Zealand,
  Germany, Netherlands, Nordics, France, Spain, Italy, Poland, Portugal,
  Switzerland, Austria, Belgium. (High developer purchasing power; expand
  later — India/Brazil/SEA have real Capacitor communities but much lower
  conversion-to-paid.) Location option: **"Presence"**, not "Presence or
  interest".
- **Language: English** (the queries are English even from non-English
  countries).
- **Bidding at launch: Maximize Clicks with a CPC cap of $6.** Switch per
  §7 once conversions flow.
- Ad schedule: none (developers search at all hours). Revisit only with data.
- No broad audience expansion / optimized targeting toggles.

## 3. Keywords

Match types: **exact + phrase only.** No broad match at this budget — broad on
"capgo" will happily spend on "cap go kart".

### Ad group: Capgo
```
[capgo]
[capgo alternative]
[capgo alternatives]
[capgo pricing]
[capgo vs]
"capgo alternative"
"alternative to capgo"
[capgo capacitor]
```

### Ad group: Capawesome
```
[capawesome]
[capawesome alternative]
[capawesome live update]
[capawesome pricing]
"capawesome alternative"
[capacitor live update plugin]
```

### Ad group: Capacitor OTA
```
[capacitor ota]
[capacitor ota updates]
[capacitor over the air updates]
[capacitor live updates]
[ota updates capacitor]
"capacitor ota update"
[capacitor code push]        ← people port the React Native term
[ionic ota updates]          ← Ionic ≈ Capacitor audience
```

### Expansion tier (add only after 2–4 weeks if volume is too low)
```
[appflow alternative] [ionic appflow alternative]   ← Appflow was sunset; refugees
[capacitor hot update] [capacitor app update without store]
[code push alternative] [microsoft code push alternative]
```

### Negative keywords (shared list, apply to both campaigns)

Navigational and non-buyer intent — existing customers and job seekers:

```
login, log in, sign in, dashboard, status, down, outage,
docs, documentation, api reference, changelog,
github, npm, discord, community, forum,
jobs, careers, salary, hiring,
free download, crack,
what is capacitor, capacitor js tutorial (category campaign only)
```

Also add `otakit` as a negative **nowhere** — but don't bid on it either (no
one is searching it yet; when they do, organic #1 is free).

**Weekly ritual:** open the Search Terms report, add every junk query as a
negative. At low volume this is the single highest-leverage task.

## 4. Ad copy (RSAs)

Rules of the game:

- Google's trademark policy allows **bidding** on "capgo"/"capawesome"
  everywhere. Using the trademark **in ad text** is fine *until* the owner
  files a complaint — then those ads get disapproved. Strategy: run
  trademark-containing headlines now, keep generic fallbacks in the same RSA
  so a disapproval only costs you headlines, not the ad.
- Pin sparingly: pin one brand-anchor headline to position 1, leave the rest
  free for Google to optimize.
- The wedge, in priority order: **cheaper → open source → CDN delivery →
  privacy**. Numbers beat adjectives: "$25 vs $83" outperforms "cheaper".

### Ad group: Capgo (→ /vs/capgo)

Headlines (mix & match, ≤30 chars each):
```
The Cheaper Capgo Alternative      ← pin 1 (fallback if disapproved: "The Cheaper OTA Platform")
Capacitor OTA Updates
Open Source Live Updates
50k Users: $25 vs $83/mo
Same Features, Simpler Pricing
No MAU or Bandwidth Billing
100% Cloudflare CDN Delivery
Switch In An Afternoon
Free Tier: 10,000 Updates/mo
No Credit Card Required
MIT Licensed, Self-Hostable
Zero End-User Tracking
```

Descriptions (≤90 chars):
```
Full OTA feature parity — delta updates, channels, rollback, E2E encryption. Migrate in an afternoon.
One price meter: updates delivered. No MAU, bandwidth, or storage bills. Free tier included.
Updates delivered 100% from Cloudflare's edge. Open source (MIT), self-hostable, no user tracking.
APIs map one-to-one. Full migration guide included. Start free — no credit card required.
```

### Ad group: Capawesome (→ /vs/capawesome)

Headlines:
```
Open-Source Capawesome Alternative  ← pin 1 (fallback: "Open Source OTA Updates")
Cheaper Capacitor Live Updates
250k Users: $25 vs $249/mo
Entire Stack MIT Licensed
Real Free Tier, Not A Trial
No MAU Caps Or User Tracking
100% Cloudflare CDN Delivery
Delta Updates & Auto Rollback
Switch In An Afternoon
Free: 10,000 Updates/mo
```

Descriptions:
```
Full live-update feature parity, fully open stack — plugin, CLI, dashboard, server. MIT.
Billed on updates delivered, not monthly active users. Quiet months cost nothing.
Free tier is 10,000 updates/mo with unlimited apps — not a 14-day trial. Start free.
Signed manifests, SHA-256 verification, optional E2E encryption. Auto rollback built in.
```

### Ad group: Capacitor OTA (→ homepage)

Headlines:
```
Capacitor OTA Updates             ← pin 1
Ship App Updates Instantly
Skip App Store Review Delays
Live Updates For Capacitor
Open Source & Self-Hostable
Free: 10,000 Updates/mo
Push Fixes In Minutes
App Store Policy Compliant
Delta Updates & Auto Rollback
Setup In 10 Minutes
No Credit Card Required
```

Descriptions:
```
Push over-the-air updates directly to your Capacitor app. No store review, live in minutes.
Fully compliant with Apple & Google policies — web layer only, native stays in review.
Open source (MIT), delivered from Cloudflare's edge. Free tier, no credit card required.
Delta updates, channels, automatic rollback, E2E encryption. Everything on every plan.
```

## 5. Assets (extensions) — attach at campaign level

- **Sitelinks:** Pricing (`/#pricing`), Migration Guide
  (`/blog/migrate-from-capgo-and-capawesome`), Docs — 10-Min Setup
  (`/docs/setup`), OtaKit vs Capgo (`/vs/capgo`) / vs Capawesome
  (`/vs/capawesome`), GitHub? (no — keep clicks on the funnel).
- **Callouts:** Open Source (MIT) · Free 10,000 Updates/mo · No Credit Card ·
  Cloudflare CDN Delivery · Auto Rollback · E2E Encryption Option
- **Structured snippet** (Features): Delta Updates, Channels, Auto Rollback,
  E2E Encryption, Self-Hosting, Real-Time Analytics

## 6. Conversion tracking (do this BEFORE launch — non-negotiable)

> **STATUS: implemented in code** (on the `vercel` branch). The tag renders
> only when env vars are set — to go live, add these in Vercel:
>
> - Site project (`otakit`): `NEXT_PUBLIC_GA_ID`, `NEXT_PUBLIC_GOOGLE_ADS_ID`
> - Console project (`otakit-console`): same two, plus conversion labels
>   `NEXT_PUBLIC_ADS_SIGNUP_LABEL`, `NEXT_PUBLIC_ADS_APP_CREATED_LABEL`,
>   `NEXT_PUBLIC_ADS_RELEASE_LABEL` (from Ads UI → each conversion action →
>   "Use Google tag" → the string after the slash in `AW-XXXX/label`)
>
> Events wired: `sign_up` (once per user, first dashboard visit within 30 min
> of account creation), `app_created`, `release_created`. GA4 events always
> fire; Ads conversion pings fire only when the matching label env is set.
> Consent Mode v2 defaults: denied in EEA/UK/CH, granted elsewhere, with
> `url_passthrough` + `ads_data_redaction` for modeled conversions.

Without it, every optimization decision is blind and smart bidding is
impossible. The wrinkle: signup happens on **console.otakit.app**, a different
subdomain of the ad-click landing on **www.otakit.app** — same eTLD+1, so
cookies carry over, but both apps need the tag.

1. Add the **Google tag (gtag.js)** to both `packages/site` and
   `packages/console` (or GA4 via a shared component; Consent Mode v2 for EU
   traffic — you're privacy-positioned, behave like it).
2. **Primary conversion: account signup** (fire on first successful login /
   org creation in console). Count: one per click.
3. **Secondary conversions (observation only, don't bid on them):**
   first app registered, first release shipped — these are your activation
   signals and tell you which keyword brings users who *do something*.
4. **Later (month 2+): value-based.** Send Pro purchases as conversions with
   value ($300) via Polar webhook → Google Ads offline conversion import
   (Enhanced Conversions for Leads with the signup email). Then bid tROAS.
5. Verify with Google Tag Assistant on the full path:
   ad click → /vs/capgo → console login → signup event, with GCLID surviving.

## 7. Bidding & budget evolution

| Phase | When | Bidding |
|---|---|---|
| 1. Learn | Weeks 1–3 | Maximize Clicks, CPC cap $6 |
| 2. Optimize | ≥15–30 signups recorded | Maximize Conversions (no target) |
| 3. Control | ≥30 conv/mo steady | tCPA at observed CPA × 1.1, ratchet down |
| 4. Value | Purchase import live | tROAS on purchase value |

Never skip straight to tCPA at low volume — Google needs the conversions to
learn or it will simply stop serving.

## 8. Weekly operating checklist (15 minutes)

1. Search Terms report → add negatives, promote good queries to exact.
2. Check per-ad-group: CTR (expect competitor groups 5–15%, category 3–8%),
   CPC, signups/CPA.
3. Ad Strength + disapprovals (trademark complaints show up here — swap in
   fallback headlines, don't fight it).
4. Landing page check: any deploy break /vs pages? (They're prod on the
   `vercel` branch.)
5. Once/month: pause the worst RSA variant, add one new headline/description
   test. One change at a time — the volume is too low for multivariate.

## 9. What "winning" looks like

Realistic volume math: "capgo" + variants ≈ 1–3k searches/mo globally,
"capawesome" less, "capacitor ota" cluster ≈ 1–2k. With top-3 ad position
expect **300–700 clicks/mo total** at full budget. Targets:

- Month 1: tracking proven, ≥30 signups, CPA ≤ $20/signup, zero junk spend
  in search terms.
- Month 3: 1–3 paying customers/mo from ads, CAC ≤ $300, tCPA live.
- Kill criteria: if after ~$1,000 spend signups cost > $40 or activate at
  < half the organic rate — pause competitor keywords, keep only exact-match
  category, and put the money into content/SEO instead (the /vs pages keep
  earning organic "capgo alternative" traffic for free either way).

## 10. Not-to-do list

- ❌ Broad match, Display expansion, Search Partners, Performance Max.
- ❌ Bidding on "capacitor" alone or "ionic" alone (framework queries, not
  update-tool intent).
- ❌ Auto-applied Google recommendations — turn OFF auto-apply in settings;
  they exist to raise spend, not your ROI.
- ❌ Sending competitor traffic to the homepage (message match is why the /vs
  pages exist).
- ❌ Scaling budget before conversion tracking has proven itself end-to-end.
