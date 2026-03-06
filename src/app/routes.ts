import { createHashRouter } from "react-router";
import ScenarioList from "./pages/ScenarioList";
import ScenarioRunner from "./pages/ScenarioRunner";
import ActionRegistry from "./pages/ActionRegistry";

export const router = createHashRouter([
  {
    path: "/",
    Component: ScenarioList,
  },
  {
    path: "/run/:id",
    Component: ScenarioRunner,
  },
  {
    path: "/registry",
    Component: ActionRegistry,
  },
  {
    path: "*",
    Component: ScenarioList,
  },
]);
