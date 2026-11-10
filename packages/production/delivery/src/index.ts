/**
 * Host face of the delivery domain. It owns the `delivery` Remote namespace:
 * delivery records and exports, localization and subtitles, manuscripts, pilot packages and platform delivery archives and variants. Each method names the `/api/v2` operation it replaces.
 *
 * The methods claim the operations from the operation registry and run the
 * delivery plugin's handlers in process
 * (`@dramaip/infra-operations/operations`); a handler's problem answer arrives
 * as the `compat/problem` RemoteError.
 * @module @dramaip/production-delivery
 */
import type { Context } from "@deepseek-ai/cordis";
import {
  claimCompatOperations,
  compatCallOf,
  type CompatOperations,
} from "@dramaip/infra-operations/operations";
import { Remote, TypertRemoteService } from "@dramaip/infra-typert-protocol";
import type {
  ExportResult,
  RecordsCreateInput,
  RecordsCreateResult,
  RecordsGetResult,
  RecordsListQuery,
  RecordsListResult,
  RecordsUpdateInput,
  RecordsUpdateResult,
  LocalizationAdoptResult,
  LocalizationRecordsCreateInput,
  LocalizationRecordsCreateResult,
  LocalizationRecordsGetResult,
  LocalizationRecordsListQuery,
  LocalizationRecordsListResult,
  LocalizationRecordsUpdateInput,
  LocalizationRecordsUpdateResult,
  LocalizationSubtitlesResult,
  ManuscriptsGetResult,
  ManuscriptsListQuery,
  ManuscriptsListResult,
  ManuscriptsPreviewInput,
  ManuscriptsPreviewResult,
  ManuscriptsSaveInput,
  ManuscriptsSaveResult,
  PilotPackagesGetResult,
  PilotPackagesListQuery,
  PilotPackagesListResult,
  PilotPackagesPreviewInput,
  PilotPackagesPreviewResult,
  PilotPackagesSaveInput,
  PilotPackagesSaveResult,
  PlatformAdoptVariantInput,
  PlatformAdoptVariantResult,
  PlatformCreateArchiveInput,
  PlatformCreateArchiveResult,
  PlatformCreateVariantInput,
  PlatformCreateVariantResult,
  PlatformExportArchiveQuery,
  PlatformExportArchiveResult,
  PlatformListArchivesQuery,
  PlatformListArchivesResult,
  PlatformListProfilesResult,
  PlatformListVariantsQuery,
  PlatformListVariantsResult,
  PlatformPreflightInput,
  PlatformPreflightResult,
  PlatformRecoverRequestQuery,
  PlatformRecoverRequestResult,
} from "./types.ts";
import { deliveryLegacyRoutes, type DeliveryLegacyMethod } from "./legacy.ts";

export type * from "./types.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Host owner of the `delivery` Remote namespace. */
    deliveryController: DeliveryController;
  }
}

/** The `/api/v2` operations this namespace replaces. */
export const replacedOperations: readonly string[] =
  deliveryLegacyRoutes.routes.map((route) => route.operationId);

/** Host service backing the generated `ctx.remote.delivery` namespace. */
export class DeliveryController extends TypertRemoteService {
  static inject = ["operations"];

  private readonly compat: CompatOperations;

  constructor(ctx: Context) {
    super(ctx, "deliveryController", { namespace: "delivery" });
    this.compat = claimCompatOperations(ctx, replacedOperations);
  }

  /** Run the replaced operation behind `method` with its arguments. */
  private run<T>(
    method: DeliveryLegacyMethod,
    ...args: readonly unknown[]
  ): Promise<T> {
    const route = deliveryLegacyRoutes.routes.find(
      (candidate) => candidate.remote === method,
    )!;
    return this.compat.call(
      route.operationId,
      compatCallOf(route, args),
    ) as Promise<T>;
  }

  /**
   * Runs `GET /api/v2/delivery/{id}/export`.
   * @replaces delivery.export
   * @param id - the `id` path parameter.
   */
  @Remote
  export(id: string): Promise<ExportResult> {
    return this.run("export", id);
  }

  /**
   * Runs `POST /api/v2/delivery`.
   * @replaces delivery.records.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  recordsCreate(
    input: RecordsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<RecordsCreateResult> {
    return this.run("recordsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/delivery/{id}`.
   * @replaces delivery.records.get
   * @param id - the `id` path parameter.
   */
  @Remote
  recordsGet(id: string): Promise<RecordsGetResult> {
    return this.run("recordsGet", id);
  }

  /**
   * Runs `GET /api/v2/delivery`.
   * @replaces delivery.records.list
   * @param query - the query parameters.
   */
  @Remote
  recordsList(query?: RecordsListQuery): Promise<RecordsListResult> {
    return this.run("recordsList", query);
  }

  /**
   * Runs `DELETE /api/v2/delivery/{id}`.
   * @replaces delivery.records.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  recordsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("recordsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/delivery/{id}`.
   * @replaces delivery.records.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  recordsUpdate(
    id: string,
    input: RecordsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<RecordsUpdateResult> {
    return this.run("recordsUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/localization/{id}/adopt`.
   * @replaces localization.adopt
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  localizationAdopt(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<LocalizationAdoptResult> {
    return this.run("localizationAdopt", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/localization`.
   * @replaces localization.records.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  localizationRecordsCreate(
    input: LocalizationRecordsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<LocalizationRecordsCreateResult> {
    return this.run(
      "localizationRecordsCreate",
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/localization/{id}`.
   * @replaces localization.records.get
   * @param id - the `id` path parameter.
   */
  @Remote
  localizationRecordsGet(id: string): Promise<LocalizationRecordsGetResult> {
    return this.run("localizationRecordsGet", id);
  }

  /**
   * Runs `GET /api/v2/localization`.
   * @replaces localization.records.list
   * @param query - the query parameters.
   */
  @Remote
  localizationRecordsList(
    query?: LocalizationRecordsListQuery,
  ): Promise<LocalizationRecordsListResult> {
    return this.run("localizationRecordsList", query);
  }

  /**
   * Runs `DELETE /api/v2/localization/{id}`.
   * @replaces localization.records.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  localizationRecordsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("localizationRecordsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/localization/{id}`.
   * @replaces localization.records.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  localizationRecordsUpdate(
    id: string,
    input: LocalizationRecordsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<LocalizationRecordsUpdateResult> {
    return this.run(
      "localizationRecordsUpdate",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/localization/{id}/subtitles/{format}`.
   * @replaces localization.subtitles
   * @param id - the `id` path parameter.
   * @param format - the `format` path parameter.
   */
  @Remote
  localizationSubtitles(
    id: string,
    format: string,
  ): Promise<LocalizationSubtitlesResult> {
    return this.run("localizationSubtitles", id, format);
  }

  /**
   * Manuscript result. Runs `GET /api/v2/manuscripts/{id}`.
   * @replaces manuscripts.get
   * @param id - the `id` path parameter.
   */
  @Remote
  manuscriptsGet(id: string): Promise<ManuscriptsGetResult> {
    return this.run("manuscriptsGet", id);
  }

  /**
   * Manuscript result. Runs `GET /api/v2/projects/{projectId}/manuscripts`.
   * @replaces manuscripts.list
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  manuscriptsList(
    projectId: string,
    query?: ManuscriptsListQuery,
  ): Promise<ManuscriptsListResult> {
    return this.run("manuscriptsList", projectId, query);
  }

  /**
   * Manuscript result. Runs `POST /api/v2/projects/{projectId}/manuscripts`.
   * @replaces manuscripts.preview
   * @param projectId - the `projectId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  manuscriptsPreview(
    projectId: string,
    input: ManuscriptsPreviewInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ManuscriptsPreviewResult> {
    return this.run(
      "manuscriptsPreview",
      projectId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Manuscript result. Runs `POST /api/v2/manuscripts/{id}/save`.
   * @replaces manuscripts.save
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  manuscriptsSave(
    id: string,
    input: ManuscriptsSaveInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ManuscriptsSaveResult> {
    return this.run("manuscriptsSave", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Internal pilot package. Runs `GET /api/v2/pilot-packages/{id}`.
   * @replaces pilotPackages.get
   * @param id - the `id` path parameter.
   */
  @Remote
  pilotPackagesGet(id: string): Promise<PilotPackagesGetResult> {
    return this.run("pilotPackagesGet", id);
  }

  /**
   * Internal pilot package. Runs `GET /api/v2/projects/{projectId}/pilot-packages`.
   * @replaces pilotPackages.list
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  pilotPackagesList(
    projectId: string,
    query?: PilotPackagesListQuery,
  ): Promise<PilotPackagesListResult> {
    return this.run("pilotPackagesList", projectId, query);
  }

  /**
   * Internal pilot package. Runs `POST /api/v2/projects/{projectId}/pilot-packages`.
   * @replaces pilotPackages.preview
   * @param projectId - the `projectId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  pilotPackagesPreview(
    projectId: string,
    input: PilotPackagesPreviewInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<PilotPackagesPreviewResult> {
    return this.run(
      "pilotPackagesPreview",
      projectId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Internal pilot package. Runs `POST /api/v2/pilot-packages/{id}/save`.
   * @replaces pilotPackages.save
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  pilotPackagesSave(
    id: string,
    input: PilotPackagesSaveInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<PilotPackagesSaveResult> {
    return this.run("pilotPackagesSave", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Submission metadata, never release approval. Runs `POST /api/v2/delivery-variants/{id}/adopt`.
   * @replaces platform-delivery.adoptVariant
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  platformAdoptVariant(
    id: string,
    input: PlatformAdoptVariantInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<PlatformAdoptVariantResult> {
    return this.run("platformAdoptVariant", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Submission metadata, never release approval. Runs `POST /api/v2/episodes/{id}/platform-deliveries`.
   * @replaces platform-delivery.createArchive
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  platformCreateArchive(
    id: string,
    input: PlatformCreateArchiveInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<PlatformCreateArchiveResult> {
    return this.run(
      "platformCreateArchive",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Submission metadata, never release approval. Runs `POST /api/v2/adaptations/{id}/delivery-variants`.
   * @replaces platform-delivery.createVariant
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  platformCreateVariant(
    id: string,
    input: PlatformCreateVariantInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<PlatformCreateVariantResult> {
    return this.run(
      "platformCreateVariant",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Submission metadata, never release approval. Runs `GET /api/v2/platform-deliveries/{id}/export`.
   * @replaces platform-delivery.exportArchive
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  platformExportArchive(
    id: string,
    query: PlatformExportArchiveQuery,
  ): Promise<PlatformExportArchiveResult> {
    return this.run("platformExportArchive", id, query);
  }

  /**
   * Submission metadata, never release approval. Runs `GET /api/v2/episodes/{id}/platform-deliveries`.
   * @replaces platform-delivery.listArchives
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  platformListArchives(
    id: string,
    query: PlatformListArchivesQuery,
  ): Promise<PlatformListArchivesResult> {
    return this.run("platformListArchives", id, query);
  }

  /**
   * Submission metadata, never release approval. Runs `GET /api/v2/platform-delivery/profiles`.
   * @replaces platform-delivery.listProfiles
   */
  @Remote
  platformListProfiles(): Promise<PlatformListProfilesResult> {
    return this.run("platformListProfiles");
  }

  /**
   * Submission metadata, never release approval. Runs `GET /api/v2/adaptations/{id}/delivery-variants`.
   * @replaces platform-delivery.listVariants
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  platformListVariants(
    id: string,
    query: PlatformListVariantsQuery,
  ): Promise<PlatformListVariantsResult> {
    return this.run("platformListVariants", id, query);
  }

  /**
   * Submission metadata, never release approval. Runs `POST /api/v2/episodes/{id}/platform-delivery/preflight`.
   * @replaces platform-delivery.preflight
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  platformPreflight(
    id: string,
    input: PlatformPreflightInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<PlatformPreflightResult> {
    return this.run("platformPreflight", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Submission metadata, never release approval. Runs `GET /api/v2/platform-delivery/requests/{id}`.
   * @replaces platform-delivery.recoverRequest
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  platformRecoverRequest(
    id: string,
    query: PlatformRecoverRequestQuery,
  ): Promise<PlatformRecoverRequestResult> {
    return this.run("platformRecoverRequest", id, query);
  }
}

export default DeliveryController;
