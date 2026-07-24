import { useAuthStore } from "../store/authStore";

export class ApiError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { token } = useAuthStore.getState();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  let response = await fetch(`/api${url}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  // 401 → attempt token refresh → retry once
  if (response.status === 401 && token) {
    const refreshResponse = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });

    if (refreshResponse.ok) {
      const data: { token: string; user: { id: number; username: string } } =
        await refreshResponse.json();
      useAuthStore.getState().login(data.token, data.user);

      // Retry original request with fresh token
      headers["Authorization"] = `Bearer ${data.token}`;
      response = await fetch(`/api${url}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } else {
      useAuthStore.getState().logout();
      throw new ApiError(401, "Session expired");
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, text || response.statusText);
  }

  // 204 No Content — return undefined cast
  if (response.status === 204) return undefined as T;

  return response.json() as Promise<T>;
}

export const api = {
  get<T>(url: string): Promise<T> {
    return request<T>(url, { method: "GET" });
  },

  post<T>(url: string, body?: unknown): Promise<T> {
    return request<T>(url, { method: "POST", body });
  },

  put<T>(url: string, body?: unknown): Promise<T> {
    return request<T>(url, { method: "PUT", body });
  },

  patch<T>(url: string, body?: unknown): Promise<T> {
    return request<T>(url, { method: "PATCH", body });
  },

  delete<T>(url: string): Promise<T> {
    return request<T>(url, { method: "DELETE" });
  },
};

// ── Kanban types ────────────────────────────────────────────────────────────

export interface KanbanBoardListItem {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  columns: Array<{
    id: string;
    name: string;
    position: number;
    color: string | null;
    taskCount: number;
  }>;
}

export interface KanbanTaskItem {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  position: number;
  dueDate: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface KanbanColumnWithTasks {
  id: string;
  boardId: string;
  name: string;
  position: number;
  color: string | null;
  createdAt: string;
  tasks: KanbanTaskItem[];
}

export interface KanbanBoardWithColumns {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  columns: KanbanColumnWithTasks[];
}

// ── Kanban API ──────────────────────────────────────────────────────────────

export const kanbanApi = {
  listBoards(): Promise<KanbanBoardListItem[]> {
    return api.get("/kanban/boards");
  },

  getBoard(id: string): Promise<KanbanBoardWithColumns> {
    return api.get(`/kanban/boards/${encodeURIComponent(id)}`);
  },

  createBoard(data: { name: string; description?: string | null }): Promise<KanbanBoardWithColumns> {
    return api.post("/kanban/boards", data);
  },

  updateBoard(id: string, data: { name?: string; description?: string | null }): Promise<KanbanBoardWithColumns> {
    return api.put(`/kanban/boards/${encodeURIComponent(id)}`, data);
  },

  deleteBoard(id: string): Promise<{ message: string }> {
    return api.delete(`/kanban/boards/${encodeURIComponent(id)}`);
  },

  createColumn(boardId: string, data: { name: string; color?: string | null }): Promise<KanbanColumnWithTasks> {
    return api.post(`/kanban/boards/${encodeURIComponent(boardId)}/columns`, data);
  },

  createTask(boardId: string, columnId: string, data: {
    title: string;
    description?: string | null;
    dueDate?: string | null;
    tags?: string[];
  }): Promise<KanbanTaskItem> {
    return api.post(`/kanban/boards/${encodeURIComponent(boardId)}/columns/${encodeURIComponent(columnId)}/tasks`, data);
  },

  moveTask(taskId: string, data: { targetColumnId: string; targetPosition?: number }): Promise<KanbanTaskItem> {
    return api.patch(`/kanban/tasks/${encodeURIComponent(taskId)}/move`, data);
  },

  updateTask(taskId: string, data: {
    title?: string;
    description?: string | null;
    dueDate?: string | null;
    tags?: string[];
  }): Promise<KanbanTaskItem> {
    return api.put(`/kanban/tasks/${encodeURIComponent(taskId)}`, data);
  },

  deleteTask(taskId: string): Promise<{ message: string }> {
    return api.delete(`/kanban/tasks/${encodeURIComponent(taskId)}`);
  },
};
