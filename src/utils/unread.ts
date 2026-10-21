import { Author, WebComment } from '../types';

export const READ_MESSAGES_KEY = 'commyweb_read_messages';
export function messageKeys(comment: WebComment, user?: Author, userEmail?: string): string[] {
  const own = (author: Author) => Boolean(user && (
    (user.id && user.id !== 'anonymous' && author.id === user.id) ||
    (user.email && author.email?.toLowerCase() === user.email.toLowerCase())
  ) || (userEmail && author.email?.toLowerCase() === userEmail.toLowerCase()));
  return [
    ...(!own(comment.author) ? [comment.urlHash + ':' + comment.id] : []),
    ...(comment.replies || []).filter(reply => !own(reply.author))
      .map(reply => comment.urlHash + ':' + comment.id + ':' + reply.id)
  ];
}
export function unreadKeys(comment: WebComment, read: Set<string>, user?: Author, userEmail?: string): string[] {
  return messageKeys(comment, user, userEmail).filter(key => !read.has(key));
}

export function compareConversations(a: WebComment, b: WebComment, read: Set<string>, user?: Author, userEmail?: string): number {
  const priority = Number(unreadKeys(b, read, user, userEmail).length > 0) -
    Number(unreadKeys(a, read, user, userEmail).length > 0);
  const latest = (comment: WebComment) => Math.max(...[comment, ...(comment.replies || [])]
    .map(message => new Date(message.createdAt).getTime()));
  return priority || latest(b) - latest(a);
}
