/**
 * 项目状态。
 */
import { create } from 'zustand';
import type { ProjectSummary, ProjectCreateResult, ProjectDeleteResult } from '@shared/types/project';

interface ProjectState {
  projects: ProjectSummary[];
  currentProjectId: string | null;
  loadProjects: () => Promise<void>;
  createProject: (name: string, options?: { location?: string }) => Promise<ProjectCreateResult>;
  deleteProject: (id: string) => Promise<ProjectDeleteResult>;
  selectProject: (id: string | null) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProjectId: null,

  loadProjects: async () => {
    try {
      const result = await window.electron.project.list();
      set({ projects: result.projects });
    } catch {
      set({ projects: [] });
    }
  },

  createProject: async (name, options) => {
    const result = await window.electron.project.create({
      name,
      location: options?.location,
    });
    if (result.success && result.projectId) {
      await useProjectStore.getState().loadProjects();
      set({ currentProjectId: result.projectId });
    }
    return result;
  },

  deleteProject: async (id) => {
    const result = await window.electron.project.delete({ projectId: id, confirm: true });
    if (result.success) {
      await useProjectStore.getState().loadProjects();
      // 删除的是当前项目 → 回到项目选择（欢迎页）
      if (useProjectStore.getState().currentProjectId === id) {
        set({ currentProjectId: null });
      }
    }
    return result;
  },

  selectProject: (id) => set({ currentProjectId: id }),
}));
