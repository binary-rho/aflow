import type { Scenario } from "@/app/data";

const STORAGE_KEY = "flux_scenarios";

function readAll(): Scenario[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(scenarios: Scenario[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
}

/** 레거시 groupId를 groupIds로 합치고, 저장용 객체에서 groupId 제거 (더 이상 저장하지 않음) */
function normalizeForSave(scenario: Scenario & { groupId?: string }): Scenario {
  const groupIds =
    scenario.groupIds ??
    (scenario.groupId ? [scenario.groupId] : []);
  const { groupId: _removed, ...rest } = scenario;
  return { ...rest, groupIds };
}

export function getScenarios(): Scenario[] {
  return readAll();
}

export function getScenarioById(id: string): Scenario | undefined {
  return readAll().find((s) => s.id === id);
}

export function saveScenario(scenario: Scenario & { groupId?: string }): void {
  const toSave = normalizeForSave(scenario);
  const all = readAll();
  const existingIndex = all.findIndex((s) => s.id === toSave.id);
  if (existingIndex >= 0) {
    all[existingIndex] = toSave;
  } else {
    all.push(toSave);
  }
  writeAll(all);
}

export function deleteScenario(id: string): void {
  writeAll(readAll().filter((s) => s.id !== id));
}

export function reorderScenarios(fromIndex: number, toIndex: number): void {
  const all = readAll();
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= all.length || toIndex >= all.length) return;
  const [moved] = all.splice(fromIndex, 1);
  all.splice(toIndex, 0, moved);
  writeAll(all);
}
