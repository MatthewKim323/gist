// The case menu is a backdrop only, so it ships with no cards.
export type ProjectEntry = {
  project: {
    "0internal_or_external": string;
    title: string;
    description: string;
    link?: string;
    bg_color?: string;
    light_mode?: boolean;
    project_grid_category: string[] | false;
    banner?: { label: string; event: string };
  };
  images: { name: string; image: string; image_size: [number, number]; type: string; position: { x: number; y: number; z: number } }[];
  videos: false | unknown[];
  models: false | unknown[];
};

export function ensureProjects(): ProjectEntry[] {
  if (!window.projects) window.projects = [];
  return window.projects;
}
