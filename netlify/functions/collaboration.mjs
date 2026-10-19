import { getStore } from '@netlify/blobs';
import { createCollaborationHandler } from '../lib/collaboration.mjs';

export default async request => createCollaborationHandler({
  store: getStore({ name: 'commyweb-collaboration-v1', consistency: 'strong' })
})(request);
