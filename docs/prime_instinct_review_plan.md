# Prime Instinct Live-Notification Agent: Technical Review Plan

*This is a design-for-critique document: tech picks are presented as options to challenge, not settled decisions. Assumptions still being challenged are flagged as OPEN.*

---

## 1. Problem statement and non-goals

**Problem.** Prime Video's recommendation system is backward-looking: it predicts what you will watch from what you have already watched. It is blind to events that are extraordinary but have no behavioral history (the cold-start problem). During the 2026 World Cup a tiny nation making a historic run had no watch history, so the system had no basis to surface it until after it trended, by which point the match was over.

**What this agent does.** Watches live in-play betting odds during matches. The goal is not just to detect extraordinary events, trending already surfaces those, eventually. The goal is **timing: catch a live event before it trends**, while it is still unfolding, so viewers can watch it happen instead of catching the highlight after everyone else. The hypothesis: betting markets are a real-time crowd-sourced probability sensor, and when something extraordinary happens the odds move within seconds, faster than trending or social signals. This lead-time claim is the core thing the prototype is built to test, not an established fact. "Extraordinary" is the filter for what is worth surfacing; "before it trends" is the value the agent adds. When the market signals such a moment, the agent produces a notification decision while the match is still live.

**Sport scope.** The thesis is sport-agnostic. Examples below use both a World Cup case (for the original cold-start illustration) and NBA (the prototype sport, since Prime Video carries NBA). The prototype and all first validation run on NBA.

**Scope and boundary (v1).** The agent emits a scored, ready-to-send notification decision; Prime Video's existing notification pipeline handles the actual delivery and audience targeting, so the agent does not own device delivery or build any delivery infrastructure. It reads the event, not the viewer, there is no viewer profiling. The decision is binary (interrupt / don't; see Section 6), and only the betting-market signals below are in scope; narrative and social-context signals are not part of this prototype.

## 1a. Signals: what the agent measures

The agent reads four possible betting-market signals. Three run on the single odds stream; one needs a second feed and is deferred for the prototype (see below).

| Signal | What it measures | Feed needed | In prototype? |
| --- | --- | --- | --- |
| **Improbability** | How unlikely the current outcome is (longshot = high) | Odds stream | Yes |
| **Velocity** | How fast the odds are moving (sudden swing = something just happened) | Odds stream | Yes |
| **Volume anomaly** | Betting volume vs. baseline (a dormant market lighting up = people care) | Odds stream | Yes |
| **Reverse line movement (RLM)** | Odds move opposite to where the public is betting (informed / "smart" money) | Odds stream **+ betting-splits feed** | Deferred (see below) |

The moment is measured primarily by **velocity** (the real-time "something is happening now" signal), weighted by **improbability** (how big a deal it is) and **volume** (how much the market cares). A mid-match collapse like Cape Verde vs. Argentina is caught by velocity + improbability on the odds stream alone, no splits feed required.

**Why RLM is valuable.** It is arguably the strongest signal conceptually: the other three only detect *that* the odds moved or that an outcome is unlikely, while RLM detects *why*, informed/professional money moving against the public crowd, which the research describes as "a particularly strong signal indicating informed or professional money." If the premise is "betting markets know before anyone else," RLM is the signal that most directly captures it.

**Why RLM may not make the prototype.** RLM is the one signal that needs a second data source: public betting-splits (what % of the public is on each side), which the odds stream does not carry. That feed is a separate provider (Action Network, Sports Insights), and critically, public-splits coverage is sport-dependent. Splits data is published for football, hockey, basketball, baseball, soccer, and tennis, but not for Formula 1: F1 is only ~0.4% of global betting handle despite its audience, so the market is too thin for providers to publish public-money percentages. For an **F1 prototype specifically, RLM is likely not sourceable at all**, the deferral is forced by data availability, not a design preference. For a soccer/World Cup target, splits are more likely obtainable, in which case RLM becomes a candidate to include.

Bottom line: the prototype runs on **improbability + velocity + volume** (one odds feed). RLM is added only once a splits feed is confirmed for the target sport.

---

## 2. System context

```
  External feeds                     This agent                         Downstream
  ─────────────                      ──────────                         ──────────
  odds stream (WebSocket)  ──▶   ingest ─ store ─ gate ─ score ─ decide  ──▶  Prime Video
                                 (emits a notify/don't decision + payload)     notification pipeline

```

External dependency: an odds provider (candidates: Betfair Exchange Stream, OddsPapi, Odds-API.io, The Odds API). A betting-splits provider (Action Network, Sports Insights) is required only if RLM is included, and is deferred for the prototype (see Section 1a).

---

## 3. Component breakdown

| # | Component | Responsibility | In → Out | Candidate tech (OPEN) |
| --- | --- | --- | --- | --- |
| 1 | **Ingestion** | Hold the stream open + run reconciliation poll; lose nothing, duplicate nothing | feed messages → raw ticks | async WebSocket client + `httpx` poll; `tenacity` backoff |
| 2 | **Store + derived columns** | Persist every tick with timestamp; compute deterministic signal columns | raw ticks → rows + derived cols | time-series DB (Timescale) + hot-state KV (DynamoDB) |
| 3 | **Threshold gate** | Cheap filter: wake the agent only when a derived column crosses a bound | derived cols → wake/sleep | SQL condition or stream processor |
| 4 | **Scoring (deterministic)** | Combine the numeric signals into one score via a weighted formula, no LLM | signals → score | weighted formula; tunable weights |
| 5 | **Decision** | Convert score to an action via a cost-based threshold | score → interrupt / don't | decision function (one threshold T) |
| 6 | **Delivery (LLM copy)** | Turn the decision record into human-readable notification copy, then hand to Prime Video's pipeline | decision record → notification text + payload | LLM for copy (grounded in the record); then emit structured payload |

Division of labor: detection and the interrupt/don't decision (components 1 to 5) are fully deterministic and auditable, scoring is a weighted formula, not a model judgment. The LLM touches only the *language* layer, never the math: it writes the notification copy at delivery (component 6, grounded in the decision record) and powers the on-demand answering agent (Section 6a).

---

## 4. Data contracts

### Input: odds tick (from the stream, shape varies by provider)

The API returns current state, not interpretation. No provider returns "% change" or "a goal happened." We compute the change ourselves. Assumption to verify: historical odds snapshots are fine-grained enough (e.g. 5-minute intervals) to catch an in-game swing; this holds in principle but is unconfirmed until real NBA data is pulled.

```json
{ "match_id": "cv_arg_r32", "ts": "2026-06-10T14:32:07Z",
  "market": "h2h",
  "outcomes": [ {"name": "Argentina", "decimal": 1.60},
                {"name": "Cape Verde", "decimal": 2.40} ],
  "traded_volume": 24500.0 }

```

### Derived signal record (computed by the store, read by the agent)

```json
{ "match_id": "cv_arg_r32", "ts": "2026-06-10T14:32:07Z",
  "improbability": 7.2, "velocity_30s": 0.104,
  "volume_vs_baseline": 4.1 }

```

### Output: notification decision (what the pipeline consumes)

```json
{ "match_id": "cel_bkn_2026-10-27", "decision": "INTERRUPT",
  "score": 8.4,
  "signals_fired": ["improbability", "velocity"],
  "signal_values": {"improbability": 7.2, "velocity_30s": 0.104, "volume_vs_baseline": 4.1},
  "ts": "2026-10-27T03:14:08Z" }

```

OPEN: exact payload fields the Prime Video pipeline expects (targeting, copy ownership, timing) are unknown until the PM confirms the handoff contract.

---

## 5. Evaluation (the part most in need of review)

The agent's output is a **label** (interrupt / don't) plus a **confidence score**, not free text. So the grading mechanics are classifier-style (exact match in code), not LLM-as-judge, no judge bias, no judge drift. The genuinely hard part is not the grader but **getting ground truth at all**: "extraordinary" is subjective and only resolves after the match. Note also that the "trending" baseline the prototype compares against (r/nba comment volume) is itself a proxy, a fan community, not general social or casual viewers, so results read as "leads a fan-trend signal," not "leads all of social." Evaluation therefore runs on a three-rung ladder of increasing truth, cheapest first.

1. **Verification (code, now).** Unit tests prove the signal math (implied probability, velocity, the gate) is computed correctly on synthetic inputs. This is verification, not validation: it proves the math is right, NOT that the output matches reality. Done, see `analysis/test_signals.py` (10/10 passing). Status: verified, not yet validated against real outcomes.
2. **Outcome-proxy metrics (offline, backward-looking).** There is no pristine human-labeled ground truth for live sports: "extraordinary" is subjective and only resolves in hindsight. So labels come from a **proxy**, backtest the 2026 World Cup and mark an event INTERRUPT-worthy if the improbable thing actually happened (the longshot won, led, or went to extra time). Then measure accuracy, precision, recall, F1, confusion matrix against that proxy. **Headline metric: precision on INTERRUPT.** Honest limitation: the proxy measures "was it objectively extraordinary," not "would a viewer have valued the nudge", the latter only resolves with live engagement (layer 3).
3. **Engagement (online, the real target).** Once notifications ship, the true label is whether viewers who got the nudge actually engaged. This is the real success metric and is unavailable offline. Calibration (Expected Calibration Error, Brier score) sits across layers 2 and 3: a confidence that is calibrated against proxy then engagement outcomes is what licenses unattended sends.

**What is testable, and when.** (0) Verification, now: unit tests prove the signal math is correct (done, verified, not yet validated against reality). (1) Outcome-proxy, after the backtest: F1 and precision become computable against proxy labels. (2) Engagement, after launch: the real target. The backtest history and the proxy-labeled set are the same artifact, so the backtest must compute derived columns the same way the live pipeline does (training-serving skew risk, Section 7).

LLM-as-judge is deliberately NOT the evaluator here: outcome and engagement are external truth, and grading an LLM's "extraordinariness" call with another LLM is circular ("teams end up optimizing for the judge"). It is reserved for the subjective residue between proxy and engagement (e.g. "a longshot worth surfacing that then lost"), and only as a temporary bridge anchored to a small human-labeled sample with a second-model cross-check, never the foundation.

---

## 6. Decision layer: interrupt or don't (v1)

The score-to-action policy. v1 uses two actions, not a graded set of tiers, because every extra tier is another threshold to justify and calibrate, and an uncalibrated boundary is the "based on nothing" problem.

```
  calibrated score ──▶ score > threshold T ?
                           │
                     yes ──┴── no
                      │         │
                 INTERRUPT    DON'T

```

T is set by **cost, not assertion**: cost of a miss (viewer never discovers the moment, high) vs. cost of a false alarm (interrupted for a routine match, erodes trust, high). T sits where those balance, measured on the backtest. This is a cost-based / decision-theoretic threshold, the shape weather services use for tiered warnings; the interruptive-vs-passive split is what the alert-fatigue literature converges on.

Designed for a third tier later: the action is a decision function, so adding a middle "surface quietly" tier is a second threshold added once calibration data justifies it, not a rewrite.

---

## 6a. On-demand answering agent (where the LLM lives)

Detection and the interrupt/don't decision are fully deterministic, no LLM. Scoring is a weighted formula over the numeric signals, not a model judgment, so it is cheap, testable, and auditable. The LLM is confined to the language layer: it writes the notification copy at delivery (turning the technical decision record into a human hook like "Smallest nation in World Cup history is beating the champions, live now"), and it not in the always-on path.

Instead the LLM powers a separate **on-demand answering agent**: when a user taps a notification, it takes the event's structured context (teams, which signal fired, historical facts such as "first World Cup appearance in 28 years," current score and odds) and generates a short plain-language explanation of why the moment matters.

This is the real agentic layer, and it is the strongest placement for an LLM in this system:

- **Pull, not push.** It runs only when a user asks, so it is low-volume and cheap, not invoked on every event.
- **Low-stakes.** A slightly-off explainer the user chose to open is far less damaging than a wrong mass notification.
- **Plays to the model's strength.** "Explain why this moment matters" is context synthesis, exactly what an LLM is good at and what neither the odds nor a formula can do.

Contract. Input: an event context record. Output: a few sentences of explanation. Guardrail: reason only from the provided context, do not introduce facts not in the input.

OPEN: where the richer context is sourced (a prepared event record vs. a live lookup at tap time), and how hallucination is bounded (strict grounding in the supplied record).

## 7. Failure modes and mitigations

| Failure | Impact | Mitigation |
| --- | --- | --- |
| Odds feed drops mid-match | Blind during the moment that matters most | Reconciliation poll + replay cursor to resync; second provider as fallback |
| Duplicate messages | Same goal fires two notifications | Idempotency key `(match_id, signal_type, time_bucket)`; dedup before emit |
| Out-of-order messages | Stale odds overwrite fresh state | Keep message timestamp; ignore anything older than current state |
| LLM latency spike | Decision arrives after the moment passed | Hard timeout; if it misses the live window, drop rather than emit late |
| Bad / hallucinated score | Interrupt on a routine match, erode trust | Deterministic gate pre-filter + eval harness; reason only from provided signals |
| Training-serving skew | Backtest computes signals differently than live | Single shared computation path for derived columns in both backtest and live |

Theme for the reviewer: every external dependency can fail, and for each we have chosen retry / degrade / drop. For a live notification, late is worse than never.

---

## 8. Open decisions (flagged for review)

- **Trigger durability:** which provider offers a replayable bus vs. raw WebSocket, which determines how trustworthy reconciliation can be.
- **Store choice:** Timescale + DynamoDB split, or one store? Derived columns materialized or computed on read?
- **Threshold T:** needs the backtest to estimate miss-cost vs. false-alarm-cost before it can be set.
- **Autonomy:** does v1 interrupt fully autonomously, or require a fast editor tap before a wide send?
- **Splits feed / RLM:** reverse line movement needs a public-betting-splits feed. For F1 that data is likely unavailable (F1 is ~0.4% of betting handle, providers do not publish splits for it), so RLM is deferred by necessity; for soccer it may be sourceable. Open: confirm splits availability for the chosen prototype sport.
- **Scope of signals in v1:** improbability + velocity + volume. Confirm RLM is in or out for the chosen sport.

---

## 9. Phasing

- **v1 (POC):** one sport/event, improbability + velocity + volume signals, binary interrupt/don't, offline backtest as the eval, emit decision to a mock pipeline.
- **v2:** add reverse line movement (needs a splits feed, sport-dependent), calibration-gated autonomy, the passive "surface quietly" tier, live online eval loop.
- **Later:** extend the sport-agnostic framework to additional sports as data allows.

---

## References

Grounding for each design decision. No published paper covers "betting-odds-as-novelty-signal for streaming notifications" specifically, that synthesis is novel; the literature grounds each component.

1. Zheng et al., *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena* (NeurIPS 2023). LLM-judge biases (position, verbosity, self-enhancement). [https://arxiv.org/abs/2306.05685](https://arxiv.org/abs/2306.05685)
2. Guo et al., *On Calibration of Modern Neural Networks* (ICML 2017). Expected Calibration Error; modern models are overconfident. [https://arxiv.org/abs/1706.04599](https://arxiv.org/abs/1706.04599)
3. *Reliability without Validity: Large-Scale Evaluation of LLM-as-a-Judge* (2026). Consistency-bias paradox in judges. [https://arxiv.org/pdf/2606.19544](https://arxiv.org/pdf/2606.19544)
4. *LLM Reasoning for Cold-Start Item Recommendation* (Netflix domain, 2026). LLM reasoning for items with no interaction history. [https://arxiv.org/html/2511.18261v1](https://arxiv.org/html/2511.18261v1)
5. *Towards End-to-End Generative Homepage Construction at Netflix* (GenPage). Cold start as a first-class production concern. [https://arxiv.org/html/2606.31031v1](https://arxiv.org/html/2606.31031v1)
6. Taggart et al., *A scoring framework for tiered warnings based on fixed risk measures* (Australian Bureau of Meteorology). Cost/risk-based tier thresholds. [https://arxiv.org/pdf/2108.12814](https://arxiv.org/pdf/2108.12814)
7. *Scaling Machine Learning at Uber with Michelangelo* + Palette feature store. Real-time derived-feature store at scale. [https://www.uber.com/blog/scaling-michelangelo](https://www.uber.com/blog/scaling-michelangelo)
8. *Eliminate Training-Serving Skew in MLOps* (Confluent). Why backtest and live must share one computation path. [https://master.www.confluent.io/blog/eliminate-training-serving-skew-mlops/](https://master.www.confluent.io/blog/eliminate-training-serving-skew-mlops/)
9. *Predictive Audience Segmentation in Retail Media* (footprints.ai). Score-to-action policy; thresholds as commercial choices, not natural facts. [https://www.footprints-ai.com/blog-articles/predictive-audience-segmentation-how-retail-media-moves-from-rules-to-probability](https://www.footprints-ai.com/blog-articles/predictive-audience-segmentation-how-retail-media-moves-from-rules-to-probability)
10. *Understanding Betting Splits* (rg.org) and Action Network public-betting. Splits coverage is sport-dependent (football, hockey, basketball, baseball, soccer, tennis; not F1). [https://rg.org/guides/sportsbetting-guides/betting-splits](https://rg.org/guides/sportsbetting-guides/betting-splits)

