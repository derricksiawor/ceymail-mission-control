import { create } from "zustand";

interface AppState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
  setTheme: (theme: "dark" | "light") => void;
  _hydrated: boolean;
  _hydrate: () => void;
}

function applyTheme(theme: "dark" | "light") {
  if (typeof window === "undefined") return;
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
  localStorage.setItem("mc-theme", theme);
}

export const useAppStore = create<AppState>((set) => ({
  // SSR-safe defaults — always match what the server renders
  sidebarCollapsed: false,
  mobileSidebarOpen: false,
  theme: "dark",
  _hydrated: false,

  _hydrate: () => {
    if (typeof window === "undefined") return;
    let collapsed = false;
    let theme: "dark" | "light" = "dark";
    try {
      collapsed = localStorage.getItem("mc-sidebar-collapsed") === "true";
      const stored = localStorage.getItem("mc-theme");
      if (stored === "light") theme = "light";
    } catch {
      // Storage unavailable
    }
    applyTheme(theme);
    set({ sidebarCollapsed: collapsed, theme, _hydrated: true });
  },

  toggleSidebar: () =>
    set((state) => {
      const next = !state.sidebarCollapsed;
      try { localStorage.setItem("mc-sidebar-collapsed", String(next)); } catch {}
      return { sidebarCollapsed: next };
    }),
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
  toggleTheme: () =>
    set((state) => {
      const next = state.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      return { theme: next };
    }),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));
