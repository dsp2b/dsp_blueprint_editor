import type { BlueprintData } from '@/blueprint/parser';
import { deserializeError, WorkerOut } from './parseCore';
import type { ParseOptions } from './session';

export interface WorkerLike {
    onmessage: ((e: MessageEvent<WorkerOut>) => void) | null;
    onerror: ((e: ErrorEvent) => void) | null;
    onmessageerror: ((e: MessageEvent) => void) | null;
    postMessage(code: string): void;
    terminate(): void;
}

export interface WorkerParserDeps {
    /** 创建 Worker；不可用时返回 null（或抛出） */
    create: () => WorkerLike | null;
    /** Worker 不可用或加载失败时在主线程解析 */
    fallback: (code: string, options: ParseOptions) => BlueprintData | Promise<BlueprintData>;
}

const abortError = () => new DOMException('Blueprint parse aborted', 'AbortError');

/** 返回与 SessionDeps.parse 同签名的函数：每次解析用一个新 Worker，结束或被中止即终止 */
export function createWorkerParser(deps: WorkerParserDeps) {
    return (code: string, options: ParseOptions): Promise<BlueprintData> => {
        const signal = options.signal;
        if (signal?.aborted)
            return Promise.reject(abortError());
        let worker: WorkerLike | null = null;
        try {
            worker = deps.create();
        } catch (e) {
            console.warn('parse worker unavailable', e);
        }
        const w = worker;
        if (!w)
            return new Promise<BlueprintData>(resolve => resolve(deps.fallback(code, options)));

        return new Promise<BlueprintData>((resolve, reject) => {
            const finish = () => {
                w.terminate();
                signal?.removeEventListener('abort', onAbort);
            };
            const onAbort = () => {
                finish();
                reject(abortError());
            };
            signal?.addEventListener('abort', onAbort);
            const fallBack = (why: string) => {
                finish();
                console.warn(`parse worker ${why}, parsing on the main thread`);
                new Promise<BlueprintData>(r => r(deps.fallback(code, options))).then(resolve, reject);
            };
            w.onmessage = ({ data }) => {
                if (data.type === 'progress') {
                    options.onProgress?.(data.done, data.total);
                    return;
                }
                finish();
                if (data.type === 'done')
                    resolve(data.data);
                else
                    reject(deserializeError(data.error));
            };
            w.onerror = () => fallBack('failed to run');
            // 结果无法反序列化时不会再有 onmessage，不处理会一直挂在“解析中”
            w.onmessageerror = () => fallBack('sent an unreadable result');
            w.postMessage(code);
        });
    };
}
