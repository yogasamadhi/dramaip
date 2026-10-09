import { createElement } from "react";
import { ProductionWorkspace } from "./impl";
import { useLocation } from "react-router-dom";
import { MediaReviewReturn } from "./MediaReviewReturn";

export const MediaFeature = () => {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  return createElement(
    ["mediaSourceReviewId", "audioRevisionId", "audioResolutionId"].some(
      (name) => params.has(name),
    )
      ? MediaReviewReturn
      : ProductionWorkspace,
  );
};
