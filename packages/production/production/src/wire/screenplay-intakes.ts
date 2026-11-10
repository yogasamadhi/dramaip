/**
 * The shapes the screenplay intake operations declare.
 *
 * @module @dramaip/production-production/wire/screenplay-intakes
 */

/** Input of `production/screenplayIntakesCommit` (`screenplayIntakes.commit`). */
export type ScreenplayIntakesCommitInput = {
  previewId: string;
  project: {
    title: string;
    shortDramaType?: string;
    targetAudience?: string;
    targetWordCount?: number;
    targetEpisodeCount?: number;
    coreHook?: string;
    emotionalCore?: string;
    coreSellingPoint?: string;
    synopsis?: string;
    styleGuide?: string;
    visualStyleDirection?: string;
    genreOpportunity?: string;
    productionBrief?: string;
    mode?:
      | "series_longform"
      | "single_season"
      | "personal_theater"
      | "creator_channel";
    modeConfig?:
      | {
          mode: "series_longform";
          targetChapterCount?: number;
          targetSeasonCount?: number;
          targetEpisodesPerSeason?: number;
        }
      | {
          mode: "single_season";
          entryPath: "novel" | "source-import" | "script" | "inspiration";
          targetEpisodeCount?: number;
        }
      | {
          mode: "personal_theater";
          storyMethod: "template" | "freeform";
          episodeCount?: number;
          episodeDurationMinutes?: number;
        }
      | {
          mode: "creator_channel";
          topic: string;
          positioning?: string;
          audience?: string;
          platforms?: string[];
          riskDomain?: "general" | "finance" | "health" | "legal";
        };
    goalConfirmation?: {
      confirmed: true;
      goal: "novel-first" | "screenplay-first";
      material: "inspiration" | "source-import" | "script";
    };
  };
  confirmation: {
    rightsDeclared: true;
    lossReportReviewed: true;
  };
};

/** Answer of `production/screenplayIntakesCommit` (`screenplayIntakes.commit`). */
export type ScreenplayIntakesCommitResult = {
  id: string;
  sourceName: string;
  sourceFormat: "fountain" | "fdx" | "script-json";
  sourceTitle?: string;
  episodes?: {
    id: string;
    episodeNumber: number;
    title: string;
    content: string;
    contentSource: "episode-content" | "scene-content";
    blocks: (
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "scene_heading";
          text: string;
          sceneNumber?: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "action";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "character";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "dialogue";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "parenthetical";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "transition";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "note";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "page_break";
        }
    )[];
    scenes: {
      title?: string;
      content?: string;
      location?: string;
      time?: string;
      characters?: string[];
    }[];
    lossReport: {
      unsupported: string[];
      warnings: string[];
      preserved: string[];
    };
  }[];
  blocks: (
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "scene_heading";
        text: string;
        sceneNumber?: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "action";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "character";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "dialogue";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "parenthetical";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "transition";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "note";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "page_break";
      }
  )[];
  lossReport: {
    unsupported: string[];
    warnings: string[];
    preserved: string[];
  };
  etag: string;
  status: "pending" | "creating" | "materialized" | "committed" | "discarded";
  createdAt: string;
  requestKey?: string;
  request?: {
    previewId: string;
    project: {
      title: string;
      shortDramaType?: string;
      targetAudience?: string;
      targetWordCount?: number;
      targetEpisodeCount?: number;
      coreHook?: string;
      emotionalCore?: string;
      coreSellingPoint?: string;
      synopsis?: string;
      styleGuide?: string;
      visualStyleDirection?: string;
      genreOpportunity?: string;
      productionBrief?: string;
      mode?:
        | "series_longform"
        | "single_season"
        | "personal_theater"
        | "creator_channel";
      modeConfig?:
        | {
            mode: "series_longform";
            targetChapterCount?: number;
            targetSeasonCount?: number;
            targetEpisodesPerSeason?: number;
          }
        | {
            mode: "single_season";
            entryPath: "novel" | "source-import" | "script" | "inspiration";
            targetEpisodeCount?: number;
          }
        | {
            mode: "personal_theater";
            storyMethod: "template" | "freeform";
            episodeCount?: number;
            episodeDurationMinutes?: number;
          }
        | {
            mode: "creator_channel";
            topic: string;
            positioning?: string;
            audience?: string;
            platforms?: string[];
            riskDomain?: "general" | "finance" | "health" | "legal";
          };
      goalConfirmation?: {
        confirmed: true;
        goal: "novel-first" | "screenplay-first";
        material: "inspiration" | "source-import" | "script";
      };
    };
    confirmation: {
      rightsDeclared: true;
      lossReportReviewed: true;
    };
  };
  receipt?: {
    projectId: string;
    projectVersion: number;
    adaptationId: string;
    adaptationVersion: number;
    episodeId: string;
    episodeVersion: number;
    scriptId: string;
    scriptVersion: number;
    documentId: string;
    documentVersion: number;
    committedAt: string;
    episodes?: {
      previewEpisodeId: string;
      episodeNumber: number;
      episodeId: string;
      episodeVersion: number;
      scriptId: string;
      scriptVersion: number;
      documentId: string;
      documentVersion: number;
      scenes: {
        id: string;
        version: number;
        sourceIndex: number;
      }[];
    }[];
  };
  sourceState: "current" | "stale" | "unknown";
};

/** Answer of `production/screenplayIntakesDiscard` (`screenplayIntakes.discard`). */
export type ScreenplayIntakesDiscardResult = {
  id: string;
  sourceName: string;
  sourceFormat: "fountain" | "fdx" | "script-json";
  sourceTitle?: string;
  episodes?: {
    id: string;
    episodeNumber: number;
    title: string;
    content: string;
    contentSource: "episode-content" | "scene-content";
    blocks: (
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "scene_heading";
          text: string;
          sceneNumber?: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "action";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "character";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "dialogue";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "parenthetical";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "transition";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "note";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "page_break";
        }
    )[];
    scenes: {
      title?: string;
      content?: string;
      location?: string;
      time?: string;
      characters?: string[];
    }[];
    lossReport: {
      unsupported: string[];
      warnings: string[];
      preserved: string[];
    };
  }[];
  blocks: (
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "scene_heading";
        text: string;
        sceneNumber?: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "action";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "character";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "dialogue";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "parenthetical";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "transition";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "note";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "page_break";
      }
  )[];
  lossReport: {
    unsupported: string[];
    warnings: string[];
    preserved: string[];
  };
  etag: string;
  status: "pending" | "creating" | "materialized" | "committed" | "discarded";
  createdAt: string;
  requestKey?: string;
  request?: {
    previewId: string;
    project: {
      title: string;
      shortDramaType?: string;
      targetAudience?: string;
      targetWordCount?: number;
      targetEpisodeCount?: number;
      coreHook?: string;
      emotionalCore?: string;
      coreSellingPoint?: string;
      synopsis?: string;
      styleGuide?: string;
      visualStyleDirection?: string;
      genreOpportunity?: string;
      productionBrief?: string;
      mode?:
        | "series_longform"
        | "single_season"
        | "personal_theater"
        | "creator_channel";
      modeConfig?:
        | {
            mode: "series_longform";
            targetChapterCount?: number;
            targetSeasonCount?: number;
            targetEpisodesPerSeason?: number;
          }
        | {
            mode: "single_season";
            entryPath: "novel" | "source-import" | "script" | "inspiration";
            targetEpisodeCount?: number;
          }
        | {
            mode: "personal_theater";
            storyMethod: "template" | "freeform";
            episodeCount?: number;
            episodeDurationMinutes?: number;
          }
        | {
            mode: "creator_channel";
            topic: string;
            positioning?: string;
            audience?: string;
            platforms?: string[];
            riskDomain?: "general" | "finance" | "health" | "legal";
          };
      goalConfirmation?: {
        confirmed: true;
        goal: "novel-first" | "screenplay-first";
        material: "inspiration" | "source-import" | "script";
      };
    };
    confirmation: {
      rightsDeclared: true;
      lossReportReviewed: true;
    };
  };
  receipt?: {
    projectId: string;
    projectVersion: number;
    adaptationId: string;
    adaptationVersion: number;
    episodeId: string;
    episodeVersion: number;
    scriptId: string;
    scriptVersion: number;
    documentId: string;
    documentVersion: number;
    committedAt: string;
    episodes?: {
      previewEpisodeId: string;
      episodeNumber: number;
      episodeId: string;
      episodeVersion: number;
      scriptId: string;
      scriptVersion: number;
      documentId: string;
      documentVersion: number;
      scenes: {
        id: string;
        version: number;
        sourceIndex: number;
      }[];
    }[];
  };
  sourceState: "current" | "stale" | "unknown";
};

/** Answer of `production/screenplayIntakesGet` (`screenplayIntakes.get`). */
export type ScreenplayIntakesGetResult = {
  id: string;
  sourceName: string;
  sourceFormat: "fountain" | "fdx" | "script-json";
  sourceTitle?: string;
  episodes?: {
    id: string;
    episodeNumber: number;
    title: string;
    content: string;
    contentSource: "episode-content" | "scene-content";
    blocks: (
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "scene_heading";
          text: string;
          sceneNumber?: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "action";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "character";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "dialogue";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "parenthetical";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "transition";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "note";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "page_break";
        }
    )[];
    scenes: {
      title?: string;
      content?: string;
      location?: string;
      time?: string;
      characters?: string[];
    }[];
    lossReport: {
      unsupported: string[];
      warnings: string[];
      preserved: string[];
    };
  }[];
  blocks: (
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "scene_heading";
        text: string;
        sceneNumber?: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "action";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "character";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "dialogue";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "parenthetical";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "transition";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "note";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "page_break";
      }
  )[];
  lossReport: {
    unsupported: string[];
    warnings: string[];
    preserved: string[];
  };
  etag: string;
  status: "pending" | "creating" | "materialized" | "committed" | "discarded";
  createdAt: string;
  requestKey?: string;
  request?: {
    previewId: string;
    project: {
      title: string;
      shortDramaType?: string;
      targetAudience?: string;
      targetWordCount?: number;
      targetEpisodeCount?: number;
      coreHook?: string;
      emotionalCore?: string;
      coreSellingPoint?: string;
      synopsis?: string;
      styleGuide?: string;
      visualStyleDirection?: string;
      genreOpportunity?: string;
      productionBrief?: string;
      mode?:
        | "series_longform"
        | "single_season"
        | "personal_theater"
        | "creator_channel";
      modeConfig?:
        | {
            mode: "series_longform";
            targetChapterCount?: number;
            targetSeasonCount?: number;
            targetEpisodesPerSeason?: number;
          }
        | {
            mode: "single_season";
            entryPath: "novel" | "source-import" | "script" | "inspiration";
            targetEpisodeCount?: number;
          }
        | {
            mode: "personal_theater";
            storyMethod: "template" | "freeform";
            episodeCount?: number;
            episodeDurationMinutes?: number;
          }
        | {
            mode: "creator_channel";
            topic: string;
            positioning?: string;
            audience?: string;
            platforms?: string[];
            riskDomain?: "general" | "finance" | "health" | "legal";
          };
      goalConfirmation?: {
        confirmed: true;
        goal: "novel-first" | "screenplay-first";
        material: "inspiration" | "source-import" | "script";
      };
    };
    confirmation: {
      rightsDeclared: true;
      lossReportReviewed: true;
    };
  };
  receipt?: {
    projectId: string;
    projectVersion: number;
    adaptationId: string;
    adaptationVersion: number;
    episodeId: string;
    episodeVersion: number;
    scriptId: string;
    scriptVersion: number;
    documentId: string;
    documentVersion: number;
    committedAt: string;
    episodes?: {
      previewEpisodeId: string;
      episodeNumber: number;
      episodeId: string;
      episodeVersion: number;
      scriptId: string;
      scriptVersion: number;
      documentId: string;
      documentVersion: number;
      scenes: {
        id: string;
        version: number;
        sourceIndex: number;
      }[];
    }[];
  };
  sourceState: "current" | "stale" | "unknown";
};

/** Input of `production/screenplayIntakesPreview` (`screenplayIntakes.preview`). */
export type ScreenplayIntakesPreviewInput = {
  previewId: string;
  grantId: string;
};

/** Answer of `production/screenplayIntakesPreview` (`screenplayIntakes.preview`). */
export type ScreenplayIntakesPreviewResult = {
  id: string;
  sourceName: string;
  sourceFormat: "fountain" | "fdx" | "script-json";
  sourceTitle?: string;
  episodes?: {
    id: string;
    episodeNumber: number;
    title: string;
    content: string;
    contentSource: "episode-content" | "scene-content";
    blocks: (
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "scene_heading";
          text: string;
          sceneNumber?: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "action";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "character";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "dialogue";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "parenthetical";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "transition";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "note";
          text: string;
        }
      | {
          id: string;
          sourceLocation?: {
            line: number;
            column?: number;
          };
          type: "page_break";
        }
    )[];
    scenes: {
      title?: string;
      content?: string;
      location?: string;
      time?: string;
      characters?: string[];
    }[];
    lossReport: {
      unsupported: string[];
      warnings: string[];
      preserved: string[];
    };
  }[];
  blocks: (
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "scene_heading";
        text: string;
        sceneNumber?: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "action";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "character";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "dialogue";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "parenthetical";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "transition";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "note";
        text: string;
      }
    | {
        id: string;
        sourceLocation?: {
          line: number;
          column?: number;
        };
        type: "page_break";
      }
  )[];
  lossReport: {
    unsupported: string[];
    warnings: string[];
    preserved: string[];
  };
  etag: string;
  status: "pending" | "creating" | "materialized" | "committed" | "discarded";
  createdAt: string;
  requestKey?: string;
  request?: {
    previewId: string;
    project: {
      title: string;
      shortDramaType?: string;
      targetAudience?: string;
      targetWordCount?: number;
      targetEpisodeCount?: number;
      coreHook?: string;
      emotionalCore?: string;
      coreSellingPoint?: string;
      synopsis?: string;
      styleGuide?: string;
      visualStyleDirection?: string;
      genreOpportunity?: string;
      productionBrief?: string;
      mode?:
        | "series_longform"
        | "single_season"
        | "personal_theater"
        | "creator_channel";
      modeConfig?:
        | {
            mode: "series_longform";
            targetChapterCount?: number;
            targetSeasonCount?: number;
            targetEpisodesPerSeason?: number;
          }
        | {
            mode: "single_season";
            entryPath: "novel" | "source-import" | "script" | "inspiration";
            targetEpisodeCount?: number;
          }
        | {
            mode: "personal_theater";
            storyMethod: "template" | "freeform";
            episodeCount?: number;
            episodeDurationMinutes?: number;
          }
        | {
            mode: "creator_channel";
            topic: string;
            positioning?: string;
            audience?: string;
            platforms?: string[];
            riskDomain?: "general" | "finance" | "health" | "legal";
          };
      goalConfirmation?: {
        confirmed: true;
        goal: "novel-first" | "screenplay-first";
        material: "inspiration" | "source-import" | "script";
      };
    };
    confirmation: {
      rightsDeclared: true;
      lossReportReviewed: true;
    };
  };
  receipt?: {
    projectId: string;
    projectVersion: number;
    adaptationId: string;
    adaptationVersion: number;
    episodeId: string;
    episodeVersion: number;
    scriptId: string;
    scriptVersion: number;
    documentId: string;
    documentVersion: number;
    committedAt: string;
    episodes?: {
      previewEpisodeId: string;
      episodeNumber: number;
      episodeId: string;
      episodeVersion: number;
      scriptId: string;
      scriptVersion: number;
      documentId: string;
      documentVersion: number;
      scenes: {
        id: string;
        version: number;
        sourceIndex: number;
      }[];
    }[];
  };
  sourceState: "current" | "stale" | "unknown";
};
