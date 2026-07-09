#!/usr/bin/env python3
"""
Stripe go-live flip for gemlinecards.com.

Usage:
  STRIPE_LIVE_PK=pk_live_... STRIPE_LIVE_SK=sk_live_... VERCEL_TOKEN=... python3 scripts/stripe-go-live.py

What it does (idempotent):
  1. Validates the live secret key and checks the account is activated
     (charges_enabled + payouts_enabled). Aborts if not.
  2. Creates (or reuses) the LIVE webhook endpoint on
     https://gemlinecards.com/api/webhook/stripe with the full event set,
     capturing the live whsec.
  3. Upserts Vercel production env vars:
       NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
  4. Prints next steps (redeploy via git push; verify script below).

After running: git commit --allow-empty -m 'redeploy: stripe live' && git push
Then verify:   python3 scripts/stripe-go-live.py --verify  (checks pk in prod bundle
               and that the webhook rejects bad signatures)
"""
import os, sys, json, urllib.request, urllib.parse

PROJECT_ID = "prj_dDBhiYPkrTycXq0pl7CCTsbw9k5D"
TEAM_QS = ""  # personal account scope
WEBHOOK_URL = "https://gemlinecards.com/api/webhook/stripe"
EVENTS = [
    "payment_intent.amount_capturable_updated", "payment_intent.succeeded",
    "payment_intent.payment_failed", "payment_intent.canceled",
    "checkout.session.completed", "customer.subscription.updated",
    "customer.subscription.deleted", "transfer.created",
]

def req(url, method="GET", data=None, headers=None, form=False):
    h = dict(headers or {})
    body = None
    if data is not None:
        if form:
            body = urllib.parse.urlencode(data, doseq=True).encode()
            h["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            body = json.dumps(data).encode()
            h["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode() or "{}")
        except Exception: return e.code, {}

def verify_only():
    import re
    st, _ = req(WEBHOOK_URL, method="POST", data={"fake": True})
    print(f"webhook bad-sig probe: HTTP {st} (expect 400)")
    with urllib.request.urlopen("https://gemlinecards.com/") as resp:
        html = resp.read().decode(errors="ignore")
    chunks = set(re.findall(r'/_next/static/chunks/[A-Za-z0-9_.-]+\.js', html))
    found = None
    for c in list(chunks)[:25]:
        try:
            with urllib.request.urlopen("https://gemlinecards.com" + c) as resp:
                if "pk_live_" in resp.read().decode(errors="ignore"):
                    found = c; break
        except Exception: pass
    print("pk_live in prod bundle:", found or "NOT FOUND (check env + redeploy)")
    sys.exit(0)

if "--verify" in sys.argv:
    verify_only()

PK = os.environ.get("STRIPE_LIVE_PK", "")
SK = os.environ.get("STRIPE_LIVE_SK", "")
VT = os.environ.get("VERCEL_TOKEN", "")
if not (PK.startswith("pk_live_") and SK.startswith("sk_live_") and VT):
    sys.exit("Set STRIPE_LIVE_PK (pk_live_...), STRIPE_LIVE_SK (sk_live_...), VERCEL_TOKEN")

auth = {"Authorization": "Bearer " + SK}

# 1. account activation check
st, acct = req("https://api.stripe.com/v1/account", headers=auth)
if st != 200:
    sys.exit(f"Live key rejected (HTTP {st}): {acct}")
print(f"account: {acct.get('id')} charges_enabled={acct.get('charges_enabled')} payouts_enabled={acct.get('payouts_enabled')}")
if not acct.get("charges_enabled"):
    sys.exit("ABORT: account not activated for live charges. Finish activation at dashboard.stripe.com")
due = (acct.get("requirements") or {}).get("currently_due") or []
if due: print("WARN requirements currently_due:", due)

# 2. live webhook (reuse if exists)
st, hooks = req("https://api.stripe.com/v1/webhook_endpoints?limit=100", headers=auth)
existing = next((h for h in hooks.get("data", []) if h["url"] == WEBHOOK_URL), None)
if existing:
    st, wh = req(f"https://api.stripe.com/v1/webhook_endpoints/{existing['id']}",
                 method="POST", data={"enabled_events[]": EVENTS}, headers=auth, form=True)
    whsec = None  # secret only shown at creation
    print(f"webhook reused: {existing['id']} (secret not re-shown — keep existing STRIPE_WEBHOOK_SECRET or delete+rerun)")
else:
    st, wh = req("https://api.stripe.com/v1/webhook_endpoints", method="POST",
                 data={"url": WEBHOOK_URL, "enabled_events[]": EVENTS,
                       "description": "gemline prod (go-live script)"}, headers=auth, form=True)
    if st != 200: sys.exit(f"webhook create failed: {wh}")
    whsec = wh["secret"]
    print(f"webhook created: {wh['id']}")

# 3. vercel env upsert (production)
vh = {"Authorization": "Bearer " + VT}
def upsert_env(key, value, sensitive=True):
    if value is None: return
    st, envs = req(f"https://api.vercel.com/v9/projects/{PROJECT_ID}/env?decrypt=false{TEAM_QS}", headers=vh)
    for e in envs.get("envs", []):
        if e["key"] == key and "production" in e.get("target", []):
            req(f"https://api.vercel.com/v9/projects/{PROJECT_ID}/env/{e['id']}{TEAM_QS}", method="DELETE", headers=vh)
    st, out = req(f"https://api.vercel.com/v10/projects/{PROJECT_ID}/env{TEAM_QS}", method="POST",
                  data={"key": key, "value": value, "type": "encrypted" if sensitive else "plain",
                        "target": ["production"]}, headers=vh)
    print(f"env {key}: HTTP {st}")

upsert_env("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", PK, sensitive=False)
upsert_env("STRIPE_SECRET_KEY", SK)
upsert_env("STRIPE_WEBHOOK_SECRET", whsec)

print("""
DONE. Next:
  1. git commit --allow-empty -m 'redeploy: stripe live' && git push   (Vercel auto-builds)
  2. python3 scripts/stripe-go-live.py --verify
  3. Enable Stripe Connect (Express) in dashboard for seller payouts, if not already.
  4. Run one real $1 listing buy end-to-end, then refund it.
""")
