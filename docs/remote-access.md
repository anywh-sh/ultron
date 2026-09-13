# Remote access

Reaching your relay from outside the network it lives on.

None of this is automated, and none of it runs through anywh: it's network
setup you do once with your own accounts, on infrastructure we never see.

## Use a private network, not a port forward

The relay has no authentication and defaults to a permission-skipping agent
process, so anyone who reaches its port can run code as you. Do not forward
it from your router. The [security model](../README.md#security-model) is
the short version of why.

The answer is a personal overlay network. [Tailscale](https://tailscale.com/)
is the least work — the free tier covers individual use, and WireGuard by
hand gets you to the same place.

1. Create a Tailscale account and install the client on the relay machine
   **and** on every device you want to connect from.
2. On the relay machine, get its tailnet address:

   ```bash
   tailscale ip -4
   ```

   It's a `100.x.y.z`.
3. Bind the relay to that interface — set `RELAY_HOST` to the tailnet IP in
   the profile's env file (or pass `--relay-host` when creating the profile,
   which writes it for you). Binding to the tailnet IP specifically is
   better than `0.0.0.0`: it means the relay isn't listening on your LAN or
   any other interface at all.
4. Point the client at that IP and port — see
   [Self-hosting](./self-hosting.md#pointing-the-client-at-your-relay).

## When the relay isn't addressable at all

Behind carrier-grade NAT, or on a network where you can't run a tailnet
client on both ends, typing an IP into a box doesn't work. The client can be
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
