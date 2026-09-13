# Remote access

Reaching your relay from outside the network it lives on.

None of this is automated, and none of it runs through anywh: it's network
setup you do once, on infrastructure we never see.

## Put the relay on a private network

The relay has no authentication and defaults to a permission-skipping agent
process, so anyone who reaches its port can run code as you. Do not forward
it from your router, and do not park it behind a public reverse proxy. The
[security model](../README.md#security-model) is the short version of why.

What it needs is a private network that both ends are members of — the
machine running the relay, and every device you connect from — so the
relay's port is reachable by those and by nothing else. In practice that
means a WireGuard-based overlay network: every peer gets a stable private
address that keeps working no matter which physical network it is sitting
on. There are several implementations, hosted and self-hosted. Any of them
works here, because anywh never touches the network and has no opinion about
it.

## Wiring it up

1. **Join both ends to the network** — the relay's machine and each device
   you want to connect from. Whatever your implementation calls this
   (enrolling a node, adding a peer), it happens entirely outside anywh.

2. **Get the relay machine's address on that network.** A private address,
   stable across physical networks, and distinct from the machine's LAN IP.

3. **Bind the relay to that address.** Set `RELAY_HOST` to it in the
   profile's env file, or pass `--relay-host` when creating the profile,
   which writes it for you.

   Bind to that address specifically, not to `0.0.0.0`. The narrower bind
   means the relay isn't also listening on your LAN, on a café's Wi-Fi, or
   on any other interface the machine happens to pick up — only on the
   private network.

4. **Point the client at that address and port.** See
   [Self-hosting](./self-hosting.md#pointing-the-client-at-your-relay).

## When the relay isn't addressable at all

Behind carrier-grade NAT, or on a network where you can't join both ends to
an overlay, typing an IP into a box doesn't work. The client can be
handed a connection instead, through a pairing code or an
`anywh://import-profile` deep link.

That path needs the relay side to implement two endpoints. They're a
protocol, not an integration — the client knows no particular server's API,
it's handed URLs and calls them, so any self-hoster can implement them and
their relay becomes pairable by the stock client with no fork on either
side. See the [pairing protocol](./pairing.md).

## The catch nobody mentions

**The relay machine has to stay powered on and awake.**

Your session lives on that machine. If it sleeps, the app has nothing to
connect to — there's no cloud copy to fall back to, which is the whole point
of the design. This is equally true on your own LAN; it just doesn't become
obvious until you're away from home and the desktop you assumed was awake
suspended itself three hours ago.

On Linux, `systemd-inhibit` or disabling suspend on the host is the usual
fix. On macOS, `caffeinate` or the "prevent sleeping" setting in Energy
Saver.
