-- LINE 早市訂單提醒：每天台灣時間凌晨 3:00（UTC 19:00）打 line 函式的 op=tick, slot=early，只提醒早市的訂單。
select cron.unschedule('smoked-line-early') where exists (select 1 from cron.job where jobname = 'smoked-line-early');
select cron.schedule('smoked-line-early', '0 19 * * *', $$
  select net.http_post(
    url := 'https://fodibhcjitnrgpvqttky.supabase.co/functions/v1/line',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object('op', 'tick', 'slot', 'early', 'key', (select v from public.line_cfg where k = 'cron_key')),
    timeout_milliseconds := 20000);
$$);
