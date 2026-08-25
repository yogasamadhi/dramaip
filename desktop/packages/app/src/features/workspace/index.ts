import { createElement } from "react";
import {
  ProjectHome,
  ProjectToolPage,
  ProjectWorkspace,
  SearchPage,
} from "./impl";

export const ProjectHomeFeature = () => createElement(ProjectHome);
export const ProjectToolFeature = () => createElement(ProjectToolPage);
export const ProjectWorkspaceFeature = () => createElement(ProjectWorkspace);
export const SearchFeature = () => createElement(SearchPage);
