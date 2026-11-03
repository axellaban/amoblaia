-- Credits without a subscription and lower plan prices on one curve.
-- Credits: $5.990 each at 5, down to $900 each from 250 on, sold as packs
-- (one SKU per slider stop) through the existing Checkout Pro flow; they last
-- 365 days. Each monthly plan costs 25% less per photo than credits at its
-- volume; annual plans keep today's discount over twelve monthly charges.
-- pack-10 (created inactive in 202610200001) becomes the 10-credit stop;
-- pack-25 stays inactive. pack-first is untouched.
-- Existing orders keep their price snapshot: current subscribers keep paying
-- what they signed up for until they change plan.
-- Safe to re-run: the catalog is only written on the first run (before the
-- pack-500 row exists), so a re-run never restores prices changed from the
-- admin panel or republishes a pack taken down.
begin;
do $catalog$ begin
 if not exists(select 1 from public.products where sku='pack-500') then
  update public.products as p
  set price_cents = v.price_cents, active = true
  from (values
    ('basic-month',          2590000),
    ('standard-month',       4890000),
    ('professional-month',   8690000),
    ('enterprise-month',    13790000),
    ('basic-year',          19790000),
    ('standard-year',       31890000),
    ('professional-year',   51490000),
    ('enterprise-year',     93990000)
  ) as v(sku, price_cents)
  where p.sku = v.sku;

  insert into public.products(sku,name,kind,photos,price_cents,active,valid_days)
  values
    ('pack-5',  '5 créditos',  'pack',   5,  2995000, true, 365),
    ('pack-10', '10 créditos', 'pack',  10,  4290000, true, 365),
    ('pack-20', '20 créditos', 'pack',  20,  6180000, true, 365),
    ('pack-40', '40 créditos', 'pack',  40,  8760000, true, 365),
    ('pack-60', '60 créditos', 'pack',  60, 10740000, true, 365),
    ('pack-100','100 créditos','pack', 100, 13900000, true, 365),
    ('pack-150','150 créditos','pack', 150, 17250000, true, 365),
    ('pack-250','250 créditos','pack', 250, 22500000, true, 365),
    ('pack-500','500 créditos','pack', 500, 45000000, true, 365)
  on conflict (sku) do update set
    name = excluded.name, photos = excluded.photos, price_cents = excluded.price_cents,
    active = excluded.active, valid_days = excluded.valid_days;
 end if;
end $catalog$;
commit;
