import { createHashRouter } from "react-router";
import ScenarioList from "./pages/ScenarioList";
import ScenarioRunner from "./pages/ScenarioRunner";
import ActionRegistry from "./pages/ActionRegistry";
import ScenarioFlowPage from "./pages/ScenarioFlowPage";
import FlowDetailPage from "./pages/FlowDetailPage";

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
    path: "/flow",
    Component: ScenarioFlowPage,
  },
  {
    path: "/flow/:id",
    Component: FlowDetailPage,
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
