/**
 * 项目状态。
 */
import { create } from 'zustand';
import type { ProjectSummary, ProjectCreateResult } from '@shared/types/project';

interface ProjectState {
  projects: ProjectSummary[];
  currentProjectId: string | null;
  loadProjects: () => Promise<void>;
  createProject: (name: string, options?: { location?: string }) => Promise<ProjectCreateResult>;
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

  selectProject: (id) => set({ currentProjectId: id }),
}));
