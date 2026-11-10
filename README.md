# Prime Instinct

**Real-time agent that reads live in-play betting odds to flag extraordinary sports moments before they trend, emitting an interrupt/don't notification decision for Prime Video.**

---

## The problem

Prime Video's recommendation system is backward-looking: it predicts what you'll watch from what you've already watched. It is blind to events that are extraordinary but have no behavioral history, the classic cold-start problem.

During the 2026 World Cup, a tiny nation making a historic run had no watch history, so the system had no basis to surface it until *after* it trended, by which point the match was over.

**Prime Instinct closes the timing gap.** Trending eventually surfaces extraordinary events; the value this agent adds is catching them *while they're still unfolding*, so viewers can watch it happen instead of catching the highlight after everyone else.

## How it works

Betting markets are a real-time, crowd-sourced probability sensor. When something extraordinary happens, the odds move within seconds, faster than trending or social signals. The agent watches that movement with **deterministic, rule-based scoring**, and when the market signals a moment worth interrupting for, emits a scored, ready-to-send notification decision.

```
External feeds                 This agent                           Downstream
───────────────                ──────────                           ──────────
odds stream (WebSocket)  ──▶  ingest ─ store ─ gate ─ score ─ decide ─ copy  ──▶  Prime Video
                              (rule-based decision)       (LLM)          notification pipeline
```

The scoring path is **entirely rule-based**: deterministic signal math in the data layer, a cost-based threshold at the decision step. No LLM sits in the notify/don't decision, keeping it cheap, auditable, always-on, and free of judge bias or hallucination.

The LLM is **not** part of the scoring decision. It has two language-only jobs: after the rule-based decision is made, it turns the grounded decision record into notification copy before delivery; after a user interacts with that notification, it generates an on-demand explanation of *why* the moment matters (see [LLM language layer](#llm-language-layer)).

## Signals

The prototype reads three signals from a single odds feed:

| Signal | What it measures |
|---|---|
| **Improbability** | How unlikely the current outcome is (longshot = high) |
| **Velocity** | How fast the odds are moving (sudden swing = something just happened) |
| **Volume anomaly** | Betting volume vs. baseline (a dormant market lighting up = people care) |

A fourth signal, **reverse line movement** (odds moving against the public, i.e. informed "smart" money), is the strongest signal conceptually but needs a second betting-splits feed. Splits coverage is sport-dependent (available for soccer, football, basketball, etc.; not for F1), so RLM is deferred until a splits feed is confirmed for the target sport.

## Scoring: how signals become a score

Scoring is a **deterministic function of the signals**, not a learned or LLM judgment. The moment is measured primarily by **velocity** (the "something is happening now" signal), weighted by **improbability** (how big a deal it is) and **volume** (how much the market cares). The result is a single calibrated score. Because the math is fixed and inspectable, every notification can be traced back to the exact signal values that produced it.

## Scope (v1)

- Scoring and decision are **100% rule-based** — no LLM in the notify/don't path.
- Emits a **binary** decision: `INTERRUPT` / `DON'T`, plus a confidence score.
- For `INTERRUPT`, an LLM generates the pre-send notification copy from the structured decision record.
- Reads the **event, not the viewer**, there is no viewer profiling.
- Prime Video's existing notification pipeline handles delivery and audience targeting; this agent does not own device delivery.

## Components

| # | Component | Responsibility |
|---|---|---|
| 1 | **Ingestion** | Hold the stream open + reconciliation poll; lose nothing, duplicate nothing |
| 2 | **Store + derived columns** | Persist every tick with timestamp; compute deterministic signal columns |
| 3 | **Threshold gate** | Cheap filter: wake the scorer only when a derived column crosses a bound |
| 4 | **Rule-based scoring** | Combine signals into a calibrated score via a fixed, deterministic formula |
| 5 | **Decision** | Convert score to an action via a cost-based threshold |
| 6 | **Delivery copy (LLM)** | Turn an `INTERRUPT` decision record into grounded, human-readable notification copy, then hand it to Prime Video's pipeline |
| 7 | **On-demand context (LLM)** | Generate relevant context once a user engages with a notification |

## Project structure

```text
demo/       Browser demo and its styles/scripts
analysis/   Signal prototypes, backtest, and tests
docs/       Technical review and design notes
public/     Demo images and icons
```

## LLM language layer

The LLM's job is **language and enrichment, not decision-making**. It is invoked only after Prime Instinct has already made an `INTERRUPT` decision on rule-based grounds.

Before delivery, it converts the structured decision record into concise notification copy. The generation is grounded in the supplied teams, current state, signal values, and verified historical context; it must not introduce unsupported facts. If generation exceeds the live window or fails validation, the system drops the generated copy or falls back to a deterministic template rather than delaying the scoring decision.

After a viewer taps the notification, the same language layer can provide relevant, timely context to help the viewer understand what they're tapping into, for example:

- *Why this matters:* a plain-language explanation of the upset in progress ("the smallest nation ever to reach the knockout stage is leading the defending champions").
- *Who / what to know:* background on the teams, players, or stakes relevant to the live moment.
- *What to watch for next:* the situation as it stands and what could happen if the run continues.

The scoring decision remains deterministic in both cases. LLM latency can affect whether custom copy is ready in time for delivery, but it cannot change the numeric score or the `INTERRUPT` / `DON'T` result. Post-interaction generation is lower-stakes and runs only on demand.

## Data contracts

**Input: odds tick** (from the stream)
```json
{ "match_id": "cv_arg_r32", "ts": "2026-06-10T14:32:07Z",
  "market": "h2h",
  "outcomes": [ {"name": "Argentina", "decimal": 1.60},
                {"name": "Cape Verde", "decimal": 2.40} ],
  "traded_volume": 24500.0 }
```

**Output: notification decision** (produced by the rule-based scorer and consumed by the copy/delivery layer)
```json
{ "match_id": "cv_arg_r32", "decision": "INTERRUPT",
  "score": 8.4, "confidence": 0.86,
  "signals_fired": ["improbability", "velocity"],
  "signal_values": {"improbability": 7.2, "velocity_30s": 0.104,
                    "volume_vs_baseline": 4.1},
  "ts": "2026-06-10T14:32:08Z" }
```

The rule-based decision record is the source of truth. For an `INTERRUPT`, the delivery LLM turns this record plus verified event context into notification copy such as a headline and short body. Separately, the post-interaction agent produces a longer explanation on demand.

## Evaluation

The output is a **label + confidence score**, not free text, so grading is classifier-style (exact match in code), not LLM-as-judge. Since scoring itself is rule-based, there is no judge bias or judge drift in the decision path to begin with. The hard part is getting ground truth at all: "extraordinary" is subjective and only resolves after the match. Evaluation runs on a three-rung ladder, cheapest first:

1. **Verification (code, now)** — unit tests prove the signal math is correct on synthetic inputs. Status: `analysis/test_signals.py` 10/10 passing. Verified, not yet validated against real outcomes.
2. **Outcome-proxy metrics (offline)** — backtest the 2026 World Cup; label an event `INTERRUPT`-worthy if the improbable thing actually happened. Measure accuracy, precision, recall, F1, confusion matrix. **Headline metric: precision on `INTERRUPT`.**
3. **Engagement (online, the real target)** — whether viewers who got the nudge actually engaged. Unavailable offline.

Calibration (Expected Calibration Error, Brier score) sits across layers 2 and 3, a calibrated confidence is what licenses unattended sends.

## Decision layer

v1 uses two actions, not a graded set of tiers (every extra tier is another threshold to justify and calibrate).

```
rule-based score ──▶  score > threshold T ?
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
| Bad score / mis-fire | Deterministic gate pre-filter + eval harness; scorer reasons only from provided signals |
| Delivery-copy LLM latency or hallucination | Hard timeout + strict grounding in the decision record; fall back to deterministic copy or drop if the live window has passed; decision is unaffected |
| On-demand context LLM latency or hallucination | Ground only in supplied event context; fall back to templated context; notification decision is unaffected |
| Training-serving skew | Single shared computation path for derived columns in backtest and live |

## Roadmap

- **v1 (POC)** — one sport/event; improbability + velocity + volume; rule-based scoring; binary interrupt/don't; grounded LLM notification copy; on-demand post-interaction explanation; offline backtest as the eval; emit to a mock pipeline.
- **v2** — add reverse line movement (needs a splits feed); calibration-gated autonomy; passive "surface quietly" tier; live online eval loop; richer post-interaction context.
- **Later** — extend the sport-agnostic framework to additional sports as data allows.

## Status

Design-for-critique. Tech picks (odds provider, time-series store, threshold `T`, autonomy level) are presented as open decisions to challenge, not settled choices. Scoring and the interrupt/don't decision are rule-based; the LLM is scoped to pre-send notification copy and post-interaction context enrichment. The signal math is verified on synthetic inputs, while real-data lead-time, outcome-proxy, and engagement validation are pending.
