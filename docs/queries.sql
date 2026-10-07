-- name: volumes
SELECT kind, count(*) events FROM events GROUP BY kind;

-- name: audit
SELECT json_extract(payload,'$.status') status,count(*) records FROM audit GROUP BY status;

-- name: quality_issues
SELECT issue.value issue, count(*) records
FROM audit, json_each(audit.payload,'$.issues') issue
GROUP BY issue.value;

-- name: time_range
SELECT min(ts) first_utc,max(ts) last_utc,min(local_ts) first_paris,max(local_ts) last_paris FROM events;

-- name: daily_counts
SELECT substr(local_ts,1,10) day,kind,count(*) events FROM events GROUP BY day,kind ORDER BY day,kind;

-- name: schema_rtt
SELECT version,count(*) reports,
 sum(json_extract(payload,'$.report.rttMs') IS NULL) missing_root_rtt,
 sum(json_extract(payload,'$.report.network.rttMs') IS NULL) missing_nested_rtt,
 sum(rtt_ms IS NULL) missing_normalized_rtt
FROM reports GROUP BY version;

-- name: gpu_missing
SELECT json_extract(payload,'$.report.graphics.gpuTimerSupported') supported,
 sum(json_extract(payload,'$.report.graphics.gpuRenderMs') IS NULL) missing,
 count(*) reports FROM reports GROUP BY supported;

-- name: causes
SELECT cause,count(*) reports,count(DISTINCT client) clients,min(local_ts) first_paris,max(local_ts) last_paris
FROM reports GROUP BY cause ORDER BY reports DESC;

-- name: build_cohorts
SELECT build, (width>=2560 AND bloom=1) high_resolution_bloom, count(*) reports,
 sum(cause='overlay') overlay,round(100.0*sum(cause='overlay')/count(*),2) overlay_pct
FROM reports WHERE cause!='invalid' GROUP BY build, high_resolution_bloom ORDER BY build, high_resolution_bloom;

-- name: overlay_timeline
SELECT build,min(local_ts) first_paris,max(local_ts) last_paris,count(*) reports
FROM reports WHERE cause='overlay' GROUP BY build ORDER BY first_paris;

-- name: overlay_population
SELECT browser,count(*) reports,count(DISTINCT client) client_ids,
 round(avg(frame_ms),1) avg_frame_ms,round(avg(overlay_ms),1) avg_overlay_ms,
 round(avg(rtt_ms),1) avg_rtt_ms,round(avg(tick_gap_ms),1) avg_tick_gap_ms
FROM reports WHERE cause='overlay' AND width>=2560 AND bloom=1 GROUP BY browser;

-- name: overlay_evidence
SELECT id,local_ts,build,width,bloom,frame_ms,overlay_ms,rtt_ms,tick_gap_ms,source_line
FROM reports WHERE cause='overlay' AND build='beta-20260924-3' AND width>=2560 AND bloom=1 ORDER BY ts LIMIT 5;

-- name: invalid_clients
SELECT client,count(*) reports,count(DISTINCT server) server_ids,min(local_ts) first_paris,max(local_ts) last_paris,
 min(json_extract(payload,'$.report.work.stages.render')) min_render_ms,
 max(json_extract(payload,'$.report.fps')) max_fps
FROM reports WHERE cause='invalid' GROUP BY client;

-- name: short_wins
SELECT substr(local_ts,1,10) day,map,count(*) games,min(duration_s) min_s,max(duration_s) max_s,
 sum(quarantined) quarantined,min(local_ts) first_paris,max(local_ts) last_paris
FROM games WHERE short_win=1 GROUP BY day,map;

-- name: short_win_clients
SELECT r.client,count(*) reports,count(DISTINCT r.server) linked_games FROM reports r
JOIN games g ON r.server=g.id WHERE g.short_win=1 GROUP BY r.client;

-- name: bots
SELECT substr(g.local_ts,1,10) day,count(DISTINCT g.id) games,count(*) reports,count(DISTINCT r.client) clients,
 min(g.duration_s) min_game_s,max(g.duration_s) max_game_s,
 min(r.bot_age_ms) min_bot_age_ms,max(r.bot_age_ms) max_bot_age_ms,
 sum(r.cause='world') world_reports
FROM reports r JOIN games g ON r.server=g.id WHERE r.bot_stale>=2 AND r.bot_age_ms>=1000 GROUP BY day;

-- name: bot_comparison
SELECT (bot_stale>=2 AND bot_age_ms>=1000) stale_bots,count(*) reports,
 min(bot_age_ms) min_age_ms,max(bot_age_ms) max_age_ms, count(DISTINCT client) clients
FROM reports GROUP BY stale_bots;

-- name: server_degradation
SELECT substr(local_ts,1,13) hour_paris,count(*) reports,round(min(tick_gap_ms),1) min_gap_ms,
 round(max(tick_gap_ms),1) max_gap_ms,round(avg(rtt_ms),1) avg_rtt_ms
FROM reports WHERE cause!='invalid' AND tick_gap_ms>=150 GROUP BY hour_paris;

-- name: largest_gaps
WITH ordered AS (SELECT ts,local_ts,lag(ts) OVER(ORDER BY ts) previous,
 lag(local_ts) OVER(ORDER BY ts) previous_paris FROM events)
SELECT previous_paris,local_ts,round((julianday(ts)-julianday(previous))*86400) seconds
FROM ordered WHERE previous IS NOT NULL ORDER BY seconds DESC LIMIT 10;

-- name: missing_completions
SELECT r.cause,count(*) reports,count(DISTINCT r.server) server_ids
FROM reports r LEFT JOIN games g ON r.server=g.id WHERE g.id IS NULL GROUP BY r.cause;

-- name: export_order
WITH ordered AS (SELECT source_line,local_ts,ts,
 lag(source_line) OVER(ORDER BY source_line) previous_line,
 lag(ts) OVER(ORDER BY source_line) previous_ts FROM events)
SELECT previous_line,source_line,local_ts,round((julianday(ts)-julianday(previous_ts))*86400) inversion_seconds
FROM ordered WHERE ts>previous_ts ORDER BY source_line;

-- name: v2_stage_difference
SELECT version,count(*) reports,
 round(min((SELECT sum(value) FROM json_each(r.payload,'$.report.work.stages'))-json_extract(r.payload,'$.report.work.totalMs')),2) min_difference_ms,
 round(max((SELECT sum(value) FROM json_each(r.payload,'$.report.work.stages'))-json_extract(r.payload,'$.report.work.totalMs')),2) max_difference_ms
FROM reports r WHERE cause!='invalid' GROUP BY version;

-- name: overlay_context
WITH source AS (
 SELECT overlay_ms,rtt_ms,
 100.0*overlay_ms/json_extract(payload,'$.report.work.totalMs') cpu_share,
 json_extract(payload,'$.report.graphics.gpuRenderMs') gpu_ms,
 json_extract(payload,'$.report.graphics.gpuSampleAgeMs') gpu_age_ms,
 row_number() OVER(ORDER BY overlay_ms) rn_overlay,
 row_number() OVER(ORDER BY rtt_ms) rn_rtt,
 row_number() OVER(ORDER BY 100.0*overlay_ms/json_extract(payload,'$.report.work.totalMs')) rn_share,
 count(*) OVER() n
 FROM reports WHERE cause='overlay' AND width>=2560 AND bloom=1
)
SELECT count(*) reports,
 round(avg(CASE WHEN rn_overlay IN ((n+1)/2,(n+2)/2) THEN overlay_ms END),2) median_overlay_ms,
 round(avg(CASE WHEN rn_rtt IN ((n+1)/2,(n+2)/2) THEN rtt_ms END),2) median_rtt_ms,
 round(avg(CASE WHEN rn_share IN ((n+1)/2,(n+2)/2) THEN cpu_share END),2) median_cpu_share_pct,
 count(gpu_ms) gpu_samples,min(gpu_age_ms) min_gpu_sample_age_ms,max(gpu_age_ms) max_gpu_sample_age_ms
FROM source;

-- name: build_first_valid
SELECT build,min(local_ts) first_paris,count(*) reports FROM reports WHERE cause!='invalid' GROUP BY build;

-- name: invariants
SELECT 'report_before_creation' check_name,count(*) violations FROM reports
WHERE unixepoch(ts)*1000 < json_extract(payload,'$.server.createdAt')
UNION ALL
SELECT 'report_after_completion',count(*) FROM reports r JOIN games g ON r.server=g.id WHERE r.ts>g.ts
UNION ALL
SELECT 'header_id_mismatch',count(*) FROM events WHERE json_extract(payload,'$.headerId')!=json_extract(payload,'$.serverId');
