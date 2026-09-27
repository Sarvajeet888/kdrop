# Running the test programme

Google requires a new personal developer account to run a **closed test with at
least 12 testers opted in continuously for 14 days** before you can apply for
production access. That is two weeks of calendar time, so it starts as early as
possible and runs while you do other work.

An organisation account skips this, but needs a D-U-N-S number and company
verification documents — which needs Kalman Consultancy Services incorporated.

---

## Before you invite anyone

- [ ] The web app is live on your own HTTPS domain
- [ ] `TESTING.md` completed by you, on your own devices
- [ ] `npm run test:all` passes
- [ ] `public/security.html` has a real contact address
- [ ] The AAB is uploaded to the internal testing track and installs

Inviting twelve people to a broken build spends goodwill you cannot get back.
Test it yourself first.

---

## Finding twelve testers

Twelve sounds like a lot until you count. Woxsen alone should cover it, and a
batch of CSE students on assorted Android phones is a better test population
than any lab.

What each tester needs:

1. A Google account (the one on their phone)
2. To accept the opt-in link you send
3. To install and keep the app installed for the full fourteen days

The last one is where programmes fail. Someone uninstalls on day three and the
count drops. Say clearly at the start: **keep it installed for two weeks, even
if you do not use it.**

Ask for thirteen or fourteen so that one dropping out does not reset you.

---

## What to send them

```
Hi — I built a file transfer app and need testers before it can go on the
Play Store.

What it does: send files straight between two devices. No account, no upload,
nothing stored. Phone to laptop, phone to phone, any combination.

What I need from you:
1. Tap this link and accept: [YOUR OPT-IN LINK]
2. Install K-Drop from the Play Store link that appears
3. Keep it installed for 14 days — even if you never open it. Google counts
   continuous installs, and if it drops below 12 I have to start again.
4. Try sending something. Anything. A photo to your laptop is enough.

If something breaks, tell me: what phone, what you did, what happened.
Screenshots help. "It didn't work" I can't fix; "it stuck at 40% on a 2 GB
video over college Wi-Fi" I can.

Thanks — genuinely, this is the part I can't do alone.
```

---

## What to ask them to try

Send this as a short list. People test what you ask them to test and nothing else.

| # | Try this | Why it matters |
|---|---|---|
| 1 | Photo from phone to a laptop, same Wi-Fi | The most common real use |
| 2 | A file from the laptop back to the phone | The other direction behaves differently |
| 3 | Share a photo from your gallery using Share → K-Drop | The share sheet only works if the app is installed properly |
| 4 | Something large — a video over 500 MB | Where memory limits show up |
| 5 | Phone on mobile data, laptop on Wi-Fi | Forces the relay route |
| 6 | Lock the phone mid-transfer, unlock it | The wake lock either works or it does not |
| 7 | Turn Wi-Fi off mid-transfer, turn it back on | Resume either works or it does not |
| 8 | Type a wrong code deliberately | The error should explain itself |

Numbers 5, 6 and 7 are the ones I most expect to find problems. They are also
the ones testers skip unless asked.

---

## Collecting what comes back

You do not need a bug tracker for twelve people. A WhatsApp group and a
spreadsheet is enough, and lower friction means more reports.

Record for each report:

| Field | Example |
|---|---|
| Device | Redmi Note 12, Android 13 |
| Other device | Windows 11 laptop, Chrome |
| Network | Both on college Wi-Fi |
| What they did | Sent a 1.2 GB video |
| What happened | Stuck at 40%, no error |
| Route shown | Relayed |
| Screenshot | yes / no |

The **route** field matters more than it looks. "Direct" and "Relayed"
behave completely differently, and a bug that only appears on one is a very
different bug.

---

## Reading the numbers while it runs

```
https://YOUR-DOMAIN/api/metrics?token=YOUR-TOKEN
```

| What to watch | What it means |
|---|---|
| `relayBytes` climbing fast | Most traffic is taking the expensive route. Your bandwidth bill, and a sign TURN would help. |
| `relayCutoffs` above zero | Someone hit the per-session ceiling. Either the limit is too low or something is looping. |
| `rateLimited` above zero | Either abuse, or `TRUST_PROXY_HOPS` is wrong and everyone looks like one address. |
| `errors` above zero | A crash. Check the logs. |
| `rssMb` climbing and not falling | A leak. Rooms should be released when the last device leaves. |

Check it after each testing session, not continuously.

---

## Deciding whether it is ready

Ready to submit for production when:

- [ ] All eight scenarios above have worked on at least three different phones
- [ ] No tester reports data loss or a corrupted file
- [ ] Anything that failed has either been fixed or is written down as a known
      limit in the docs
- [ ] `errors` in metrics is zero over the full fourteen days
- [ ] You would send your own important file with it

That last one is not a joke. If you would not, it is not ready.

---

## What not to do

**Do not fix everything.** Some reports are about the network, not the app —
"slow on mobile data" is physics. The docs already explain round-trip time.
Point at that rather than rewriting the transfer engine.

**Do not add features during the test.** A tester on a build from day two
reporting a bug you fixed on day five wastes both your time. Fix bugs, ship
those, keep features for after.

**Do not let the fourteen days idle.** It is calendar time you do not control.
Use it on something that pays.
