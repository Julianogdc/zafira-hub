export interface AsanaUser {
    gid: string;
    name: string;
    photo: { image_60x60: string } | null;
    workspaces?: { gid: string; name: string }[];
}

export interface AsanaProject {
    gid: string;
    name: string;
    color: string;
    layout?: 'board' | 'list';
}

export interface AsanaSection {
    gid: string;
    name: string;
}

export interface AsanaTask {
    gid: string;
    name: string;
    due_on: string | null;
    due_at: string | null;
    completed: boolean;
    projects: { gid: string; name: string; color: string }[];
    memberships?: { project: { gid: string; name: string }; section: { gid: string; name: string } }[];
    assignee?: { gid: string; name: string; photo: { image_60x60: string } | null };
    notes?: string;
    html_notes?: string;
    permalink_url?: string;
}

export interface AsanaStory {
    gid: string;
    created_at: string;
    text: string;
    html_text?: string;
    created_by: { gid: string; name: string; photo: { image_60x60: string } | null };
    type: 'system' | 'comment';
}

export interface AsanaNotification {
    gid: string;
    created_at: string;
    type: string;
    resource: { name: string };
    parent: { name: string };
    created_by: { name: string };
}

export interface AsanaAttachment {
    gid: string;
    name: string;
    resource_subtype: string;
    view_url: string;
    permanent_url: string;
    download_url: string;
    created_by?: { gid: string; name: string };
    parent?: { gid: string; name: string; resource_type: string };
}
