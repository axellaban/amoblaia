-- «Demo creada, sin enviar»: the product situation of «Interesado» once its demo exists.
-- It was the only Interesado step without one, so it could not be chosen in any selector.
insert into public.followup_state_catalog(key,label,commercial_stage,source,product_stage,active,description)
values ('custom_demo_creada_sin_enviar','Demo creada, sin enviar','interesado','product','sin-enviar',true,
        'Su demo está publicada y todavía no se la mandamos.')
on conflict (key) do nothing;
