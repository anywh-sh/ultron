# Pairing protocol

How a client adds a relay it can't reach directly — a machine behind NAT, on
a tailnet, or otherwise not addressable by typing an IP into a box.

This is a protocol, not an integration. Nothing in the client knows any
particular server's API: it is handed URLs and calls them. Any self-hoster
can implement the two endpoints below and their relay becomes pairable by
the stock client, with no fork and no code change on either side.

## The two entry points

Both converge on the same redemption, and both are optional to implement —
a deployment can offer either or both.

### 1. Deep link — `anywh://import-profile`

The client registers the `anywh://` scheme (desktop and iOS). A link
carries everything needed, so nothing is typed:

```
anywh://import-profile?label=<name>&claimUrl=<url>&joinCode=<code>&brokerUrl=<url>
```

| Param | Required | Meaning |
|---|---|---|
| `label` | yes | What to call this profile locally. UI only. |
| `claimUrl` | yes | Absolute URL to POST the redemption to (see below). |
| `joinCode` | yes | The one-time secret, opaque to the client. |
| `brokerUrl` | no | Absolute URL to ask for a connection before each dial. Falls back to whatever the claim response returns. |

There is also a direct mode for a relay that *is* reachable —
`?label=&host=&port=&token=` — which needs none of this protocol.

### 2. Typed code — `<join-code>@<host>`

For when a link can't be delivered: a code read off another screen, a
platform where the scheme isn't registered, a browser that swallowed it.
Entered in the client under **Adicionar máquina remota**.

```
ABCDEF-GHJKMNPQ@example.com
```

The host half is the point: a bare code would be meaningless without
knowing where to redeem it, and the client is not allowed to have a default
answer to that — hardcoding one would bake a single deployment into a
self-hostable app. The host is also shown to the user before anything is
sent, so it's visible which machine is about to receive their device's
public key.

Parsing rules the client applies:

- Split at the **last** `@`. The code half is uppercased; the host half is a
  host with an optional port, nothing more.
- `https` is forced, except for loopback (`localhost`, `127.0.0.1`, `::1`),
  which may stay `http` so pairing against a relay on the same machine
  works.
- An explicit `https://` in front of the host is accepted and ignored;
  anything else (a path, a query, another scheme) is rejected.

Since a typed code carries only a host, the client has to discover the rest.

## Discovery — `GET /.well-known/anywh-pairing`

Served over HTTPS from the origin in the code, `Content-Type:
application/json`. A static file is a perfectly good implementation.

```json
{
  "claimUrl": "https://api.example.com/v1/nodes/claim",
  "brokerUrl": "https://api.example.com/v1/connect/some-workspace"
}
```

| Field | Required | Meaning |
|---|---|---|
| `claimUrl` | yes | Where to redeem a code. Must be `https` (loopback may be `http`). |
| `brokerUrl` | no | Only for a deployment whose broker is the same for every device it pairs. One that resolves the broker per claimed device returns it from the claim response instead, and omits it here. |

Unknown fields are ignored. Both URLs are absolute: the client concatenates
nothing and assumes no route names, which is what keeps this generic.

Deployments that only ever use deep links don't need this endpoint at all,
but then the typed code doesn't work against them.

## Redemption — `POST <claimUrl>`

Authenticated by possession of the code alone. No session, no signature.

```json
{ "joinCode": "ABCDEF-GHJKMNPQ", "publicKey": "<base64 ed25519 public key>" }
```

The client generates its own Ed25519 identity locally and sends only the
public half. The private key never leaves the device and never transits a
link, a code, or a QR — this is why the code is safe to read aloud or
screenshot: on its own it authorizes registering *a* device, and whoever
redeems it first binds their own key to it.

Response:

```json
{
  "nodeId": "...",
  "controlUrl": "https://headscale.example.com",
  "authKey": "...",
  "brokerUrl": "https://api.example.com/v1/connect/some-workspace",
  "reportUrl": "https://api.example.com/v1/nodes/<id>/tailnet"
}
```

| Field | Required | Meaning |
|---|---|---|
| `nodeId` | yes | How the broker knows this device. Sent back as `X-Node-Id`. |
| `controlUrl` | yes | Tailscale/Headscale coordination server to join. |
| `authKey` | yes | Pre-auth key for that join. Short-lived. |
| `brokerUrl` | no | Used when neither the link nor discovery named one. |
| `reportUrl` | no | Where to report the node key earned on the next join. Omit if the deployment doesn't need it. |

Unknown fields are ignored — a server may return more.

CORS matters here: a packaged app's `Origin` is `tauri://localhost`, not any
web origin, so both `claimUrl` and `brokerUrl` must accept it. Since neither
is ever called with a cookie, allowing any origin **without**
`Access-Control-Allow-Credentials` is the right posture; the two policies
must not be merged into one, or the credentialed header leaks onto the open
responses.

## Expiry and abuse

Enforced by the server, not the client. A reasonable shape, and the one the
reference implementation uses: single use, 15 minutes, locked after 5 wrong
attempts, plus a per-IP rate limit on the claim endpoint. Splitting the code
into a plaintext selector and a secret verifier is what makes a per-code
attempt counter possible without a lookup on the secret itself.
