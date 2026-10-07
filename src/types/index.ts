export interface Author {
  id: string;
  username: string;
  name?: string;
  avatarUrl: string;
}

export interface AnchorData {
  selector: string;
  xpath?: string;
  xPercent: number; // 0.0 to 1.0 relative to target element width
  yPercent: number; // 0.0 to 1.0 relative to target element height
  textSnippet?: string; // surrounding text for resilient recovery
  scrollOffset?: { x: number; y: number };
}

export interface CommentReply {
  id: string;
  author: Author;
  content: string;
  createdAt: string; // ISO string
}

export interface WebComment {
  id: string;
  url: string; // Normalized page URL
  urlHash: string; // MD5/SHA hash of normalized URL
  anchor: AnchorData;
  author: Author;
  content: string;
  status: 'open' | 'resolved';
  createdAt: string; // ISO string
  updatedAt?: string;
  replies: CommentReply[];
}

export interface UserSettings {
  githubToken?: string;
  storageRepo?: string; // e.g. "myorg/website-comments"
  isCommentModeActive?: boolean;
  filterStatus?: 'all' | 'open' | 'resolved';
}

export interface ExtensionMessage {
  type: 
    | 'TOGGLE_COMMENT_MODE'
    | 'GET_COMMENT_MODE'
    | 'GET_PAGE_COMMENTS'
    | 'ADD_COMMENT'
    | 'ADD_REPLY'
    | 'RESOLVE_COMMENT'
    | 'REOPEN_COMMENT'
    | 'FOCUS_COMMENT'
    | 'SYNC_COMMENTS'
    | 'USER_SETTINGS_UPDATED';
  payload?: any;
}
