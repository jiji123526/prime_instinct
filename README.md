# Prime Instinct

**Real-time agent that reads live in-play betting odds to flag extraordinary sports moments before they trend, emitting an interrupt/don't notification decision for Prime Video.**

---

## The problem

Prime Video's recommendation system is backward-looking: it predicts what you'll watch from what you've already watched. It is blind to events that are extraordinary but have no behavioral history, the classic cold-start problem.

During the 2026 World Cup, a tiny nation making a historic run had no watch history, so the system had no basis to surface it until *after* it trended, by which point the match was over.

**Prime Instinct closes the timing gap.** Trending eventually surfaces extraordinary events; the value this agent adds is catching them *while they're still unfolding*, so viewers can watch it happen instead of catching the highlight after everyone else.

## How it works

Betting markets are a real-time, crowd-sourced probability sensor. When something extraordinary happens, the odds move within seconds, faster than trending or social signals. The agent watches that movement and, when the market signals a moment worth interrupting for, emits a scored, ready-to-send notification decision.

```
External feeds                 This agent                           Downstream
───────────────                ──────────                           ──────────
odds stream (WebSocket)  ──▶  ingest ─ store ─ gate ─ score ─ decide  ──▶  Prime Video
                              (emits a notify/don't decision + payload)    notification pipeline
```

Deterministic signal math lives in the data layer (cheap, auditable, always-on). The LLM judgment runs **only** on the moments that pass the gate.

## Signals

The prototype reads three signals from a single odds feed:

| Signal | What it measures |
|---|---|
| **Improbability** | How unlikely the current outcome is (longshot = high) |
| **Velocity** | How fast the odds are moving (sudden swing = something just happened) |
| **Volume anomaly** | Betting volume vs. baseline (a dormant market lighting up = people care) |

A fourth signal, **reverse line movement** (odds moving against the public, i.e. informed "smart" money), is the strongest signal conceptually but needs a second betting-splits feed. Splits coverage is sport-dependent (available for soccer, football, basketball, etc.; not for F1), so RLM is deferred until a splits feed is confirmed for the target sport.

## Scope (v1)

- Emits a **binary** decision: `INTERRUPT` / `DON'T`, plus a confidence score.
- Reads the **event, not the viewer**, there is no viewer profiling.
- Prime Video's existing notification pipeline handles delivery and audience targeting; this agent does not own device delivery.

## Components

| # | Component | Responsibility |
|---|---|---|
| 1 | **Ingestion** | Hold the stream open + reconciliation poll; lose nothing, duplicate nothing |
| 2 | **Store + derived columns** | Persist every tick with timestamp; compute deterministic signal columns |
| 3 | **Threshold gate** | Cheap filter: wake the agent only when a derived column crosses a bound |
| 4 | **LLM scoring** | Judge how extraordinary the moment is, with reasoning |
| 5 | **Decision** | Convert score to an action via a cost-based threshold |
| 6 | **Delivery** | Package the decision and hand it to Prime Video's pipeline |

## Data contracts

**Input: odds tick** (from the stream)
```json
{ "match_id": "cv_arg_r32", "ts": "2026-06-10T14:32:07Z",
  "market": "h2h",
  "outcomes": [ {"name": "Argentina", "decimal": 1.60},
                {"name": "Cape Verde", "decimal": 2.40} ],
  "traded_volume": 24500.0 }
```

**Output: notification decision** (what the pipeline consumes)
```json
{ "match_id": "cv_arg_r32", "decision": "INTERRUPT",
  "score": 8.4, "confidence": 0.86,
  "signals_fired": ["improbability", "velocity"],
  "reasoning": "Longshot (pop. 525K) collapsed Argentina's win odds mid-match; velocity in top percentile.",
  "headline_hint": "Smallest nation in World Cup history is beating the champions, live now",
  "ts": "2026-06-10T14:32:08Z" }
```

## Evaluation

The output is a **label + confidence score**, not free text, so grading is classifier-style (exact match in code), not LLM-as-judge. The hard part is getting ground truth at all: "extraordinary" is subjective and only resolves after the match. Evaluation runs on a three-rung ladder, cheapest first:

1. **Verification (code, now)** — unit tests prove the signal math is correct on synthetic inputs. Status: `test_signals.py` 10/10 passing. Verified, not yet validated against real outcomes.
2. **Outcome-proxy metrics (offline)** — backtest the 2026 World Cup; label an event `INTERRUPT`-worthy if the improbable thing actually happened. Measure accuracy, precision, recall, F1, confusion matrix. **Headline metric: precision on `INTERRUPT`.**
3. **Engagement (online, the real target)** — whether viewers who got the nudge actually engaged. Unavailable offline.

Calibration (Expected Calibration Error, Brier score) sits across layers 2 and 3, a calibrated confidence is what licenses unattended sends.

## Decision layer

v1 uses two actions, not a graded set of tiers (every extra tier is another threshold to justify and calibrate).

```
calibrated score ──▶  score > threshold T ?
                           │
                     yes ──┴── no
                      │         │
                 INTERRUPT    DON'T
```

`T` is set by **cost, not assertion**: cost of a miss (viewer never discovers the moment) vs. cost of a false alarm (interrupted for a routine match, erodes trust). It sits where those balance, measured on the backtest. The decision is a function, so a future "surface quietly" middle tier is a second threshold, not a rewrite.

## Failure modes

For a live notification, **late is worse than never.** Every external dependency can fail; for each we retry / degrade / drop.

| Failure | Mitigation |
|---|---|
| Odds feed drops mid-match | Reconciliation poll + replay cursor; second provider as fallback |
| Duplicate messages | Idempotency key `(match_id, signal_type, time_bucket)`; dedup before emit |
| Out-of-order messages | Keep message timestamp; ignore anything older than current state |
| LLM latency spike | Hard timeout; if it misses the live window, drop rather than emit late |
| Bad / hallucinated score | Deterministic gate pre-filter + eval harness; reason only from provided signals |
| Training-serving skew | Single shared computation path for derived columns in backtest and live |

## Roadmap

- **v1 (POC)** — one sport/event; improbability + velocity + volume; binary interrupt/don't; offline backtest as the eval; emit to a mock pipeline.
- **v2** — add reverse line movement (needs a splits feed); calibration-gated autonomy; passive "surface quietly" tier; live online eval loop.
- **Later** — extend the sport-agnostic framework to additional sports as data allows.

## Status

Design-for-critique. Tech picks (odds provider, time-series store, threshold `T`, autonomy level) are presented as open decisions to challenge, not settled choices. Signal math is verified; outcome-proxy and engagement validation are pending.
