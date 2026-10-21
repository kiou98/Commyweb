export interface Author {
  id: string;
  username: string;
  name?: string;
  email?: string;
  avatarUrl: string;
}

export interface ProjectMember {
  id: string;
  email: string;
  role: 'owner' | 'member';
  status: 'active' | 'revoked';
  addedAt: string;
  addedBy: string;
  authCode: string; // Secret verification token
}

export interface ProjectSecurityPolicy {
  urlHash: string;
  url: string;
  ownerEmail?: string;
  members: ProjectMember[];
}

export interface WebComment {
  id: string;
  url: string;
  urlHash: string;
  anchor: AnchorData;
  author: Author;
  content: string;
  status: 'open' | 'resolved';
  createdAt: string;
  updatedAt?: string;
  replies: CommentReply[];
  issueNumber?: number;
  issueUrl?: string;
}

export interface AnchorData {
  selector: string;
  xpath?: string;
  xPercent: number;
  yPercent: number;
  textSnippet?: string;
  scrollOffset?: { x: number; y: number };
}

export interface CommentReply {
  id: string;
  author: Author;
  content: string;
  createdAt: string;
}

export interface SiteProject {
  domain: string;
  repo: string;
  name?: string;
  token?: string;
  updatedAt?: string;
}

export interface UserSettings {
  githubToken?: string;
  storageRepo?: string;
  isCommentModeActive?: boolean;
  filterStatus?: 'all' | 'open' | 'resolved';
  userEmail?: string;
  userRole?: 'admin' | 'collaborator';
  projectsByDomain?: Record<string, SiteProject>;
}

export interface ExtensionMessage {
  type: 
    | 'TOGGLE_COMMENT_MODE'
    | 'GET_COMMENT_MODE'
    | 'GET_PAGE_COMMENTS'
    | 'MARK_MESSAGES_READ'
    | 'ADD_COMMENT'
    | 'UPDATE_COMMENT_ANCHOR'
    | 'ADD_REPLY'
    | 'RESOLVE_COMMENT'
    | 'REOPEN_COMMENT'
    | 'FOCUS_COMMENT'
    | 'NAVIGATE_OR_FOCUS_COMMENT'
    | 'SYNC_COMMENTS'
    | 'USER_SETTINGS_UPDATED'
    | 'INVITE_MEMBER'
    | 'REVOKE_MEMBER'
    | 'GET_MEMBERS'
    | 'VALIDATE_JOIN_CODE'
    | 'AUTO_CONFIGURE_PROJECT'
    | 'GET_SITE_PROJECTS'
    | 'SAVE_SITE_PROJECT'
    | 'DELETE_SITE_PROJECT';
  payload?: any;
}
