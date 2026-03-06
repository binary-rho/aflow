import type { ScenarioGroup } from "@/app/data";

const STORAGE_KEY = "flux_groups";

function readAll(): ScenarioGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(groups: ScenarioGroup[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
}

export function getGroups(): ScenarioGroup[] {
  return readAll();
}

export function saveGroup(group: ScenarioGroup): void {
  const all = readAll();
  const idx = all.findIndex((g) => g.id === group.id);
  if (idx >= 0) all[idx] = group;
  else all.push(group);
  writeAll(all);
}

export function createGroup(name: string): ScenarioGroup {
  const group: ScenarioGroup = {
    id: `grp_${Date.now()}`,
    name: name.trim() || "새 그룹",
  };
  saveGroup(group);
  return group;
}

export function deleteGroup(id: string): void {
  writeAll(readAll().filter((g) => g.id !== id));
}
