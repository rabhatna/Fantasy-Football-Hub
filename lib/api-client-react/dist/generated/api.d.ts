import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { DraftPick, DraftPickInput, DraftSummary, GetPlayersParams, HealthStatus, NewsItem, Player, RefreshStatus, Team } from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getHealthCheckUrl: () => string;
/**
 * Returns server health status
 * @summary Health check
 */
export declare const healthCheck: (options?: Parameters<typeof customFetch>[1]) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetPlayersUrl: (params?: GetPlayersParams) => string;
/**
 * @summary List fantasy players
 */
export declare const getPlayers: (params?: GetPlayersParams, options?: Parameters<typeof customFetch>[1]) => Promise<Player[]>;
export declare const getGetPlayersQueryKey: (params?: GetPlayersParams) => readonly ["/api/players", ...GetPlayersParams[]];
export declare const getGetPlayersQueryOptions: <TData = Awaited<ReturnType<typeof getPlayers>>, TError = ErrorType<unknown>>(params?: GetPlayersParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPlayers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getPlayers>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetPlayersQueryResult = NonNullable<Awaited<ReturnType<typeof getPlayers>>>;
export type GetPlayersQueryError = ErrorType<unknown>;
/**
 * @summary List fantasy players
 */
export declare function useGetPlayers<TData = Awaited<ReturnType<typeof getPlayers>>, TError = ErrorType<unknown>>(params?: GetPlayersParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPlayers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetPlayerUrl: (id: string) => string;
/**
 * @summary Get player deep-dive metrics
 */
export declare const getPlayer: (id: string, options?: Parameters<typeof customFetch>[1]) => Promise<Player>;
export declare const getGetPlayerQueryKey: (id: string) => readonly [`/api/players/${string}`];
export declare const getGetPlayerQueryOptions: <TData = Awaited<ReturnType<typeof getPlayer>>, TError = ErrorType<void>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPlayer>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getPlayer>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetPlayerQueryResult = NonNullable<Awaited<ReturnType<typeof getPlayer>>>;
export type GetPlayerQueryError = ErrorType<void>;
/**
 * @summary Get player deep-dive metrics
 */
export declare function useGetPlayer<TData = Awaited<ReturnType<typeof getPlayer>>, TError = ErrorType<void>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPlayer>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetTeamsUrl: () => string;
/**
 * @summary List team context
 */
export declare const getTeams: (options?: Parameters<typeof customFetch>[1]) => Promise<Team[]>;
export declare const getGetTeamsQueryKey: () => readonly ["/api/teams"];
export declare const getGetTeamsQueryOptions: <TData = Awaited<ReturnType<typeof getTeams>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTeams>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getTeams>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetTeamsQueryResult = NonNullable<Awaited<ReturnType<typeof getTeams>>>;
export type GetTeamsQueryError = ErrorType<unknown>;
/**
 * @summary List team context
 */
export declare function useGetTeams<TData = Awaited<ReturnType<typeof getTeams>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTeams>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetNewsUrl: () => string;
/**
 * @summary List injury and market news
 */
export declare const getNews: (options?: Parameters<typeof customFetch>[1]) => Promise<NewsItem[]>;
export declare const getGetNewsQueryKey: () => readonly ["/api/news"];
export declare const getGetNewsQueryOptions: <TData = Awaited<ReturnType<typeof getNews>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getNews>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getNews>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetNewsQueryResult = NonNullable<Awaited<ReturnType<typeof getNews>>>;
export type GetNewsQueryError = ErrorType<unknown>;
/**
 * @summary List injury and market news
 */
export declare function useGetNews<TData = Awaited<ReturnType<typeof getNews>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getNews>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetDraftSummaryUrl: () => string;
/**
 * @summary Get draft room summary
 */
export declare const getDraftSummary: (options?: Parameters<typeof customFetch>[1]) => Promise<DraftSummary>;
export declare const getGetDraftSummaryQueryKey: () => readonly ["/api/draft/summary"];
export declare const getGetDraftSummaryQueryOptions: <TData = Awaited<ReturnType<typeof getDraftSummary>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDraftSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getDraftSummary>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetDraftSummaryQueryResult = NonNullable<Awaited<ReturnType<typeof getDraftSummary>>>;
export type GetDraftSummaryQueryError = ErrorType<unknown>;
/**
 * @summary Get draft room summary
 */
export declare function useGetDraftSummary<TData = Awaited<ReturnType<typeof getDraftSummary>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDraftSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getSaveDraftPickUrl: () => string;
/**
 * @summary Save a drafted player
 */
export declare const saveDraftPick: (draftPickInput: DraftPickInput, options?: Parameters<typeof customFetch>[1]) => Promise<DraftPick>;
export declare const getSaveDraftPickMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof saveDraftPick>>, TError, {
        data: BodyType<DraftPickInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof saveDraftPick>>, TError, {
    data: BodyType<DraftPickInput>;
}, TContext>;
export type SaveDraftPickMutationResult = NonNullable<Awaited<ReturnType<typeof saveDraftPick>>>;
export type SaveDraftPickMutationBody = BodyType<DraftPickInput>;
export type SaveDraftPickMutationError = ErrorType<unknown>;
/**
* @summary Save a drafted player
*/
export declare const useSaveDraftPick: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof saveDraftPick>>, TError, {
        data: BodyType<DraftPickInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof saveDraftPick>>, TError, {
    data: BodyType<DraftPickInput>;
}, TContext>;
export declare const getRefreshDataUrl: () => string;
/**
 * @summary Refresh cached data
 */
export declare const refreshData: (options?: Parameters<typeof customFetch>[1]) => Promise<RefreshStatus>;
export declare const getRefreshDataMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof refreshData>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof refreshData>>, TError, void, TContext>;
export type RefreshDataMutationResult = NonNullable<Awaited<ReturnType<typeof refreshData>>>;
export type RefreshDataMutationError = ErrorType<unknown>;
/**
* @summary Refresh cached data
*/
export declare const useRefreshData: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof refreshData>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof refreshData>>, TError, void, TContext>;
export {};
//# sourceMappingURL=api.d.ts.map