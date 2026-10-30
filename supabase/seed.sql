-- Four FICTIONAL demo pros, their menus (Kitoko's canvas data: services, options, add-ons, deposit and
-- cancellation rules, schedules) and their demo week. Every person, number and e-mail here is made up.
-- Sign-in (local and demo only): <name>@demo.kitoko.page, password kitoko-demo-2026.
-- paypal_email values are the PayPal sandbox business accounts that receive payouts.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('kitoko-demo-2026', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', '', '', '', '', ''
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'nala@demo.kitoko.page'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'kemi@demo.kitoko.page'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'aicha@demo.kitoko.page'),
  ('a0000000-0000-4000-8000-000000000005'::uuid, 'anta@demo.kitoko.page')
) as u(id, email);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select
  u.id, u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  now(), now(), now()
from auth.users u
where u.email like '%@demo.kitoko.page';

-- Kitoko's rules and schedules
with j as (
  select
    $j${
      "deposit": {"mode": "fixed", "cents": 3000},
      "feePayer": "client",
      "reschedule": {"maxCount": 1, "minHoursBefore": 48},
      "cancellation": [{"minHoursBefore": 48, "keepPercent": 0}, {"minHoursBefore": 0, "keepPercent": 100}],
      "lateness": {"graceMinutes": 15, "feeCents": null, "autoCancelAfterMinutes": null},
      "balanceMethods": ["cash", "external"],
      "companionsAllowed": false,
      "extra": []
    }$j$::jsonb as rules,
    $j$[{
      "fr": "Cheveux lavés, démêlés et secs à l'arrivée, sauf option shampoing.",
      "en": "Hair washed, detangled and dry on arrival, unless you add the shampoo option."
    }]$j$::jsonb as braid_extra,
    $j$[{
      "fr": "Cheveux lavés, démêlés et secs à l'arrivée, sauf option shampoing.",
      "en": "Hair washed, detangled and dry on arrival, unless you add the shampoo option.",
      "it": "Capelli lavati, districati e asciutti all'arrivo, salvo opzione shampoo."
    }]$j$::jsonb as braid_extra_it,
    $j${"open": "09:00", "close": "19:00", "breaks": []}$j$::jsonb as day,
    $j${"open": "09:00", "close": "19:00", "breaks": [], "starts": ["09:00", "13:00", "15:30"]}$j$::jsonb as braid_day,
    $j${"open": "09:00", "close": "17:00", "breaks": [], "starts": ["09:00", "13:00"]}$j$::jsonb as braid_sat,
    -- Kitoko's showcase day (anta: Tuesday to Saturday)
    $j${"open": "10:00", "close": "19:00", "breaks": []}$j$::jsonb as showcase_day,
    $j${"kind": "rolling", "days": 60}$j$::jsonb as win
)
insert into public.pros (
  id, handle, name, bio, trades, locale, page_locale, timezone, currency, city, area_label,
  avatar_path, cover_path, gallery, layout, style, theme, title_font,
  rules, schedule, whatsapp_e164, paypal_email, published_at
)
select p.id, p.handle, p.name, p.bio, p.trades, p.locale, p.locale, p.timezone, p.currency, p.city, p.area_label,
       p.avatar, p.cover, p.gallery, p.layout, p.style, p.theme, p.title_font,
       p.rules, p.schedule, p.whatsapp, p.paypal_email, now()
from j
cross join lateral (values
  (
    'a0000000-0000-4000-8000-000000000003'::uuid, 'aicha.braids', 'Aïcha Braids',
    'Knotless, box and Fulani braids in Porta Venezia, by appointment. Trecce protettive senza tensione.',
    array['tresses'], 'it', 'Europe/Rome', 'EUR', 'Milan', 'Milano, Porta Venezia',
    '/photos/box-braids-chignon.jpg', '/photos/portrait-locks-sourire.jpg',
    array['/photos/box-braids-chignon.jpg', '/photos/tresses-pose-sourire.jpg', '/photos/cheveux-naturels-afro.jpg',
          '/photos/cils-tresses-gros-plan.jpg'],
    'bandeau', 'editorial', 'terre', 'fraunces',
    jsonb_set(j.rules, '{extra}', j.braid_extra_it),
    -- open every day, so the demo's cascade day (today + 3) is always a working day
    jsonb_build_object(
      'weekly', jsonb_build_object(
        'mon', j.braid_day, 'tue', j.braid_day, 'wed', j.braid_day, 'thu', j.braid_day, 'fri', j.braid_day,
        'sat', j.braid_sat, 'sun', j.braid_sat
      ),
      'stepMinutes', 30, 'window', j.win
    ),
    '+390000000003', 'kitoko-aicha@business.example.com'
  ),
  (
    'a0000000-0000-4000-8000-000000000001'::uuid, 'studio-nala', 'Studio Nala',
    'Tresses protectrices sans tension et ongles en gel. Studio privé, sur rendez-vous.',
    array['tresses', 'ongles'], 'fr', 'Europe/Paris', 'EUR', 'Lyon', 'Lyon, Croix-Rousse',
    '/photos/portrait-locks-sourire.jpg', '/photos/cheveux-naturels-afro.jpg',
    array['/photos/cheveux-naturels-afro.jpg', '/photos/box-braids-chignon.jpg', '/photos/ongles-ecaille-main.jpg',
          '/photos/locks-nail-art.jpg', '/photos/manucure-main-visage.jpg'],
    'bandeau', 'epure', 'craie', null,
    jsonb_set(j.rules, '{extra}', j.braid_extra),
    jsonb_build_object(
      'weekly', jsonb_build_object(
        'mon', j.day, 'tue', j.day, 'wed', j.day, 'thu', j.day, 'fri', j.day, 'sat', j.day, 'sun', null
      ),
      'stepMinutes', 30, 'window', j.win
    ),
    '+330000000001', 'kitoko-nala@business.example.com'
  ),
  (
    'a0000000-0000-4000-8000-000000000002'::uuid, 'kemi.nails', 'Kemi Nails',
    'Gel extensions and custom nail art in Peckham, London.',
    array['ongles'], 'en', 'Europe/London', 'GBP', 'London', 'London, Peckham',
    '/photos/manucure-main-visage.jpg', '/photos/ongles-ecaille-main.jpg',
    array['/photos/ongles-ecaille-main.jpg', '/photos/locks-nail-art.jpg', '/photos/manucure-main-visage.jpg'],
    'plein', 'doux', 'prune', null,
    j.rules,
    jsonb_build_object(
      'weekly', jsonb_build_object(
        'mon', null, 'tue', j.day, 'wed', j.day, 'thu', j.day, 'fri', j.day, 'sat', j.day, 'sun', null
      ),
      'stepMinutes', 30, 'window', j.win
    ),
    '+440000000002', 'kitoko-kemi@business.example.com'
  ),
  -- Kitoko's showcase pro "anta" moved to Milan: her two services, her week, Aïcha's deposit and cancellation rules.
  -- Only three PayPal sandbox business accounts exist, so no paypal_email: her payouts stay pending.
  (
    'a0000000-0000-4000-8000-000000000005'::uuid, 'anta.tresses', 'Anta Tresses',
    'Knotless braids and cornrows in NoLo, by appointment. Fictional demo pro.',
    array['tresses'], 'it', 'Europe/Rome', 'EUR', 'Milan', 'Milano, NoLo',
    '/photos/box-braids-chignon.jpg', '/photos/cils-tresses-gros-plan.jpg',
    array['/photos/cils-tresses-gros-plan.jpg', '/photos/box-braids-chignon.jpg', '/photos/cheveux-naturels-afro.jpg',
          '/photos/tresses-pose-sourire.jpg'],
    'bandeau', 'heritage', 'cannelle', null,
    j.rules,
    jsonb_build_object(
      'weekly', jsonb_build_object(
        'mon', null, 'tue', j.showcase_day, 'wed', j.showcase_day, 'thu', j.showcase_day, 'fri', j.showcase_day,
        'sat', j.showcase_day, 'sun', null
      ),
      'stepMinutes', 30, 'window', j.win
    ),
    null, null
  )
) as p(
  id, handle, name, bio, trades, locale, timezone, currency, city, area_label, avatar, cover, gallery,
  layout, style, theme, title_font, rules, schedule, whatsapp, paypal_email
);

insert into public.staff (id, pro_id, name, color, position)
values
  ('5a000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001', 'Nala', '#7A3E9D', 0),
  ('5a000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000001', 'Sira', '#C2185B', 1),
  ('5a000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000002', 'Kemi', '#6E2A4A', 0),
  ('5a000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000003', 'Aïcha', '#9E3F1C', 0),
  ('5a000000-0000-4000-8000-000000000051', 'a0000000-0000-4000-8000-000000000005', 'Anta', '#9A4A1E', 0);

insert into public.categories (id, pro_id, name, position)
values
  ('c0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001', 'Tresses', 0),
  ('c0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000001', 'Ongles', 1),
  ('c0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000002', 'Nails', 0),
  ('c0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000003', 'Braids', 0),
  ('c0000000-0000-4000-8000-000000000051', 'a0000000-0000-4000-8000-000000000005', 'Braids', 0);

-- Kitoko's option groups and add-ons (prices and minutes unchanged). Aïcha's copies add Italian labels.
with g as (
  select
    $j${"id": "taille", "label": {"fr": "Taille des tresses", "en": "Braid size"}, "default": "m", "options": [
      {"id": "l", "label": {"fr": "L, épaisses", "en": "L, large"}, "priceCents": 0, "minutes": 0},
      {"id": "m", "label": {"fr": "M, moyennes", "en": "M, medium"}, "priceCents": 2500, "minutes": 90},
      {"id": "s", "label": {"fr": "S, fines", "en": "S, small"}, "priceCents": 5500, "minutes": 180}
    ]}$j$::jsonb as taille_knotless,
    $j${"id": "taille", "label": {"fr": "Taille des tresses", "en": "Braid size"}, "default": "m", "options": [
      {"id": "l", "label": {"fr": "L, épaisses", "en": "L, large"}, "priceCents": 0, "minutes": 0},
      {"id": "m", "label": {"fr": "M, moyennes", "en": "M, medium"}, "priceCents": 2000, "minutes": 75},
      {"id": "s", "label": {"fr": "S, fines", "en": "S, small"}, "priceCents": 4500, "minutes": 165}
    ]}$j$::jsonb as taille_box,
    $j${"id": "longueur", "label": {"fr": "Longueur", "en": "Length"}, "default": "mi-dos", "options": [
      {"id": "epaules", "label": {"fr": "Épaules", "en": "Shoulder length"}, "priceCents": 0, "minutes": 0},
      {"id": "mi-dos", "label": {"fr": "Mi-dos", "en": "Mid-back"}, "priceCents": 2000, "minutes": 45},
      {"id": "taille", "label": {"fr": "Taille", "en": "Waist length"}, "priceCents": 4000, "minutes": 90}
    ]}$j$::jsonb as longueur,
    $j${"id": "meches", "label": {"fr": "Mèches", "en": "Hair"}, "default": "incluses", "options": [
      {"id": "incluses", "label": {"fr": "Mèches incluses", "en": "Hair included"}, "priceCents": 1500, "minutes": 0},
      {"id": "apportees", "label": {"fr": "J'apporte les miennes", "en": "I'll bring my own"}, "priceCents": 0, "minutes": 0}
    ]}$j$::jsonb as meches,
    $j$[
      {"id": "shampoing", "label": {"fr": "Shampoing", "en": "Shampoo"}, "priceCents": 1000, "minutes": 20},
      {"id": "retrait", "label": {"fr": "Retrait ancienne coiffure", "en": "Take-down of the old style"}, "priceCents": 2500, "minutes": 60}
    ]$j$::jsonb as braid_addons,
    $j${"id": "taille", "label": {"fr": "Taille des tresses", "en": "Braid size", "it": "Misura delle trecce"}, "default": "m", "options": [
      {"id": "l", "label": {"fr": "L, épaisses", "en": "L, large", "it": "L, grandi"}, "priceCents": 0, "minutes": 0},
      {"id": "m", "label": {"fr": "M, moyennes", "en": "M, medium", "it": "M, medie"}, "priceCents": 2500, "minutes": 90},
      {"id": "s", "label": {"fr": "S, fines", "en": "S, small", "it": "S, piccole"}, "priceCents": 5500, "minutes": 180}
    ]}$j$::jsonb as it_taille_knotless,
    $j${"id": "taille", "label": {"fr": "Taille des tresses", "en": "Braid size", "it": "Misura delle trecce"}, "default": "m", "options": [
      {"id": "l", "label": {"fr": "L, épaisses", "en": "L, large", "it": "L, grandi"}, "priceCents": 0, "minutes": 0},
      {"id": "m", "label": {"fr": "M, moyennes", "en": "M, medium", "it": "M, medie"}, "priceCents": 2000, "minutes": 75},
      {"id": "s", "label": {"fr": "S, fines", "en": "S, small", "it": "S, piccole"}, "priceCents": 4500, "minutes": 165}
    ]}$j$::jsonb as it_taille_box,
    $j${"id": "longueur", "label": {"fr": "Longueur", "en": "Length", "it": "Lunghezza"}, "default": "mi-dos", "options": [
      {"id": "epaules", "label": {"fr": "Épaules", "en": "Shoulder length", "it": "Alle spalle"}, "priceCents": 0, "minutes": 0},
      {"id": "mi-dos", "label": {"fr": "Mi-dos", "en": "Mid-back", "it": "Metà schiena"}, "priceCents": 2000, "minutes": 45},
      {"id": "taille", "label": {"fr": "Taille", "en": "Waist length", "it": "Alla vita"}, "priceCents": 4000, "minutes": 90}
    ]}$j$::jsonb as it_longueur,
    $j${"id": "meches", "label": {"fr": "Mèches", "en": "Hair", "it": "Extension"}, "default": "incluses", "options": [
      {"id": "incluses", "label": {"fr": "Mèches incluses", "en": "Hair included", "it": "Extension incluse"}, "priceCents": 1500, "minutes": 0},
      {"id": "apportees", "label": {"fr": "J'apporte les miennes", "en": "I'll bring my own", "it": "Porto le mie"}, "priceCents": 0, "minutes": 0}
    ]}$j$::jsonb as it_meches,
    $j$[
      {"id": "shampoing", "label": {"fr": "Shampoing", "en": "Shampoo", "it": "Shampoo"}, "priceCents": 1000, "minutes": 20},
      {"id": "retrait", "label": {"fr": "Retrait ancienne coiffure", "en": "Take-down of the old style", "it": "Rimozione della vecchia acconciatura"}, "priceCents": 2500, "minutes": 60}
    ]$j$::jsonb as it_braid_addons,
    $j${"id": "olong", "label": {"fr": "Longueur", "en": "Length"}, "default": "moyens", "options": [
      {"id": "courts", "label": {"fr": "Courts", "en": "Short"}, "priceCents": 0, "minutes": 0},
      {"id": "moyens", "label": {"fr": "Moyens", "en": "Medium"}, "priceCents": 500, "minutes": 15},
      {"id": "longs", "label": {"fr": "Longs", "en": "Long"}, "priceCents": 1000, "minutes": 30}
    ]}$j$::jsonb as olong,
    $j${"id": "forme", "label": {"fr": "Forme", "en": "Shape"}, "default": "amande", "options": [
      {"id": "amande", "label": {"fr": "Amande", "en": "Almond"}, "priceCents": 0, "minutes": 0},
      {"id": "coffin", "label": {"fr": "Coffin", "en": "Coffin"}, "priceCents": 0, "minutes": 0},
      {"id": "square", "label": {"fr": "Square", "en": "Square"}, "priceCents": 0, "minutes": 0},
      {"id": "stiletto", "label": {"fr": "Stiletto", "en": "Stiletto"}, "priceCents": 500, "minutes": 10}
    ]}$j$::jsonb as forme,
    $j${"id": "art", "label": {"fr": "Nail art", "en": "Nail art"}, "default": "deux", "options": [
      {"id": "sans", "label": {"fr": "Sans", "en": "None"}, "priceCents": 0, "minutes": 0},
      {"id": "deux", "label": {"fr": "2 ongles", "en": "2 nails"}, "priceCents": 600, "minutes": 15},
      {"id": "tous", "label": {"fr": "Tous les ongles", "en": "All nails"}, "priceCents": 2000, "minutes": 45}
    ]}$j$::jsonb as art
)
insert into public.services (
  id, pro_id, category_id, name, description, photos, base_price_cents, base_minutes, option_groups, addons, position
)
select s.id, s.pro_id, s.category_id, s.name, s.description, s.photos, s.price, s.minutes, s.option_groups, s.addons, s.position
from g
cross join lateral (values
  -- Studio Nala: Kitoko's Nala braid menu and Kemi nail menu
  ('b0000000-0000-4000-8000-000000000011'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000011'::uuid,
   'Knotless braids', 'Sans nœud à la racine, zéro tension', array['/photos/tresses-pose-sourire.jpg'], 8500, 240,
   jsonb_build_array(g.taille_knotless, g.longueur, g.meches), g.braid_addons, 0),
  ('b0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000011',
   'Box braids', 'Le classique, tenue de 6 à 8 semaines', array['/photos/box-braids-chignon.jpg'], 7500, 225,
   jsonb_build_array(g.taille_box, g.longueur, g.meches), g.braid_addons, 1),
  ('b0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000011',
   'Fulani braids', 'Nattes devant, tresses derrière', array['/photos/cils-tresses-gros-plan.jpg'], 9000, 270,
   jsonb_build_array(g.longueur, g.meches), g.braid_addons, 2),
  ('b0000000-0000-4000-8000-000000000014', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000011',
   'Nattes collées', 'Sous perruque ou en coiffure', array['/photos/cheveux-naturels-afro.jpg'], 4500, 90,
   '[]'::jsonb, g.braid_addons, 3),
  ('b0000000-0000-4000-8000-000000000015', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000012',
   'Pose capsules gel', null, array['/photos/ongles-ecaille-main.jpg'], 4500, 90,
   jsonb_build_array(g.olong, g.forme, g.art), '[]'::jsonb, 4),
  ('b0000000-0000-4000-8000-000000000016', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000012',
   'Semi-permanent', null, array['/photos/manucure-main-visage.jpg'], 3000, 45,
   jsonb_build_array(g.art), '[]'::jsonb, 5),
  ('b0000000-0000-4000-8000-000000000017', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000012',
   'Remplissage gel', null, array['/photos/locks-nail-art.jpg'], 3500, 75,
   jsonb_build_array(g.olong, g.art), '[]'::jsonb, 6),
  -- Kemi Nails: Kitoko's Kemi nail menu, same numbers in pence
  ('b0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000021',
   'Gel extensions', null, array['/photos/ongles-ecaille-main.jpg'], 4500, 90,
   jsonb_build_array(g.olong, g.forme, g.art), '[]'::jsonb, 0),
  ('b0000000-0000-4000-8000-000000000022', 'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000021',
   'Gel polish', null, array['/photos/manucure-main-visage.jpg'], 3000, 45,
   jsonb_build_array(g.art), '[]'::jsonb, 1),
  ('b0000000-0000-4000-8000-000000000023', 'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000021',
   'Gel infill', null, array['/photos/locks-nail-art.jpg'], 3500, 75,
   jsonb_build_array(g.olong, g.art), '[]'::jsonb, 2),
  -- Aïcha Braids: copies of Kitoko's Nala braid menu
  ('b0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000031',
   'Knotless braids', 'No knot at the root, zero tension', array['/photos/tresses-pose-sourire.jpg'], 8500, 240,
   jsonb_build_array(g.it_taille_knotless, g.it_longueur, g.it_meches), g.it_braid_addons, 0),
  ('b0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000031',
   'Box braids', 'The classic, lasts 6 to 8 weeks', array['/photos/box-braids-chignon.jpg'], 7500, 225,
   jsonb_build_array(g.it_taille_box, g.it_longueur, g.it_meches), g.it_braid_addons, 1),
  ('b0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000031',
   'Fulani braids', 'Cornrows at the front, braids at the back', array['/photos/cils-tresses-gros-plan.jpg'], 9000, 270,
   jsonb_build_array(g.it_longueur, g.it_meches), g.it_braid_addons, 2),
  ('b0000000-0000-4000-8000-000000000034', 'a0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000031',
   'Cornrows', 'Under a wig or as a style', array['/photos/cheveux-naturels-afro.jpg'], 4500, 90,
   '[]'::jsonb, g.it_braid_addons, 3),
  -- Anta Tresses: Kitoko's showcase anta menu (no options, no add-ons; "Nattes collées" named Cornrows here)
  ('b0000000-0000-4000-8000-000000000051', 'a0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000051',
   'Knotless braids', 'No knot at the root', array['/photos/cils-tresses-gros-plan.jpg'], 8000, 240,
   '[]'::jsonb, '[]'::jsonb, 0),
  ('b0000000-0000-4000-8000-000000000052', 'a0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000051',
   'Cornrows', null, array['/photos/cheveux-naturels-afro.jpg'], 4000, 90,
   '[]'::jsonb, '[]'::jsonb, 1)
) as s(id, pro_id, category_id, name, description, photos, price, minutes, option_groups, addons, position);

-- Studio Nala: braids by Nala, nails by Sira. Solo pros: every service by their one staff member.
insert into public.service_staff (pro_id, service_id, staff_id)
select s.pro_id, s.id,
       case
         when s.pro_id = 'a0000000-0000-4000-8000-000000000001' and s.category_id = 'c0000000-0000-4000-8000-000000000011'
           then '5a000000-0000-4000-8000-000000000011'::uuid
         when s.pro_id = 'a0000000-0000-4000-8000-000000000001' then '5a000000-0000-4000-8000-000000000012'::uuid
         when s.pro_id = 'a0000000-0000-4000-8000-000000000002' then '5a000000-0000-4000-8000-000000000021'::uuid
         when s.pro_id = 'a0000000-0000-4000-8000-000000000005' then '5a000000-0000-4000-8000-000000000051'::uuid
         else '5a000000-0000-4000-8000-000000000031'::uuid
       end
from public.services s;

-- The demo week (reset_demo builds it relative to today). Fictional clients and numbers.
insert into private.demo_bookings (
  pro_id, key, day_offset, start_time, service_id, staff_id, options, addons, status, paid, source,
  client_first_name, client_phone, locale, conversation_token, chat
)
values
  -- Aïcha (the demo star): one staff member, open every day
  ('a0000000-0000-4000-8000-000000000003', 'done-yesterday', -1, '09:00', 'b0000000-0000-4000-8000-000000000032',
   '5a000000-0000-4000-8000-000000000031', '{"taille": "l", "longueur": "epaules"}', '{}', 'honoured', true, 'web',
   'Martina', '+393450000011', 'it', null, null),
  ('a0000000-0000-4000-8000-000000000003', 'today', 0, '13:00', 'b0000000-0000-4000-8000-000000000034',
   '5a000000-0000-4000-8000-000000000031', '{}', '{}', 'confirmed', true, 'web',
   'Aminata', '+393450000012', 'it', null, null),
  ('a0000000-0000-4000-8000-000000000003', 'day1-knotless', 1, '09:00', 'b0000000-0000-4000-8000-000000000031',
   '5a000000-0000-4000-8000-000000000031', '{"taille": "m", "longueur": "mi-dos"}', '{}', 'confirmed', true, 'whatsapp',
   'Sofia', '+393450000013', 'it', null, null),
  ('a0000000-0000-4000-8000-000000000003', 'day1-held', 1, '15:30', 'b0000000-0000-4000-8000-000000000034',
   '5a000000-0000-4000-8000-000000000031', '{}', '{}', 'held', false, 'web',
   null, null, 'it', null, null),
  ('a0000000-0000-4000-8000-000000000003', 'day2-cornrows', 2, '09:00', 'b0000000-0000-4000-8000-000000000034',
   '5a000000-0000-4000-8000-000000000031', '{}', '{shampoing}', 'confirmed', true, 'web',
   'Chiara', '+393450000014', 'it', null, null),
  ('a0000000-0000-4000-8000-000000000003', 'day2-cancelled', 2, '13:00', 'b0000000-0000-4000-8000-000000000033',
   '5a000000-0000-4000-8000-000000000031', '{"longueur": "epaules"}', '{}', 'cancelled', true, 'web',
   'Ama', '+393450000015', 'en', null, null),
  ('a0000000-0000-4000-8000-000000000003', 'cascade-1', 3, '09:00', 'b0000000-0000-4000-8000-000000000032',
   '5a000000-0000-4000-8000-000000000031', '{"taille": "l", "longueur": "epaules", "meches": "apportees"}', '{}',
   'confirmed', true, 'web', 'Giulia', '+393450000016', 'it', 'demo-aicha-client-1',
   $j$[{"role": "user", "text": "Ciao! Vorrei delle box braids, misura L, alle spalle. Porto io le extension."},
       {"role": "assistant", "text": "Perfetto {name}! Prenotazione confermata per il {date} alle {time}, acconto ricevuto. Codice: {ref}."}]$j$),
  ('a0000000-0000-4000-8000-000000000003', 'cascade-2', 3, '13:00', 'b0000000-0000-4000-8000-000000000034',
   '5a000000-0000-4000-8000-000000000031', '{}', '{}', 'confirmed', true, 'web',
   'Grace', '+393450000017', 'en', 'demo-aicha-client-2',
   $j$[{"role": "user", "text": "Hi! Can I book cornrows this week?"},
       {"role": "assistant", "text": "You're all set, {name}: cornrows on {date} at {time}, deposit received. Booking ref {ref}."}]$j$),
  ('a0000000-0000-4000-8000-000000000003', 'cascade-3', 3, '15:30', 'b0000000-0000-4000-8000-000000000034',
   '5a000000-0000-4000-8000-000000000031', '{}', '{shampoing}', 'confirmed', true, 'web',
   'Fatou', '+393450000018', 'fr', 'demo-aicha-client-3',
   $j$[{"role": "user", "text": "Bonjour, je voudrais des nattes collées avec shampoing."},
       {"role": "assistant", "text": "C'est réservé, {name} : le {date} à {time}, acompte reçu. Référence {ref}."}]$j$),
  ('a0000000-0000-4000-8000-000000000003', 'day4-fulani', 4, '09:00', 'b0000000-0000-4000-8000-000000000033',
   '5a000000-0000-4000-8000-000000000031', '{"longueur": "epaules"}', '{}', 'confirmed', true, 'mcp',
   'Elena', '+393450000019', 'it', null, null),
  ('a0000000-0000-4000-8000-000000000003', 'day5-knotless', 5, '13:00', 'b0000000-0000-4000-8000-000000000031',
   '5a000000-0000-4000-8000-000000000031', '{"taille": "l", "longueur": "epaules"}', '{}', 'confirmed', true, 'web',
   'Nadia', '+393450000020', 'it', null, null),
  -- Studio Nala: bookings on both staff members (same hour on day 1)
  ('a0000000-0000-4000-8000-000000000001', 'nala-day1', 1, '10:00', 'b0000000-0000-4000-8000-000000000011',
   '5a000000-0000-4000-8000-000000000011', '{"taille": "l", "longueur": "epaules", "meches": "apportees"}', '{}',
   'confirmed', true, 'web', 'Awa', '+33600000101', 'fr', null, null),
  ('a0000000-0000-4000-8000-000000000001', 'sira-day1', 1, '10:00', 'b0000000-0000-4000-8000-000000000015',
   '5a000000-0000-4000-8000-000000000012', '{}', '{}', 'confirmed', true, 'web',
   'Inès', '+33600000102', 'fr', null, null),
  ('a0000000-0000-4000-8000-000000000001', 'sira-day2', 2, '14:00', 'b0000000-0000-4000-8000-000000000016',
   '5a000000-0000-4000-8000-000000000012', '{}', '{}', 'confirmed', true, 'whatsapp',
   'Mariam', '+33600000103', 'fr', null, null),
  ('a0000000-0000-4000-8000-000000000001', 'nala-day4', 4, '15:00', 'b0000000-0000-4000-8000-000000000014',
   '5a000000-0000-4000-8000-000000000011', '{}', '{}', 'confirmed', true, 'web',
   'Kadiatou', '+33600000104', 'fr', null, null),
  -- Kemi: closed Sunday and Monday (closed days move to the next open one; the times never overlap)
  ('a0000000-0000-4000-8000-000000000002', 'kemi-day1', 1, '11:00', 'b0000000-0000-4000-8000-000000000021',
   '5a000000-0000-4000-8000-000000000021', '{}', '{}', 'confirmed', true, 'web',
   'Tolu', '+447700900101', 'en', null, null),
  ('a0000000-0000-4000-8000-000000000002', 'kemi-day3', 3, '14:00', 'b0000000-0000-4000-8000-000000000022',
   '5a000000-0000-4000-8000-000000000021', '{}', '{}', 'confirmed', true, 'whatsapp',
   'Chioma', '+447700900102', 'en', null, null),
  ('a0000000-0000-4000-8000-000000000002', 'kemi-day5', 5, '16:00', 'b0000000-0000-4000-8000-000000000023',
   '5a000000-0000-4000-8000-000000000021', '{}', '{}', 'confirmed', true, 'mcp',
   'Zara', '+447700900103', 'en', null, null),
  -- Anta: closed Sunday and Monday. A light week: yesterday done (payout pending: no PayPal e-mail), three to come.
  ('a0000000-0000-4000-8000-000000000005', 'anta-yesterday', -1, '11:00', 'b0000000-0000-4000-8000-000000000052',
   '5a000000-0000-4000-8000-000000000051', '{}', '{}', 'honoured', true, 'web',
   'Rokia', '+393450000031', 'it', null, null),
  ('a0000000-0000-4000-8000-000000000005', 'anta-day1', 1, '10:00', 'b0000000-0000-4000-8000-000000000051',
   '5a000000-0000-4000-8000-000000000051', '{}', '{}', 'confirmed', true, 'web',
   'Giorgia', '+393450000032', 'it', null, null),
  ('a0000000-0000-4000-8000-000000000005', 'anta-day2', 2, '14:30', 'b0000000-0000-4000-8000-000000000052',
   '5a000000-0000-4000-8000-000000000051', '{}', '{}', 'confirmed', true, 'whatsapp',
   'Bintou', '+393450000033', 'fr', null, null),
  ('a0000000-0000-4000-8000-000000000005', 'anta-day4', 4, '16:30', 'b0000000-0000-4000-8000-000000000052',
   '5a000000-0000-4000-8000-000000000051', '{}', '{}', 'confirmed', true, 'mcp',
   'Lucia', '+393450000034', 'it', null, null);

-- Martina (yesterday's client) has an e-mail, so the assistant's "balance invoice to my last client" works after a reset.
update private.demo_bookings set client_email = 'martina@example.com'
where pro_id = 'a0000000-0000-4000-8000-000000000003' and key = 'done-yesterday';

select public.reset_demo(id) from public.pros order by handle;
