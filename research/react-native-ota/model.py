"""Reproduce the research scenarios using Python's standard library.

These are assumptions and published-price illustrations, not market measurements.
Run: python3 research/react-native-ota/model.py
All monetary values are USD. Pricing observed 2026-09-10.
"""

import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def write_csv(name, rows):
    with (ROOT / name).open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def eas_mau_overage(mau, included):
    # Graduated marginal tiers from https://expo.dev/pricing.md.
    # Only the first three paid bands are needed for these examples.
    assert 0 <= mau <= 1_000_000
    return (
        max(0, min(mau, 200_000) - included) * 0.005
        + max(0, min(mau, 500_000) - 200_000) * 0.00375
        + max(0, mau - 500_000) * 0.0034
    )


def eas_total(mau, gib, plan):
    if plan == "Free":
        return 0 if mau <= 1_000 and gib <= 100 else float("inf")
    base, included, bandwidth = (
        (19, 3_000, 100) if plan == "Starter" else (199, 50_000, 1024)
    )
    allowance = bandwidth + max(0, mau - included) * 40 / 1024
    return base + eas_mau_overage(mau, included) + max(0, gib - allowance) * 0.1


def otakit_total(deliveries, annual=False):
    # Hypothetical RN pricing if OtaKit extends its current Capacitor meter.
    # Pro overage is modeled pro rata, with overage enabled; not a new quote.
    if deliveries <= 5_000:
        return 0
    if deliveries <= 100_000:
        return 10
    return (25 if annual else 50) + max(0, deliveries - 1_000_000) * 50 / 1_000_000


market = []
for name, organizations, paid_share, arpa, contestable in [
    ("Conservative", 10_000, 0.2, 50, 0.1),
    ("Middle illustration", 30_000, 0.3, 100, 0.2),
    ("Upside", 75_000, 0.4, 200, 0.25),
]:
    buyers = organizations * paid_share
    tam = buyers * arpa * 12
    market.append({
        "scenario": name,
        "assumed_maintained_rn_organizations": organizations,
        "assumed_paid_ota_share": paid_share,
        "implied_paying_organizations": int(buyers),
        "assumed_monthly_ota_arpa_usd": arpa,
        "annual_category_opportunity_usd": int(tam),
        "assumed_contestable_share": contestable,
        "annual_contestable_opportunity_usd": int(tam * contestable),
        "evidence_status": "Assumptions; no census or audited OTA revenue estimate",
        "context_sources_not_numeric_input_sources": "https://georgian.io/posts/why-georgian-invested-in-expo ; https://www.appbrain.com/stats/libraries/details/react_native/react-native",
        "formula": "organizations * paid_share * monthly_arpa * 12; contestable multiplies this by contestable_share",
    })
write_csv("market-scenarios.csv", market)

pricing = []
revo_plans = {
    "Starter": (0, 1_000, 10),
    "Startup": (25, 50_000, 100),
    "Growing": (100, 300_000, 1000),
    "Business": (250, 500_000, 2000),
    "Professional": (500, 1_000_000, 5000),
}
for mau, frequency, revo_selected in [
    (1_000, 2, "Starter"),
    (10_000, 4, "Startup"),
    (50_000, 4, "Startup"),
    (250_000, 4, "Growing"),
    (1_000_000, 8, "Professional"),
]:
    deliveries = mau * frequency
    transfer_mib = 5
    gib = deliveries * transfer_mib / 1024
    gb = gib * 1024**3 / 10**9
    eas_plan = min(["Free", "Starter", "Production"], key=lambda p: eas_total(mau, gib, p))

    def revo_total(plan):
        base, included, allowance_gb = revo_plans[plan]
        return base + max(0, mau - included) / 1000 + max(0, gb - allowance_gb) * 0.03

    revo_min_plan = min(revo_plans, key=revo_total)
    pricing.append({
        "ota_receiving_installations_month": mau,
        "deliveries_per_installation_month": frequency,
        "completed_deliveries_month": deliveries,
        "assumed_transferred_mib_per_delivery": transfer_mib,
        "transfer_gib": round(gib, 3),
        "transfer_decimal_gb": round(gb, 3),
        "eas_lowest_public_plan_excluding_enterprise": eas_plan,
        "eas_monthly_usd": round(eas_total(mau, gib, eas_plan), 2),
        "revopush_selected_plan": revo_selected,
        "revopush_selected_plan_usd": round(revo_total(revo_selected), 2),
        "revopush_lowest_list_price_plan": revo_min_plan,
        "revopush_lowest_list_price_usd": round(revo_total(revo_min_plan), 2),
        "otakit_hypothetical_rn_monthly_usd": round(otakit_total(deliveries), 2),
        "otakit_hypothetical_rn_annual_equivalent_usd": round(otakit_total(deliveries, annual=True), 2),
        "assumptions": "Equal wire bytes; one installation per MAU; no retries; no storage overages; USD before tax; EAS build credits not subtracted; Revo GB/TB treated decimal and overages pro rata",
        "price_sources": "https://expo.dev/pricing.md ; https://revopush.org/pricing ; OtaKit packages/site/app/page.tsx at 39cafb4e115cd8445c9d5e6fe6738a9c4fd2883c",
        "price_observation_date": "2026-09-10",
    })
write_csv("pricing-scenarios.csv", pricing)

economics = []
for arpa in [10, 25, 50, 100, 250]:
    for customers in [100, 500, 1000]:
        annual_revenue = arpa * customers * 12
        economics.append({
            "monthly_arpa_usd": arpa,
            "paying_organizations": customers,
            "annual_revenue_usd": annual_revenue,
            "assumed_contribution_margin": 0.8,
            "annual_contribution_before_fixed_costs_usd": annual_revenue * 0.8,
            "assumed_incremental_annual_fixed_cost_usd": 60_000,
            "annual_contribution_after_assumed_fixed_cost_usd": annual_revenue * 0.8 - 60_000,
            "break_even_customers_at_this_arpa": 60_000 / (arpa * 12 * 0.8),
            "evidence_status": "Illustrative economics; excludes acquisition cost and initial development payback",
        })
write_csv("customer-economics.csv", economics)

assert market[1]["annual_category_opportunity_usd"] == 10_800_000
assert market[1]["annual_contestable_opportunity_usd"] == 2_160_000
assert eas_mau_overage(250_000, 50_000) == 937.5
assert otakit_total(1_000_000) == 50
assert otakit_total(8_000_000) == 400
assert round(eas_total(50_000, 50_000 * 4 * 5 / 1024, "Production"), 2) == 199
assert round(eas_total(250_000, 250_000 * 4 * 5 / 1024, "Production"), 2) == 1136.5
for row in pricing:
    print(row["ota_receiving_installations_month"], row["eas_monthly_usd"], row["revopush_lowest_list_price_usd"], row["otakit_hypothetical_rn_monthly_usd"])
