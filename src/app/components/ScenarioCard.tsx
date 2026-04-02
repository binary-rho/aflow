import { Link } from "react-router";
import { Globe, X, MoreVertical, Trash2, UserMinus, ClipboardCheck, Loader2 } from "lucide-react";
import type { Scenario, ScenarioGroup } from "../data";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

interface ScenarioCardProps {
  scenario: Scenario;
  onDelete?: (id: string) => void;
  onRemoveFromGroup?: (scenarioId: string, groupId: string) => void;
  onRunValidation?: (scenario: Scenario) => void;
  groups?: ScenarioGroup[];
  /** 그룹 탭일 때만 전달. 이 그룹에서 제거 메뉴 표시용 */
  activeGroupId?: string | null;
  /** 목록 탭 유지: run 페이지에서 뒤로가기 시 복원용 */
  linkState?: Record<string, unknown>;
  validationProgress?: {
    currentStep: number;
    totalSteps: number;
    status: "running" | "paused";
  } | null;
}

export function ScenarioCard({
  scenario,
  onDelete,
  onRemoveFromGroup,
  onRunValidation,
  groups = [],
  activeGroupId = null,
  linkState,
  validationProgress = null,
}: ScenarioCardProps) {
  const hostForHint = scenario.urlPattern.replace("flux.app", "");
  /** 첫 스텝 nav.goto: 경로만 저장하는 모델 → 카드에는 경로만 표시(호스트는 urlPattern에만). */
  const startingPath = (() => {
    const first = scenario.steps[0];
    if (!first || first.actionId !== "nav.goto") return null;
    const url = first.params?.url;
    if (url == null || url === "") return null;
    const s = String(url).trim().replace(/^https?:\/\//, "");
    const slashIdx = s.indexOf("/");
    const pathOnly =
      slashIdx >= 0 && /\./.test(s.slice(0, slashIdx)) ? s.slice(slashIdx) : s.startsWith("/") ? s : `/${s}`;
    return pathOnly;
  })();
  const pathStr = startingPath != null ? String(startingPath).trim() : "";
  const hasPathStart = pathStr.length > 0;
  const displayUrl = hasPathStart
    ? pathStr.startsWith("/")
      ? pathStr
      : `/${pathStr}`
    : hostForHint;
  const displayTitle = hasPathStart
    ? `${hostForHint.replace(/\/$/, "")}${displayUrl}`
    : displayUrl;

  const raw =
    Array.isArray(scenario.groupIds)
      ? scenario.groupIds
      : typeof (scenario as any).groupIds === "string"
        ? [(scenario as any).groupIds]
        : [];
  const legacyId = (scenario as any).groupId;
  const allGroupIds =
    legacyId && !raw.includes(legacyId) ? [...raw, legacyId] : raw;

  const groupTags = allGroupIds
    .map((id) => {
      const name = groups.find((g) => g.id === id)?.name;
      return name ? { id, name } : null;
    })
    .filter((t): t is { id: string; name: string } => t != null);

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("정말 삭제하시겠습니까?")) return;
    onDelete?.(scenario.id);
  };

  const handleRemoveFromGroupClick = (groupId: string) => {
    if (!confirm("이 시나리오를 이 그룹에서 제거할까요?")) return;
    onRemoveFromGroup?.(scenario.id, groupId);
  };

  const canRemoveFromActiveGroup =
    activeGroupId &&
    (allGroupIds.includes(activeGroupId) || legacyId === activeGroupId);

  const handleValidationOnly = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (validationProgress) return;
    onRunValidation?.(scenario);
  };

  const progressText = validationProgress
    ? `${Math.min(validationProgress.currentStep, validationProgress.totalSteps)}/${validationProgress.totalSteps}`
    : "검증";

  return (
    <Link
      to={`/run/${scenario.id}`}
      state={linkState}
      className="block relative bg-white rounded-lg border border-[var(--flux-border-light)] hover:border-[var(--flux-primary)] transition-all p-3 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)] hover:shadow-md group"
    >
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        {onRunValidation && (
          <button
            type="button"
            onClick={handleValidationOnly}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={Boolean(validationProgress)}
            className="flex items-center gap-1 px-1.5 py-1 rounded text-[10px] font-medium text-[var(--flux-text-muted)] hover:text-[var(--flux-primary)] hover:bg-[var(--flux-primary-muted)] transition-colors disabled:opacity-80 disabled:cursor-default"
            title="이동·클릭 없이 순차 검사만 실행. 검사 중인 탭에서 각 스텝의 요소 존재 여부를 확인합니다."
            aria-label="검증"
          >
            {validationProgress ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <ClipboardCheck className="w-3 h-3" />
            )}
            {progressText}
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.preventDefault()}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-7 h-7 flex items-center justify-center rounded text-[var(--flux-text-muted)] hover:text-[var(--flux-primary)] hover:bg-[var(--flux-primary-muted)] transition-colors"
              title="메뉴"
              aria-label="메뉴"
            >
              <MoreVertical className="w-3.5 h-3.5 stroke-[2.5]" />
            </button>
          </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()} className="text-xs min-w-[8rem]">
          {canRemoveFromActiveGroup && onRemoveFromGroup && activeGroupId && (
            <DropdownMenuItem
              className="text-xs py-1.5"
              onSelect={(e) => {
                e.preventDefault();
                handleRemoveFromGroupClick(activeGroupId);
              }}
            >
              <UserMinus className="w-3.5 h-3.5" />
              이 그룹에서 제거
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            className="text-xs py-1.5"
            onSelect={(e) => {
              e.preventDefault();
              if (!confirm("정말 삭제하시겠습니까?")) return;
              onDelete?.(scenario.id);
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            시나리오 삭제
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>

      <h3
        className="font-semibold text-[var(--flux-text-default)] text-sm leading-snug truncate pr-24"
        title={scenario.title}
      >
        {scenario.title}
        {scenario.followUpScenarioId ? (
          <span className="ml-1.5 text-[9px] font-semibold text-violet-600 align-middle">
            후속
          </span>
        ) : null}
      </h3>

      <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-[var(--flux-text-muted)] font-mono mt-1 mb-2 group-hover:text-gray-600 transition-colors">
        <Globe className="w-3 h-3 shrink-0" />
        <span className="truncate min-w-0" title={displayTitle}>
          {displayUrl}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-[var(--flux-border-light)]">
        {groupTags.map(({ id, name }) => (
          <span
            key={id}
            className="group/tag relative inline-flex items-center text-[10px] text-[var(--flux-primary)] bg-[var(--flux-primary-muted)] pl-1.5 py-0.5 rounded border border-[var(--flux-border-light)] hover:bg-[var(--flux-primary-muted)] hover:text-[var(--flux-primary)] transition-[padding] pr-1.5 group-hover/tag:pr-5"
          >
            {name}
            {onRemoveFromGroup && (
              <button
                type="button"
                className="absolute right-0.5 top-1/2 -translate-y-1/2 opacity-0 group-hover/tag:opacity-100 w-4 h-4 flex items-center justify-center p-0 rounded hover:bg-[var(--flux-primary)] hover:text-white transition-opacity"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!confirm("이 시나리오를 이 그룹에서 제거할까요?")) return;
                  onRemoveFromGroup(scenario.id, id);
                }}
                title="그룹에서 제거"
                aria-label={`${name} 그룹에서 제거`}
              >
                <X className="w-2.5 h-2.5 stroke-[2.5]" />
              </button>
            )}
          </span>
        ))}
        {scenario.tags.map((tag) => (
          <span
            key={tag}
            className="text-[10px] text-[var(--flux-text-muted)] bg-[var(--flux-bg-subtle)] px-1.5 py-0.5 rounded border border-[var(--flux-border-light)] group-hover:bg-[var(--flux-primary-muted)] group-hover:text-[var(--flux-primary)] transition-colors"
          >
            {tag === "직접생성" ? tag : `#${tag}`}
          </span>
        ))}
      </div>
    </Link>
  );
}
