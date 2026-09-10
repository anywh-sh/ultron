// Package signature replicates anywh-control-plane's
// src/auth/nodeSignature.ts request-signing scheme byte-for-byte — the TS
// side is the source of truth, this is not a shared import (independent Go
// module, journal/62 CT-2, same relationship anywh-control-plane/edge's own
// internal/signature package has with the same TS file).
package signature

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

// SigningPayload builds `METHOD \n PATH \n TS_MS \n hex(sha256(body))`, the
// same bytes nodeSignature.ts's signingPayload() hashes and signs.
func SigningPayload(method, path string, timestampMs int64, body []byte) []byte {
	sum := sha256.Sum256(body)
	return []byte(fmt.Sprintf("%s\n%s\n%d\n%s", method, path, timestampMs, hex.EncodeToString(sum[:])))
}

// Sign returns the base64 (standard) signature nodeSignature.ts's
// verifyNodeSignature expects in the X-Anywh-Sig-shaped header.
func Sign(priv ed25519.PrivateKey, method, path string, timestampMs int64, body []byte) string {
	sig := ed25519.Sign(priv, SigningPayload(method, path, timestampMs, body))
	return base64.StdEncoding.EncodeToString(sig)
}
