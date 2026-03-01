/**
 * Mastra Convex Storage Handler (patched)
 *
 * Overrides the default @mastra/convex storage handler to fix the 16MB/32K document
 * read limit error. The upstream `queryTable` and `load` operations do full table scans
 * (.take(10000)) then filter in JS — which hits Convex limits once enough data
 * accumulates across threads.
 *
 * This patch intercepts `queryTable` and `load` operations on typed tables to use
 * Convex indexes instead of full table scans.
 *
 * Patched tables & indexes:
 * - mastra_messages: by_thread_created, by_record_id, by_resource
 * - mastra_threads:  by_record_id, by_resource
 * - mastra_workflow_snapshots: by_workflow_run, by_workflow
 */

import { mutationGeneric } from 'convex/server';
import type { GenericMutationCtx as MutationCtx } from 'convex/server';
import { mastraStorage } from '@mastra/convex/server';
import type { DataModel } from '../_generated/dataModel';
import { api } from '../_generated/api';

// ─── Types ───────────────────────────────────────────────────────────

interface StorageFilter {
    field: string;
    value: unknown;
}

interface StorageRequest {
    tableName: string;
    op: string;
    filters?: StorageFilter[];
    limit?: number;
    keys?: Record<string, unknown>;
    indexHint?: { index: string; workflowName?: string; runId?: string };
    [key: string]: unknown;
}

interface StorageResponse {
    ok: boolean;
    result?: unknown;
    error?: string;
    hasMore?: boolean;
}

type Ctx = MutationCtx<DataModel>;

// ─── Helpers ─────────────────────────────────────────────────────────

function findFilter(filters: StorageFilter[] | undefined, field: string): StorageFilter | undefined {
    return filters?.find((f) => f.field === field);
}

function excludeFilters(filters: StorageFilter[] | undefined, ...fields: string[]): StorageFilter[] {
    return filters?.filter((f) => !fields.includes(f.field)) ?? [];
}

function applyJsFilters<T extends Record<string, unknown>>(docs: T[], filters: StorageFilter[]): T[] {
    if (filters.length === 0) return docs;
    return docs.filter((doc) => filters.every((f) => doc[f.field] === f.value));
}

function applyLimit<T>(docs: T[], limit?: number): T[] {
    return limit ? docs.slice(0, limit) : docs;
}

function delegateToUpstream(ctx: Ctx, request: StorageRequest): Promise<StorageResponse> {
    return ctx.runMutation(api.mastra.storage._upstream, request as any) as Promise<StorageResponse>;
}

// ─── Indexed queryTable: mastra_messages ─────────────────────────────

async function queryMessages(ctx: Ctx, request: StorageRequest): Promise<StorageResponse | null> {
    const limit = request.limit ?? 10000;
    const threadFilter = findFilter(request.filters, 'thread_id');
    const idFilter = findFilter(request.filters, 'id');
    const resourceFilter = findFilter(request.filters, 'resourceId');

    let docs;
    let usedFields: string[];

    if (threadFilter) {
        docs = await ctx.db
            .query('mastra_messages')
            .withIndex('by_thread_created', (q) => q.eq('thread_id', threadFilter.value as string))
            .take(limit);
        usedFields = ['thread_id'];
    } else if (idFilter) {
        const doc = await ctx.db
            .query('mastra_messages')
            .withIndex('by_record_id', (q) => q.eq('id', idFilter.value as string))
            .unique();
        docs = doc ? [doc] : [];
        usedFields = ['id'];
    } else if (resourceFilter) {
        docs = await ctx.db
            .query('mastra_messages')
            .withIndex('by_resource', (q) => q.eq('resourceId', resourceFilter.value as string))
            .take(limit);
        usedFields = ['resourceId'];
    } else {
        // No indexed filter available — fall through to upstream
        return null;
    }

    const remaining = excludeFilters(request.filters, ...usedFields);
    docs = applyJsFilters(docs as Record<string, unknown>[], remaining);
    docs = applyLimit(docs, request.limit);

    return { ok: true, result: docs };
}

// ─── Indexed queryTable: mastra_threads ──────────────────────────────

async function queryThreads(ctx: Ctx, request: StorageRequest): Promise<StorageResponse | null> {
    const limit = request.limit ?? 10000;
    const resourceFilter = findFilter(request.filters, 'resourceId');
    const idFilter = findFilter(request.filters, 'id');

    let docs;
    let usedFields: string[];

    if (resourceFilter) {
        docs = await ctx.db
            .query('mastra_threads')
            .withIndex('by_resource', (q) => q.eq('resourceId', resourceFilter.value as string))
            .take(limit);
        usedFields = ['resourceId'];
    } else if (idFilter) {
        const doc = await ctx.db
            .query('mastra_threads')
            .withIndex('by_record_id', (q) => q.eq('id', idFilter.value as string))
            .unique();
        docs = doc ? [doc] : [];
        usedFields = ['id'];
    } else {
        return null;
    }

    const remaining = excludeFilters(request.filters, ...usedFields);
    docs = applyJsFilters(docs as Record<string, unknown>[], remaining);
    docs = applyLimit(docs, request.limit);

    return { ok: true, result: docs };
}

// ─── Indexed load (without keys.id) ──────────────────────────────────

async function optimizedLoad(ctx: Ctx, request: StorageRequest): Promise<StorageResponse | null> {
    const keys = request.keys;
    if (!keys || keys.id) return null; // keys.id → upstream handles efficiently via by_record_id

    // mastra_workflow_snapshot: use by_workflow_run when workflow_name + run_id present
    if (request.tableName === 'mastra_workflow_snapshot' && keys.workflow_name && keys.run_id) {
        const docs = await ctx.db
            .query('mastra_workflow_snapshots')
            .withIndex('by_workflow_run', (q) =>
                q.eq('workflow_name', keys.workflow_name as string).eq('run_id', keys.run_id as string),
            )
            .take(100);

        const match = docs.find((doc) =>
            Object.entries(keys).every(([k, v]) => (doc as Record<string, unknown>)[k] === v),
        );
        return { ok: true, result: match || null };
    }

    // mastra_threads: use by_resource when resourceId present
    if (request.tableName === 'mastra_threads' && keys.resourceId) {
        const docs = await ctx.db
            .query('mastra_threads')
            .withIndex('by_resource', (q) => q.eq('resourceId', keys.resourceId as string))
            .take(100);

        const match = docs.find((doc) =>
            Object.entries(keys).every(([k, v]) => (doc as Record<string, unknown>)[k] === v),
        );
        return { ok: true, result: match || null };
    }

    return null;
}

// ─── Exports ─────────────────────────────────────────────────────────

/** Re-export the original handler so we can delegate to it via ctx.runMutation */
export const _upstream = mastraStorage;

/** Patched handler — intercepts queryTable & load, delegates everything else */
export const handle = mutationGeneric(async (ctx: Ctx, request: StorageRequest): Promise<StorageResponse> => {
    // Intercept queryTable to use indexed queries instead of full table scans
    if (request.op === 'queryTable') {
        let result: StorageResponse | null = null;

        if (request.tableName === 'mastra_messages') {
            result = await queryMessages(ctx, request);
        } else if (request.tableName === 'mastra_threads') {
            result = await queryThreads(ctx, request);
        }

        if (result) return result;
    }

    // Intercept load without keys.id to avoid full table scans
    if (request.op === 'load') {
        const result = await optimizedLoad(ctx, request);
        if (result) return result;
    }

    // All other operations: delegate to the upstream handler
    return delegateToUpstream(ctx, request);
});
