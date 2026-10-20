-- Launch prices in ARS, final price to the customer.
-- Converted from the reference USD price list at the MEP rate of 20/10/2026 (~$1.545) and rounded.
-- Annual SKUs hold the full amount charged once per year. Packs stay unpublished.
-- Safe to re-run: it only updates existing catalog rows.
update public.products as p
set price_cents = v.price_cents, active = true
from (values
  ('basic-month',          3890000),
  ('standard-month',       5390000),
  ('professional-month',  12190000),
  ('enterprise-month',    21490000),
  ('basic-year',          29690000),
  ('standard-year',       35190000),
  ('professional-year',   72290000),
  ('enterprise-year',    146490000)
) as v(sku, price_cents)
where p.sku = v.sku;
