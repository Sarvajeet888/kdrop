# Releasing K-Drop

## The gate

```bash
npm run release          # check this build is coherent
npm run release:set 1.0.1   # set the version everywhere at once
```

`release:set` updates `package.json`, the Android version name, **increments
the Android version code**, and the docs — in one step. The version code
matters: Play refuses an upload whose code is not higher than the last, and a
number once used can never be reused.

`npm run release` then verifies the build agrees with itself: versions match,
no placeholders remain, required files exist, the lockfile is present, there
are no high-severity advisories, and no secrets are in the tree.

It cannot check whether the site is live, whether real devices work, or whether
you would trust it with your own files. Those are listed at the end for you.

---

## Version numbers

`MAJOR.MINOR.PATCH` — and phases are not versions.

| Change | Example |
|---|---|
| Bug or security fix only | 1.0.0 → 1.0.1 |
| Meaningful improvement, evidence-based | 1.0.1 → 1.1.0 |
| Architecture change, migration needed | 1.x → 2.0.0 |

---

## Freeze rules for a release candidate

Once a version is a candidate, only these go in:

- Crash fixes
- Security fixes
- Data-loss fixes
- Play Store compliance fixes

Not: new features, redesigns, experiments. If it is tempting, it goes in the
next version — the point of a candidate is that it stops moving long enough to
be trusted.

---

## Steps

```bash
git checkout -b release/v1.0.0
npm run release:set 1.0.0
npm run test:all
npm run release
git commit -am "Release 1.0.0"
git tag v1.0.0
git push origin release/v1.0.0 --tags
```

Then merge to `main`, which is what deploys.

---

## Service level objectives

Targets for judging the service, not promises made to users. Read them from
`/api/metrics`.

| Objective | Target | Metric |
|---|---|---|
| Transfers complete | ≥ 99% | `transferSuccessRate` |
| Sessions reach a second device | ≥ 90% | `joinRate` |
| Connections go direct | ≥ 70% | `directConnectionRate` |
| Unhandled errors | 0 | `counters.errors` |
| Memory | < 250 MB | `rssMb` |

`/api/metrics` returns `status: healthy | watch | attention` with the specific
alerts, so a glance answers the question without remembering the thresholds.

**`directConnectionRate` is the one that costs money.** Every transfer that
does not go direct goes through the relay, and that is your bandwidth bill. If
it sits below 50%, TURN would pay for itself.

---

## Rolling back

Nothing is stored, so a rollback loses nothing but the newer code.

```bash
git revert <commit>   # or, on Render: Events → Rollback
```

Do not "fix forward" on a public service during an incident. Get back to a
known-good build first, then work out what happened.
