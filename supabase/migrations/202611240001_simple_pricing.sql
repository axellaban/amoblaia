-- Simplified pricing: «Gratis» + «Comprar créditos» (pago único, sin suscripción).
-- Four credit packs, sold through the existing Checkout Pro flow (Mercado Pago)
-- and credited by the same webhooks and reconciliation as any other pack:
--   10 créditos  $9.900 · 25 créditos $19.900 · 50 créditos $34.900 · 100 créditos $59.900
-- Credits last 365 days, like the packs before them.
--
-- Everything else stops being sold (active = false): monthly and annual plans
-- and the other packs. Nothing is deleted: orders keep their price snapshot,
-- so current subscriptions keep renewing, being reconciled and refunded as
-- today, and every purchase stays in the history. The admin panel can
-- re-activate any product.
--
-- COMMERCIAL CHANGE: apply only once these prices are confirmed.
-- Safe to re-run: the catalog is only written on the first run (before the
-- pack-50 row exists), so a re-run never undoes later changes from the admin panel.
begin;
do $catalog$ begin
 if not exists(select 1 from public.products where sku='pack-50') then
  insert into public.products(sku,name,kind,photos,price_cents,active,valid_days)
  values
    ('pack-10',  '10 créditos',  'pack',  10,  990000, true, 365),
    ('pack-25',  '25 créditos',  'pack',  25, 1990000, true, 365),
    ('pack-50',  '50 créditos',  'pack',  50, 3490000, true, 365),
    ('pack-100', '100 créditos', 'pack', 100, 5990000, true, 365)
  on conflict (sku) do update set
    name = excluded.name, kind = excluded.kind, photos = excluded.photos,
    price_cents = excluded.price_cents, active = true, valid_days = excluded.valid_days,
    per_account_limit = null, promo_price_cents = null, promo_months = null, promo_ends_at = null;

  update public.products set active = false
  where sku not in ('pack-10','pack-25','pack-50','pack-100');
 end if;
end $catalog$;
commit;
