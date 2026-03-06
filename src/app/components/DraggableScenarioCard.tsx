import { useRef } from "react";
import { useDrag, useDrop } from "react-dnd";
import { GripVertical } from "lucide-react";
import { ScenarioCard } from "./ScenarioCard";
import type { Scenario, ScenarioGroup } from "../data";

const DRAG_TYPE = "SCENARIO_CARD";

interface DragItem {
  index: number;
  id: string;
}

interface DraggableScenarioCardProps {
  scenario: Scenario;
  index: number;
  onDelete?: (id: string) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onRemoveFromGroup?: (scenarioId: string, groupId: string) => void;
  onRunValidation?: (scenario: Scenario) => void;
  groups?: ScenarioGroup[];
  activeGroupId?: string | null;
  linkState?: Record<string, unknown>;
  validationProgress?: {
    currentStep: number;
    totalSteps: number;
    status: "running" | "paused";
  } | null;
}

export function DraggableScenarioCard({
  scenario,
  index,
  onDelete,
  onMove,
  onRemoveFromGroup,
  onRunValidation,
  groups,
  activeGroupId,
  linkState,
  validationProgress = null,
}: DraggableScenarioCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag, preview] = useDrag({
    type: DRAG_TYPE,
    item: (): DragItem => ({ index, id: scenario.id }),
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [{ isOver }, drop] = useDrop<DragItem, void, { isOver: boolean }>({
    accept: DRAG_TYPE,
    hover(item) {
      if (item.index === index) return;
      onMove(item.index, index);
      item.index = index;
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  });

  preview(drop(ref));

  return (
    <div
      ref={ref}
      className="relative flex items-stretch gap-0 transition-all"
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <div className="flex-1 min-w-0">
        <ScenarioCard
          scenario={scenario}
          onDelete={onDelete}
          onRemoveFromGroup={onRemoveFromGroup}
          onRunValidation={onRunValidation}
          groups={groups}
          activeGroupId={activeGroupId}
          linkState={linkState}
          validationProgress={validationProgress}
        />
      </div>
      <div
        ref={(node) => { drag(node); }}
        className={`flex items-center px-1.5 cursor-grab active:cursor-grabbing text-[var(--flux-text-muted)] hover:text-[var(--flux-primary)] transition-colors shrink-0 rounded-r-lg ${isOver ? "bg-[var(--flux-primary-muted)]" : ""}`}
        title="드래그하여 순서 변경"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>
    </div>
  );
}
