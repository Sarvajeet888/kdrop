# K-Drop v2 — architecture, deferred

**Status:** blocked, deliberately
**Date:** 26 August 2026

---

## Why this document is short

A v2 architecture answers the question *"what did v1 get wrong?"*

K-Drop v1.0 has never been deployed. It has no users. Nothing about it has been
stressed by anyone other than an automated test suite running two browser tabs
on one machine.

So there is no evidence, and an architecture written without evidence is a
guess that will be defended later because it is written down. The correct v2
architecture document, today, is a list of the questions v1 must answer first.

---

## What must be known before v2 can be designed

Each of these is already measured by the running service. None of them can be
answered from an empty instance.

| Question | Where the answer comes from | Why it decides architecture |
|---|---|---|
| What fraction of connections go direct? | `directConnectionRate` | Below ~50%, the relay is the product and its architecture matters more than the peer-to-peer path. Above ~85%, the relay is an edge case and should stay simple. |
| What fraction of transfers complete? | `transferSuccessRate` | Below 95%, reliability is the v2 problem. Above 99%, it is not. |
| Where do they fail? | tester reports, `counters.transfersFailed` | Network, memory, or protocol. Three different rewrites. |
| How large is a typical file? | `avgRelayMb` from `npm run cost` | A median of 5 MB and a median of 2 GB imply opposite designs. |
| Does one server run out of room? | `rssMb`, `rooms` | Shared state across instances is only worth building when one instance is genuinely full. Load testing says ~1500 concurrent sessions; that is a lot of users. |
| Do people want more than one device at once? | asked, not assumed | Multi-device changes the pairing model. Nobody has asked yet. |
| Do people repeat-pair the same two devices? | asked, not assumed | If yes, trusted devices is the highest-value v2 feature. If no, it is complexity for nothing. |

---

## What v1 already knows about its own limits

These are real and documented, but none of them requires a v2 to fix:

- **Both devices must stay open.** No mailbox. This is a design choice, not a
  defect, and changing it means storing files — which contradicts the entire
  privacy claim.
- **The relay assumes two parties.** Direct handles any number. Fixing this is
  a bounded change to the relay routing, not an architecture.
- **Memory-bound receivers** on Safari and Firefox. Browser limitation, not
  ours; it improves as those browsers ship the File System Access API.
- **No forward secrecy on the relayed route.** Fixable inside v1 with an
  ephemeral key exchange, if it ever matters.
- **One process holds all session state.** Genuinely architectural — and
  genuinely not a problem until one instance fills up.

Every one of these is a v1.x change. None needs a new version number.

---

## The trap this document exists to avoid

The roadmap lists Phases 38 through 40 after Phase 37. It is tempting to read
that as a queue to work through.

It is not. Phases 22 through 37 assume a launched product generating evidence.
Working through them on an unlaunched product produces documents that describe
a service nobody uses, and code that solves problems nobody has hit.

The roadmap itself says this, twice:

> *Don't prematurely build a giant distributed system.*
>
> *That's expensive engineering cosplay. Start simple, measure, then scale.*

---

## What unblocks this

One purchase and one evening:

1. A domain. Roughly ₹900.
2. Deploy — the repository, `render.yaml` and `DEPLOY.md` are ready.
3. `TESTING.md` on real devices.
4. Share the link. Fifty people at Woxsen is a real user population.

Then let it run for a month while you work on something else.

After a month, `npm run cost` and `/api/metrics` will answer most of the table
above from real data, and this document can be rewritten as an actual
architecture rather than a list of unknowns.

---

## Decision

**v2 is deferred until v1 has users.**

This is not indefinite. It is conditional on a single, cheap, specific step
that has been the blocker for several weeks.

Revisit when: the service has been live for 30 days with at least 100 completed
transfers recorded.
