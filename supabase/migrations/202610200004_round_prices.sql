-- Launch prices lowered 50% from 202610200003 and rounded, keeping the reference ratios.
-- Annual SKUs hold the full amount charged once per year (12.500, 15.000, 30.000 and 60.000 per month).
-- Safe to run with or without 202610200003: it only updates existing catalog rows.
update public.products as p
set price_cents = v.price_cents, active = true
from (values
  ('basic-month',          2000000),
  ('standard-month',       2700000),
  ('professional-month',   6000000),
  ('enterprise-month',    10500000),
  ('basic-year',          15000000),
  ('standard-year',       18000000),
  ('professional-year',   36000000),
  ('enterprise-year',     72000000)
) as v(sku, price_cents)
where p.sku = v.sku;
