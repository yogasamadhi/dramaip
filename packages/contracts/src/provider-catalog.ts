/** Pi-owned provider catalog projected to the settings and writing interfaces. */
export interface ModelProviderCatalogModel {
  readonly id: string;
  readonly label: string;
  readonly baseUrl?: string;
  readonly recommended?: boolean;
  readonly preview?: boolean;
}

export interface ModelProviderPreset {
  readonly id: string;
  readonly name: string;
  readonly protocol: string;
  readonly baseUrl?: string;
  readonly apiKeyUrl?: string;
  readonly sourceUrl: string;
  readonly models: readonly ModelProviderCatalogModel[];
}

export interface ModelProviderCatalog {
  readonly release: string;
  readonly updatedAt: string;
  readonly providers: readonly ModelProviderPreset[];
}
