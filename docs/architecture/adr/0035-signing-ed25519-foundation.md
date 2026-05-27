# ADR-0035 — Yannik-Ed25519-Signatur-Flow (Public-Core Foundation)

**Status:** Akzeptiert (2026-05-27)
**Datum:** 2026-05-27
**Bedingt durch:** ADR-0026 §"Review-Gate" Gate 2 + Yannik-Decision aus three-brain-Klärungsslot.

## Kontext

ADR-0026 §"Review-Gate" fordert für jeden `quarantined → reviewed`-Übergang eines Skills:

- Side-by-Side-Diff vorher/nachher
- **Yannik-Signatur (lokaler Ed25519-Key in Keyring) → Audit-Log**
- Bei `customer-confidential`-Touchpoint: zusätzlicher Confirm

Plus ADR-0027 §Phase 7 (MSP-Write): vor jedem Customer-Write
- **Approval-Token + Yannik-Signatur (Ed25519 aus Keyring) ins Audit-Log**

→ Beide Konsumenten nutzen exakt denselben Signing-Primitive. Public-Core liefert die Foundation; `claude-os-msp` konsumiert sie für die MSP-Approval-Tokens (Phase 7).

## Entscheidung

**Ed25519 mit SHA-256-Hash über kanonisches-JSON. Algorithmus-ID `ed25519-sha256-canonjson` für Wire-Format.**

### Algorithmus-Wahl

| Algorithmus | Pro | Contra |
|---|---|---|
| **Ed25519** | deterministische signatures, fast, kleine 32B keys + 64B signatures, Node built-in seit v12, modern crypto, kein curve-tuning nötig | nichts kritisches |
| ECDSA-P256 | breite Compat | längere signatures (~70B variable), non-deterministisch ohne RFC 6979 |
| RSA-2048+ | universell verstanden | ~256B signatures, langsam, key-size growth über Zeit |

**Ed25519 hat keine echten Nachteile** für unseren Use-Case (lokal-signed approval-tokens). Ähnliche Wahl: SSH default seit ~10 Jahren.

### Kanonische JSON-Serialisierung

Vor dem Signieren wird der Payload **kanonisch** stringifiziert:

1. Object-Keys werden rekursiv alphabetisch sortiert
2. Arrays bleiben in Insertion-Order (semantisch bedeutsam)
3. `undefined` wird weggelassen (matches JSON-Spec)
4. BigInt/Symbol/Function werden REJECTED (würden Verifier überraschen)

→ **Same payload, same bytes, every platform, every run.**

### Wire-Format `SignedEnvelope`

```typescript
interface SignedEnvelope<P> {
  payload: P;                                  // original, JSON-serializable
  signatureB64: string;                        // base64-url 64B ed25519-sig
  publicKeyB64: string;                        // base64-url 32B public-key
  signedAt: string;                            // ISO-8601 timestamp
  algorithm: 'ed25519-sha256-canonjson';       // frozen string literal
}
```

Self-contained — Envelope enthält den Public-Key. Trust-anchoring via optionalem `expectedPublicKeyB64`-Argument in `verifyEnvelope` (Attacker-Keypair-Swap-Defense).

### Key-Storage via existing Secret-Store

Yanniks Keypair lebt im `@domains/secrets` SecretStore:

- `claude-os-signing-private-key` (base64-url 32B private-key seed)
- `claude-os-signing-public-key` (base64-url 32B public-key)

Keyring-primary (NAPI-RS), encrypted-file-fallback (per ADR-0004). Private-key wird **niemals geloggt** (per ADR-0004 §51).

### Lifecycle der Keys

| Operation | API | Wann nutzen |
|---|---|---|
| Initial-Create | `loadOrCreateSigningKeypair(store)` | first-time setup, idempotent |
| Read-only public | `readPublicKey(store)` | GUI display, audit-header, doctor-check |
| Rotate | `rotateSigningKeypair(store)` | Compromise-suspected oder neue Identität |

Half-State-Recovery: wenn nur `private` oder nur `public` im Store ist, regeneriert die Foundation einen frischen Keypair — half-state ist Corruption-Signal.

## Public-Core-API

```typescript
import {
  generateEd25519Keypair,
  loadOrCreateSigningKeypair,
  rotateSigningKeypair,
  readPublicKey,
  SIGNING_KEY_NAMES,
  signPayload,
  verifyEnvelope,
  canonicalizeJson,
  importPrivateKey,
  importPublicKey,
  toBase64Url,
  fromBase64Url,
  type Ed25519KeyPair,
  type SignedEnvelope,
  SigningError,
} from '@domains/skill-lifecycle';
```

## Konsumenten

### Phase 5 — Skill-Promotion (ADR-0026)

```typescript
const envelope = signPayload(
  { skillId, diffHash, reviewedAt, classification },
  privateKeyB64,
  publicKeyB64,
);
auditLogger.append({
  kind: 'skill.promote',
  action: 'review-approved',
  details: { skillId, signature: envelope.signatureB64, publicKey: envelope.publicKeyB64 },
});
```

### Phase 7 — MSP-Write-Approval (ADR-0027, claude-os-msp konsumiert)

```typescript
const token = signPayload(
  {
    kind: 'msp.write',
    bridge: 'tanss',
    operation: 'ticket.update',
    customerId,
    diff: { /* before/after */ },
    nonce: randomUUID(),
    expiresAt: ...,
  },
  privateKeyB64,
  publicKeyB64,
);
```

## Konsequenzen

### Positiv

- ADR-0026 Gate 2 ist **implementiert + Vitest-verifiziert** — Self-Improvement-Phase ready sobald Gate 1 (Sandbox, ADR-0034) merged ist
- Phase-7 (MSP-Write) braucht keine eigenständige Crypto-Foundation
- Ed25519 ist Node-built-in — kein extra-Dep
- Deterministisches Signing → reproducable test-fixtures
- Public-Key-im-Envelope → kein external-trust-store-lookup nötig

### Negativ

- **Algorithmus-Lock-in via Literal `ed25519-sha256-canonjson`** — Post-Quantum-Migration wäre eigener Bump. Akzeptabel — Ed25519 ist 10y-safe gegen klassische Compute
- **Private-Key-Exposure beim erstem Generate** — Wert geht durch den SecretStore-Set-Pfad. EncryptedFileStore + Keyring sind ADR-0004-konform; kein Plain-Text-on-Disk

### Konstraints für Folge-Phasen

- **GUI-Approval-Modal** muss `signPayload` aus der Public-Core importieren — eigener Folge-PR mit Tauri-Native-Password-Pattern aus ADR-0023
- **`@domains/approval-token`** Folge-PR baut auf dieser Foundation auf — wrappt `SignedEnvelope` mit MSP-spezifischen Schemas (nonce, expiresAt, scope)

## Alternativen verworfen

- **ECDSA-P256:** ältere/komplexere Wahl, variable signature-length erschwert wire-format-deterministics
- **RSA-2048:** überdimensioniert für lokale Approval-Tokens
- **HMAC mit shared Secret:** keine Identität — wer den Secret hat, kann signieren. Yannik-Identität ist Pflicht-Anforderung
- **JOSE/JWT-Format:** überverbose, viele Optionen die wir nicht brauchen

## Referenzen

- [ADR-0004](0004-secrets-via-napi-rs-keyring.md) — SecretStore-Backend
- [ADR-0023](0023-profile-crud-and-native-password.md) — Native-Password-Pattern für GUI-Approval (Folge-PR)
- [ADR-0026](0026-skill-auto-promotion-lifecycle.md) §"Review-Gate" — die Anforderung
- [ADR-0027](0027-msp-bridge-permission-model.md) §Phase 7 — zweiter Konsument
- [ADR-0034](0034-skill-sandbox-process-isolation.md) — Gate 1
- `src/domains/skill-lifecycle/signing/` — Implementation
