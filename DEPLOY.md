# Deploying K-Drop

Start to finish, roughly fifteen minutes. You need a GitHub account and a
Render account — both free, both sign in with GitHub.

---

## Why not Vercel or Netlify

K-Drop holds a WebSocket open for the whole session. Their standard plans close
it. The app will load and then fail to pair, which looks like a bug in your code
and is not. Use Render, Railway, or Fly.io.

---

## 1. Put the code on GitHub

From inside the `kdrop` folder:

```bash
git init
git add .
git commit -m "K-Drop"
```

Create an empty repo on github.com — **no** README, **no** .gitignore, it will
conflict — then:

```bash
git remote add origin https://github.com/YOUR-USERNAME/kdrop.git
git branch -M main
git push -u origin main
```

Check that `node_modules` did **not** get pushed. `.gitignore` handles it, but
look at the repo page and confirm.

---

## 2. Deploy on Render

1. render.com → **New** → **Web Service**
2. Connect your GitHub account, pick the `kdrop` repo
3. Render reads `render.yaml` and fills in the build and start commands itself.
   You should not need to type anything.
4. **Create Web Service**

First build takes two or three minutes. When it finishes you get a URL like
`https://kdrop-a1b2.onrender.com`.

HTTPS is included, and that matters: the PIN encryption and the folder picker
are switched off on plain `http://`, so they only start working once deployed.

---

## 3. Check it actually works

Open the URL on a laptop and a phone — **on different networks**, not the same
Wi-Fi. Mobile data on the phone is the easiest way. That is the case most likely
to break, so it is the one worth testing.

You should see either `Direct` or `Relayed` under step 01. Both are fine.
`Relayed` means the networks blocked a direct connection and the file is going
through your server encrypted, which is slower but works.

Then check the server is healthy:

```
https://your-app.onrender.com/api/health
```

Returns rooms, connected devices, uptime, and memory. Worth glancing at
occasionally in the first week.

---

## 4. Settings worth knowing

Everything has a working default. Change these in Render's **Environment** tab
only if you need to.

| Variable | Default | What it does |
|---|---|---|
| `MAX_RELAY_BYTES` | 2 GB | Bytes one session may push through the relay before being cut off |
| `MAX_ROOMS_PER_IP` | 30/hour | Sessions one address may start |
| `MAX_SOCKETS_PER_IP` | 16 | Simultaneous connections from one address |
| `MAX_ROOMS_TOTAL` | 5000 | Sessions held in memory server-wide |
| `ROOM_TTL_MS` | 30 min | How long an idle session survives |
| `TURN_URL` + `TURN_SECRET` | — | Preferred coturn REST-style TURN credentials (short-lived) |
| `TURN_USER` / `TURN_PASS` | — | Static TURN fallback for providers that require it |
| `TURN_CREDENTIAL_TTL_SEC` | 3600 | Lifetime of generated TURN credentials |

---

## The three things that will actually bite you

**The free instance sleeps.** After about fifteen minutes idle it shuts down,
and the next visitor waits 30–50 seconds for it to wake. Fine for showing
someone. Not fine for a public launch. Upgrading to Render's paid tier removes
it. Pinging the app to keep it awake burns your monthly instance hours and is
against the spirit of the free tier — don't.

**The relay spends your bandwidth.** Direct transfers cost nothing at all, since
the bytes never reach your server. But when a network blocks the direct route,
the entire file passes through your instance — a 2 GB transfer costs you 4 GB,
in and out. `MAX_RELAY_BYTES` caps it per session; watch the bandwidth graph in
your first week and lower it if needed. There is no revenue on the other side of
this, so treat the number as a budget, not a limit.

**You are the operator.** Once the URL is public, strangers move files through
infrastructure in your name. Kalman Consultancy Services Private Limited does not
exist yet, so that responsibility sits with the two of you personally. Ask your
CA whether to wait for incorporation. Until then, sharing the link directly with
people you know is a materially different thing from posting it publicly.

---

## Deploying somewhere else

**Docker**

```bash
docker build -t kdrop .
docker run -p 3000:3000 kdrop
```

**A VPS behind nginx** — the WebSocket upgrade headers are the part people
forget:

```nginx
location / {
  proxy_pass         http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header   Upgrade    $http_upgrade;
  proxy_set_header   Connection "upgrade";
  proxy_set_header   Host       $host;
  proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
  proxy_set_header   X-Forwarded-Proto $scheme;
  proxy_read_timeout 3600s;
}
```

Without `X-Forwarded-For`, every visitor looks like one IP address to the rate
limiter and the first person to hit a limit blocks everyone.

Get TLS with `certbot --nginx`. Do not skip it — the encryption features need a
secure context.

---

## Updating

```bash
git add .
git commit -m "what changed"
git push
```

Render redeploys on push. Roll back from the **Events** tab if something breaks.

---

## Two settings worth getting right on day one

**`TRUST_PROXY_HOPS`** decides which address the rate limiter counts. It reads
the client address that many hops in from the *right* of `x-forwarded-for`,
because proxies append to that header and anything on the left came from the
client. Set it to `1` for Render, Railway, Fly.io or a single nginx; `2` if
Cloudflare sits in front of one of those; `0` if there is no proxy at all.

Get this wrong in the generous direction and one visitor can look like many;
get it wrong in the strict direction and everyone looks like one address, so
the first person to hit a limit blocks the rest.

**`METRICS_TOKEN`** protects `/api/metrics`. With no token set, that endpoint
answers only to localhost. Set one in Render's dashboard if you want to check
it from your laptop:

```
https://your-app.onrender.com/api/metrics?token=YOUR-TOKEN
```

`/api/health` stays public — the platform needs it for health checks, and it
gives away nothing.

---

## After the first deploy

- Open `/security.html` and put a real contact address where the placeholder is.
- Work through `TESTING.md` on real devices.
- Watch `relayBytes` in the metrics for the first week. It is your bandwidth bill.
