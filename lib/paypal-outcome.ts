// A payout endpoint failure is not proof that money did not move.
// Only a failure explicitly raised before the payout request is safe to retry.
// Keep all provider submission failures reserved pending reconciliation.
export type SubmitOutcome='FAILED'|'UNKNOWN'|'RETRY';

export function classifyPayPalSubmitError(error:unknown):SubmitOutcome{
 const message=error instanceof Error?error.message:'';
 if(message==='paypal_credentials_missing'||/^paypal_oauth_(?:\d{3}|token_missing)$/.test(message))return 'RETRY';
 return 'UNKNOWN';
}
