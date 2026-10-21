import { CollaborationAccess, UserSettings } from '../types';

export const COLLABORATION_ENDPOINT = 'https://commyweb.neonea.nc/.netlify/functions/collaboration';
export const isUserEdition = () => chrome.runtime.getManifest().name === 'Commyweb (Utilisateur)';
export const newAccessSecret = () => [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');

export async function collaborationRequest(action: string, access: CollaborationAccess, payload: Record<string, unknown> = {}) {
  const response = await fetch(COLLABORATION_ENDPOINT, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access.secret}` },
    body: JSON.stringify({ ...payload, action, projectId: access.projectId }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || 'Le service d’invitation est indisponible. Réessayez.');
  }
  return response;
}

export function hasProjectAccess(settings: UserSettings) {
  return !!(settings.storageRepo && (settings.githubToken || settings.collaboration?.role === 'collaborator'));
}
