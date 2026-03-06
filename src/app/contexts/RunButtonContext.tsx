import { createContext, useCallback, useContext, useState } from "react";

type RunAction = (() => void) | null;

const RunButtonContext = createContext<{
  runAction: RunAction;
  registerRun: (fn: () => void) => () => void;
}>({
  runAction: null,
  registerRun: () => () => {},
});

export function RunButtonProvider({ children }: { children: React.ReactNode }) {
  const [runAction, setRunAction] = useState<RunAction>(null);

  const registerRun = useCallback((fn: () => void) => {
    setRunAction(() => fn);
    return () => setRunAction(null);
  }, []);

  return (
    <RunButtonContext.Provider value={{ runAction, registerRun }}>
      {children}
    </RunButtonContext.Provider>
  );
}

export function useRunButton() {
  return useContext(RunButtonContext);
}
