import axios from 'axios';
import { AsanaUser, AsanaProject, AsanaTask, AsanaStory, AsanaSection, AsanaNotification } from '../types/asana';

import { useAuthStore } from '@/store/useAuthStore';

// PKCE Helpers
function generateCodeVerifier() {
  const array = new Uint8Array(32);
  window.crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

function generateCodeChallenge(verifier: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  return window.crypto.subtle.digest('SHA-256', data).then(buffer => {
    return base64UrlEncode(new Uint8Array(buffer));
  });
}

function base64UrlEncode(array: Uint8Array) {
  return btoa(String.fromCharCode.apply(null, Array.from(array)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const asanaApi = axios.create({
  baseURL: 'https://app.asana.com/api/1.0',
  headers: {
    'Content-Type': 'application/json',
  },
});

// OAuth Constants
const CLIENT_ID = import.meta.env.VITE_ASANA_CLIENT_ID;
const CLIENT_SECRET = import.meta.env.VITE_ASANA_CLIENT_SECRET;
const REDIRECT_URI = window.location.origin + '/auth/callback/asana';


// Interceptor para adicionar o token dinamicamente
asanaApi.interceptors.request.use((config) => {
  const storeToken = useAuthStore.getState().user?.asanaAccessToken;
  const envToken = import.meta.env.VITE_ASANA_ACCESS_TOKEN;

  // Prefer store token (Personal), fallback to env (System)
  const finalToken = storeToken || envToken;

  if (finalToken) {
    config.headers.Authorization = `Bearer ${finalToken}`;
  }
  return config;
});


// Cache for workspace ID to avoid repeated fetching
let _cachedWorkspaceId: string | null = localStorage.getItem('asana_last_workspace_id');
let _currentUser: AsanaUser | null = null;

export const asanaService = {
  // Helper to get workspace ID (cached or fresh)
  getWorkspaceId: async (): Promise<string> => {
    if (_cachedWorkspaceId) return _cachedWorkspaceId;

    // If we don't have the workspace, we fetch the user to get it
    const user = await asanaService.getMe();
    const workspaceId = user.workspaces?.[0]?.gid;

    if (!workspaceId) {
      throw new Error("Usuário não possui workspaces no Asana.");
    }

    _cachedWorkspaceId = workspaceId;
    return workspaceId;
  },

  // Helper to force set a workspace (if we implement workspace switching later)
  setWorkspaceId: (gid: string) => {
    _cachedWorkspaceId = gid;
    localStorage.setItem('asana_last_workspace_id', gid); // Persist preference
  },

  getWorkspaces: async (): Promise<any[]> => {
    const user = await asanaService.getMe();
    return user.workspaces || [];
  },

  getMe: async (): Promise<AsanaUser> => {
    if (_currentUser) return _currentUser;
    const r = await asanaApi.get('/users/me');
    _currentUser = r.data.data;
    // Auto-set workspace if not set
    if (!_cachedWorkspaceId && _currentUser?.workspaces?.[0]?.gid) {
      _cachedWorkspaceId = _currentUser.workspaces[0].gid;
    }
    return r.data.data;
  },

  getWorkspaceUsers: async (): Promise<AsanaUser[]> => {
    const w = await asanaService.getWorkspaceId();
    const r = await asanaApi.get(`/workspaces/${w}/users`, { params: { opt_fields: 'name,photo.image_60x60' } });
    return r.data.data;
  },

  getProjects: async (): Promise<AsanaProject[]> => {
    const w = await asanaService.getWorkspaceId();
    const r = await asanaApi.get('/projects', { params: { workspace: w, archived: false, opt_fields: 'name,color,layout' } });
    return r.data.data;
  },

  createProject: async (name: string, workspaceGid: string, color?: string): Promise<AsanaProject> => {
    const r = await asanaApi.post('/projects', { data: { name, workspace: workspaceGid, color: color || 'light-blue' } });
    return r.data.data;
  },

  getMyTasks: async (): Promise<AsanaTask[]> => {
    const w = await asanaService.getWorkspaceId();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const r = await asanaApi.get('/tasks', {
      params: {
        assignee: 'me',
        workspace: w,
        completed_since: thirtyDaysAgo.toISOString(),
        limit: 100,
        opt_fields: 'name,due_on,due_at,completed,projects.name,projects.color,assignee.name,assignee.photo'
      }
    });
    return r.data.data;
  },

  getTasksByProject: async (gid: string): Promise<AsanaTask[]> => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const r = await asanaApi.get(`/projects/${gid}/tasks`, {
      params: {
        opt_fields: 'name,completed,gid,memberships.section.gid,memberships.section.name,memberships.project.gid,assignee.name,assignee.photo,due_on'
      }
    });
    return r.data.data;
  },

  getTaskDetails: async (gid: string): Promise<AsanaTask> => {
    const r = await asanaApi.get(`/tasks/${gid}`, { params: { opt_fields: 'name,notes,html_notes,due_on,due_at,completed,projects.name,projects.color,permalink_url,assignee.name,assignee.photo,assignee.gid,memberships.section.gid,memberships.project.gid' } });
    return r.data.data;
  },

  // --- SECTIONS ---
  getSections: async (projectGid: string): Promise<AsanaSection[]> => {
    const r = await asanaApi.get(`/projects/${projectGid}/sections`, {
      params: { opt_fields: 'name' }
    });
    return r.data.data;
  },

  addTaskToSection: async (taskGid: string, sectionGid: string) => {
    const r = await asanaApi.post(`/sections/${sectionGid}/addTask`, {
      data: { task: taskGid }
    });
    return r.data.data;
  },

  getTaskStories: async (gid: string): Promise<AsanaStory[]> => {
    const r = await asanaApi.get(`/tasks/${gid}/stories`, {
      params: { opt_fields: 'created_at,text,html_text,type,created_by.gid,created_by.name,created_by.photo' }
    });
    return r.data.data;
  },

  getNotifications: async (): Promise<AsanaNotification[]> => {
    try {
      const w = await asanaService.getWorkspaceId();
      const r = await asanaApi.get('/notifications', {
        params: {
          workspace: w,
          limit: 20,
          opt_fields: 'created_at,type,resource.name,parent.name,created_by.name'
        }
      });
      return r.data.data;
    } catch (error) {
      console.warn("Notificações não disponíveis ou sem permissão.");
      return [];
    }
  },

  addComment: async (gid: string, html_text: string) => { const r = await asanaApi.post(`/tasks/${gid}/stories`, { data: { html_text } }); return r.data.data; },

  deleteComment: async (gid: string) => { await asanaApi.delete(`/stories/${gid}`); },

  updateTask: async (gid: string, data: any) => {
    const r = await asanaApi.put(`/tasks/${gid}`, { data });
    return r.data.data;
  },

  addTaskProject: async (taskGid: string, projectGid: string) => {
    await asanaApi.post(`/tasks/${taskGid}/addProject`, { data: { project: projectGid } });
  },

  removeTaskProject: async (taskGid: string, projectGid: string) => {
    await asanaApi.post(`/tasks/${taskGid}/removeProject`, { data: { project: projectGid } });
  },

  updateComment: async (gid: string, html_text: string) => { const r = await asanaApi.put(`/stories/${gid}`, { data: { html_text } }); return r.data.data; },
  completeTask: async (gid: string, completed: boolean) => { const r = await asanaApi.put(`/tasks/${gid}`, { data: { completed } }); return r.data.data; },
  getProjectSections: async (gid: string): Promise<AsanaSection[]> => {
    const r = await asanaApi.get(`/sections`, {
      params: {
        project: gid,
        opt_fields: 'name'
      }
    });
    return r.data.data;
  },
  moveTaskToSection: async (task: string, section: string) => { const r = await asanaApi.post(`/sections/${section}/addTask`, { data: { task } }); return r.data.data; },
  createSection: async (project: string, name: string): Promise<AsanaSection> => { const r = await asanaApi.post(`/projects/${project}/sections`, { data: { name } }); return r.data.data; },
  updateSection: async (section: string, name: string) => { const r = await asanaApi.put(`/sections/${section}`, { data: { name } }); return r.data.data; },
  deleteSection: async (section: string) => { await asanaApi.delete(`/sections/${section}`); },
  deleteTask: async (taskGid: string) => { await asanaApi.delete(`/tasks/${taskGid}`); },

  createFullTask: async (data: {
    name: string,
    due_on?: string,
    due_at?: string,
    assignee?: string,
    projects?: string[],
    notes?: string,
    html_notes?: string
  }): Promise<AsanaTask> => {
    const w = await asanaService.getWorkspaceId();

    const payload: any = {
      name: data.name,
      workspace: w,
      assignee: data.assignee || 'me',
      projects: data.projects || [],
      notes: data.notes || "",
      html_notes: data.html_notes || undefined
    };

    if (data.due_at) {
      payload.due_at = data.due_at;
    } else if (data.due_on) {
      payload.due_on = data.due_on;
    }

    const response = await asanaApi.post('/tasks', { data: payload });
    return response.data.data;
  },


  // --- SUBTASKS ---
  getSubtasks: async (taskGid: string): Promise<AsanaTask[]> => {
    const r = await asanaApi.get(`/tasks/${taskGid}/subtasks`, {
      params: {
        opt_fields: 'name,completed,due_on,due_at,assignee.name,assignee.photo'
      }
    });
    return r.data.data;
  },

  createSubtask: async (parentGid: string, name: string): Promise<AsanaTask> => {
    const w = await asanaService.getWorkspaceId();
    const r = await asanaApi.post(`/tasks/${parentGid}/subtasks`, {
      data: {
        name,
        workspace: w,
        assignee: 'me'
      }
    });
    return r.data.data;
  },

  // --- ATTACHMENTS ---
  getAttachments: async (taskGid: string) => {
    const r = await asanaApi.get(`/tasks/${taskGid}/attachments`, {
      params: { opt_fields: 'name,download_url,permanent_url,view_url,resource_subtype,created_by.name,created_by.gid' }
    });
    return r.data.data;
  },

  uploadAttachment: async (taskGid: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const r = await asanaApi.post(`/tasks/${taskGid}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      params: { opt_fields: 'name,download_url,permanent_url,view_url,resource_subtype,created_by.name,created_by.gid' }
    });
    return r.data.data;
  },

  getAttachmentUrl: async (gid: string): Promise<string | null> => {
    try {
      const r = await asanaApi.get(`/attachments/${gid}`, {
        params: { opt_fields: 'view_url,permanent_url' }
      });
      return r.data.data.view_url || r.data.data.permanent_url || null;
    } catch (e) { return null; }
  },

  // --- OAUTH FLOW ---
  initiateAuth: async () => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);

    // Store verifier for later
    localStorage.setItem('asana_code_verifier', verifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: import.meta.env.VITE_ASANA_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      state: 'state_token_random',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      // 'default' = Usa a configuração do Console (que agora é 'Permissões Completas')
      scope: 'default',
    });

    // Open in new window for popup experience (OOB)
    window.open(`https://app.asana.com/-/oauth_authorize?${params.toString()}`, '_blank', 'width=600,height=700');
  },

  exchangeCode: async (code: string) => {
    const verifier = localStorage.getItem('asana_code_verifier');
    if (!verifier) throw new Error("No code verifier found");

    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('client_id', CLIENT_ID);
    params.append('redirect_uri', REDIRECT_URI);
    params.append('code', code);
    params.append('code_verifier', verifier);

    if (CLIENT_SECRET) {
      params.append('client_secret', CLIENT_SECRET);
    }

    // Required by Asana endpoint
    const response = await axios.post('https://app.asana.com/-/oauth_token', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    localStorage.removeItem('asana_code_verifier');
    return response.data; // { access_token, refresh_token, data: { ...user } }
  },

  refreshToken: async (refreshToken: string) => {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', CLIENT_ID);
    params.append('redirect_uri', REDIRECT_URI);
    params.append('refresh_token', refreshToken);

    if (CLIENT_SECRET) {
      params.append('client_secret', CLIENT_SECRET);
    }

    const response = await axios.post('https://app.asana.com/-/oauth_token', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return response.data;
  }
};

// Response Interceptor for Token Refresh
asanaApi.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const { user, updateProfile } = useAuthStore.getState();

      if (user?.asanaRefreshToken) {
        try {
          const data = await asanaService.refreshToken(user.asanaRefreshToken);
          await updateProfile({
            asanaAccessToken: data.access_token,
            // Refresh token might rotate, update if present
            asanaRefreshToken: data.refresh_token || user.asanaRefreshToken
          });

          originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
          return asanaApi(originalRequest);
        } catch (refreshError) {
          // Refresh failed, logout/disconnect
          console.error("Token refresh failed", refreshError);
          // Optional: clear tokens
          // await updateProfile({ asanaAccessToken: "", asanaRefreshToken: "" });
        }
      }
    }
    return Promise.reject(error);
  }
);

