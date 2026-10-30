# Tailcat browser fallback

Upstream: https://github.com/tailscale/tailcat
Pin: `52fbad323e9d352f1febb623e0975368e9a8cbdd` (7 October 2026).
License: BSD-3-Clause; linked Go modules and Go runtime retain their original notices.
There are no changes to upstream Go code. Our JavaScript worker/adapter is separate.

## Build and corresponding source

Install official Go 1.27.3, clone the upstream repository at the pin, then run:

```sh
python3 scripts/build-tailcat.py --source /path/to/tailcat --go /path/to/go/bin/go
```

The recipe uses upstream's `internal/buildtags.WasmTags()` to choose exactly the
browser features, then builds `./web` with `GOOS=js GOARCH=wasm CGO_ENABLED=0`,
`-trimpath -buildvcs=false -ldflags="-s -w"`. The original Go runtime is copied to
`web/vendor/tailcat/wasm_exec.js`. The Wasm is gzip-compressed deterministically.

`web/assets/tailcat-source.tar.gz` contains the full tracked upstream source and
all selected dependency Go/assembly sources, embedded assets, original notices,
`vendor/modules.txt`, versioned dependency manifests and the exact build tags.
It is an offline source kit for this **js/wasm build**, not for other operating
systems or CLI programs. Go itself is a separately available standard toolchain.
Follow `BUILD-SOURCE.txt`: inside `tailcat/`, with Go 1.27.3:

```sh
GOOS=js GOARCH=wasm CGO_ENABLED=0 go build -mod=vendor \
  -tags "$(cat BUILD-TAGS.txt)" -trimpath -buildvcs=false \
  -ldflags="-s -w" -o tailcat.wasm ./web
```

The recipe performs that offline rebuild and compares the Wasm bytes before
shipping. `tailcat-build.json` records hashes for Wasm/gzip, runtime, notices and
sources; the normal site build checks them. Complete dependency license files
are reproduced in `web/TAILCAT-NOTICES.txt`; copyright comments remain in source.

## Connection and lifecycle

RetroRoom still tries direct PeerJS/WebRTC first. For NES/SNES local-emulation
rooms the host prepares an ephemeral Tailcat listener. Its address and the
additional AES-GCM room key are carried only in the invitation fragment. The
listener is not an OS server, VPN, TUN interface, or persistent browser identity.
No local network routes, ports, or filesystem access are exposed to a guest.
Only temporary port 1 handles bounded, authenticated RetroRoom packets.

The guest loads the local Wasm only after P2P fails/times out. Browser Tailcat
uses the public `https://tailcat.dev/derpmap.json` and TLS WebSockets to DERP;
WireGuard protects the tunnel and AES-GCM protects room packets additionally.
The worker is terminated on leave/error; no credentials or addresses are saved
or logged. A host waiting listener sends no game payload while P2P works.

Framing: 4-byte big-endian byte length, then at most 8192 UTF-8 bytes of the
existing versioned encrypted envelope. Plaintext is at most 4096 bytes; only
validated game metadata/input/control is accepted. No ROM transfer API exists.
Queued output is capped at 128 KiB, input batching at 4 ms/8 frames. Stream
reassembly handles TCP splitting/coalescing. Closing cancels pending opens.

The public service is experimental and rate-limited. Its operators see connection
metadata. No availability, speed, ping or unlimited-use promise is made. This
fallback does not relay WebRTC media, does not automatically migrate a running
P2P game, and is not enabled for DOS. Solo/stream rooms start no Tailcat worker.
