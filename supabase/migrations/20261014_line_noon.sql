-- LINE 中午訂單提醒：每天台灣時間 12:00 打 line 函式的 op=tick。
-- cron_key 只存在 line_cfg（資料庫裡），網頁拿不到，所以外人不能觸發推播。
create extension if not exists pg_cron;
insert into public.line_cfg (k, v, updated_at)
  values ('cron_key', encode(extensions.gen_random_bytes(24), 'hex'), now())
  on conflict (k) do nothing;
select cron.unschedule('smoked-line-noon') where exists (select 1 from cron.job where jobname = 'smoked-line-noon');
select cron.schedule('smoked-line-noon', '0 4 * * *', $$
  select net.http_post(
    url := 'https://fodibhcjitnrgpvqttky.supabase.co/functions/v1/line',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object('op', 'tick', 'key', (select v from public.line_cfg where k = 'cron_key')),
    timeout_milliseconds := 20000);
$$);
