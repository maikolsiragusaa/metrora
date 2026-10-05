/**
 * Renderer-safe pairing and local-share contract types (mirror of
 * src/sharing/share-controller.ts): only outcome classes, names, and dates
 * cross the bridge — never tokens or fingerprints.
 */

export type PendingPairing = { id: string; name: string; code: string }
export type PairedPeerSummary = { name: string; pairedAt: number }
/**
 * Terminal outcome of one approve-flow pairing request, confirmed for the
 * specific request id. Only the outcome class crosses the bridge, never
 * tokens or fingerprints.
 */
export type PairingOutcome = 'paired' | 'declined' | 'expired' | 'persist-failed' | 'unknown'
export type ShareStatus = { sharing: boolean; name: string; port: number; host: string | null; addresses: string[]; connectPayload: string | null; networkWarning?: string; always: boolean; peers: number; peerList?: PairedPeerSummary[]; pending: PendingPairing[] }
export type ApprovePairingResult = { status: ShareStatus; outcome: PairingOutcome }
