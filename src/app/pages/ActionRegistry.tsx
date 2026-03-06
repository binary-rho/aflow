import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { Search, Zap, AlertTriangle, Code2, Plus, ChevronLeft } from "lucide-react";
import { Layout } from "../components/Layout";
import { ACTION_REGISTRY, type ActionDefinition } from "../data";
import { cn } from "../../lib/utils";
import { getRegisteredActions, isActionImplemented } from "@/actions";

export default function ActionRegistry() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "missing">("all");

  const actions = useMemo(() => {
    const registeredNames = getRegisteredActions();
    const mockActions = Object.values(ACTION_REGISTRY);

    const merged = new Map<string, ActionDefinition>();
    for (const a of mockActions) {
      merged.set(a.id, {
        ...a,
        status: isActionImplemented(a.id) ? "implemented" : a.status,
      });
    }
    for (const name of registeredNames) {
      if (!merged.has(name)) {
        merged.set(name, {
          id: name,
          name,
          description: "Engine-registered action",
          status: "implemented",
        });
      }
    }
    return [...merged.values()];
  }, []);

  const filtered = actions.filter((action) => {
    const matchesSearch =
      action.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      action.id.toLowerCase().includes(searchTerm.toLowerCase());

    if (activeTab === "missing") {
      return matchesSearch && action.status === "missing";
    }
    return matchesSearch;
  });

  return (
    <Layout>
      <div className="flex flex-col h-full bg-[var(--flux-bg-subtle)]">
        <div className="bg-white border-b border-[var(--flux-border-light)] px-4 py-3 sticky top-0 z-10 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => navigate("/")}
                className="p-1.5 hover:bg-gray-100 rounded-full transition-colors -ml-1"
                title="뒤로"
              >
                <ChevronLeft className="w-5 h-5 text-gray-500" />
              </button>
              <h2 className="text-lg font-bold text-[var(--flux-text-default)] flex items-center gap-2">
                <Zap className="w-4 h-4 text-[var(--flux-primary)] fill-current" />
                액션 도감
              </h2>
            </div>
            <button
              type="button"
              onClick={() => alert("새 액션 추가 기능은 준비 중입니다.")}
              className="p-2 text-[var(--flux-text-muted)] hover:text-[var(--flux-primary)] transition-colors"
              title="새 액션 추가"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>

          <div className="relative mb-3 group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--flux-text-muted)] group-focus-within:text-[var(--flux-primary)] transition-colors" />
            <input
              type="text"
              placeholder="액션 검색 (예: login, 주문)"
              className="w-full pl-9 pr-3 py-2.5 bg-[var(--flux-bg-subtle)] border border-[var(--flux-border)] focus:bg-white focus:border-[var(--flux-primary)] focus:ring-2 focus:ring-[var(--flux-ring)] rounded-xl text-sm transition-all outline-none placeholder:text-[var(--flux-text-muted)]"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab("all")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all border shadow-sm",
                activeTab === "all"
                  ? "bg-[var(--flux-primary)] text-white border-[var(--flux-primary)] active:scale-95"
                  : "bg-white text-[var(--flux-text-muted)] border-[var(--flux-border)] hover:bg-[var(--flux-bg-subtle)] hover:border-[var(--flux-border)]",
              )}
            >
              전체 액션
            </button>
            <button
              onClick={() => setActiveTab("missing")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all border shadow-sm flex items-center gap-1.5",
                activeTab === "missing"
                  ? "bg-amber-100 text-amber-800 border-amber-200 active:scale-95"
                  : "bg-white text-[var(--flux-text-muted)] border-[var(--flux-border)] hover:bg-[var(--flux-bg-subtle)] hover:border-[var(--flux-border)]",
              )}
            >
              <AlertTriangle className="w-3.5 h-3.5 fill-current" />
              구현 필요
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-safe">
          {filtered.map((action) => (
            <div
              key={action.id}
              className={cn(
                "bg-white rounded-xl border p-4 transition-all shadow-sm hover:shadow-md group relative overflow-hidden",
                action.status === "missing"
                  ? "border-amber-200 bg-amber-50/10"
                  : "border-[var(--flux-border-light)] hover:border-[var(--flux-primary)]",
              )}
            >
              {action.status === "missing" && (
                <div className="absolute right-0 top-0 w-16 h-16 pointer-events-none overflow-hidden">
                  <div className="absolute top-0 right-0 transform translate-x-1/2 -translate-y-1/2 bg-amber-100 w-24 h-24 rotate-45" />
                  <AlertTriangle className="absolute top-2 right-2 w-4 h-4 text-amber-500 fill-amber-100" />
                </div>
              )}

              <div className="flex justify-between items-start mb-1 pr-6">
                <h3 className="font-bold text-[var(--flux-text-default)] group-hover:text-[var(--flux-primary)] transition-colors text-sm">
                  {action.name}
                </h3>
              </div>

              <div className="flex items-center gap-2 text-[10px] font-mono text-[var(--flux-text-muted)] mb-2">
                <span className="bg-[var(--flux-bg-subtle)] px-1.5 py-0.5 rounded border border-[var(--flux-border-light)] group-hover:border-pink-200 group-hover:bg-[var(--flux-primary-muted)] group-hover:text-[var(--flux-primary)] transition-colors">
                  {action.id}
                </span>
              </div>

              <p className="text-xs text-[var(--flux-text-muted)] mb-3 leading-relaxed">
                {action.description}
              </p>

              {action.params && action.params.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {action.params.map((param) => (
                    <span
                      key={param}
                      className="px-1.5 py-0.5 bg-[var(--flux-primary-muted)] text-[var(--flux-primary)] text-[10px] font-mono font-medium rounded border border-pink-200"
                    >
                      {param}
                    </span>
                  ))}
                </div>
              )}

              {action.status === "missing" && (
                <button className="w-full mt-1 py-2 border border-dashed border-amber-300 rounded-lg text-amber-700 text-xs font-bold hover:bg-amber-50 active:bg-amber-100 transition-all active:scale-[0.99] flex items-center justify-center gap-2 shadow-sm">
                  <Code2 className="w-3.5 h-3.5" />
                  액션 구현 코드 생성
                </button>
              )}
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="text-center py-12 flex flex-col items-center justify-center text-[var(--flux-text-muted)]">
              <Zap className="w-10 h-10 mb-2 opacity-20" />
              <p className="text-sm">검색된 액션이 없습니다.</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
