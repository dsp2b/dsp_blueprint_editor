import type { BlueprintData, FromStrOptions } from '@/blueprint/parser';
import { deserializeError, WorkerOut } from './parseCore';

export interface WorkerLike {
    onmessage: ((e: MessageEvent<WorkerOut>) => void) | null;
    onerror: ((e: ErrorEvent) => void) | null;
    postMessage(code: string): void;
    terminate(): void;
}

export interface WorkerParserDeps {
    /** 创建 Worker；不可用时返回 null（或抛出） */
    create: () => WorkerLike | null;
    /** Worker 不可用或加载失败时在主线程解析 */
    fallback: (code: string, options: FromStrOptions) => BlueprintData | Promise<BlueprintData>;
}

/** 返回与 SessionDeps.parse 同签名的函数：每次解析用一个新 Worker，结束即终止 */
export function createWorkerParser(deps: WorkerParserDeps) {
    return (code: string, options: FromStrOptions): Promise<BlueprintData> => {
        let worker: WorkerLike | null = null;
        try {
            worker = deps.create();
        } catch (e) {
            console.warn('parse worker unavailable', e);
        }
        const w = worker;
        if (!w)
            return Promise.resolve(deps.fallback(code, options));

        return new Promise<BlueprintData>((resolve, reject) => {
            w.onmessage = ({ data }) => {
                if (data.type === 'progress') {
                    options.onProgress?.(data.done, data.total);
                    return;
                }
                w.terminate();
                if (data.type === 'done')
                    resolve(data.data);
                else
                    reject(deserializeError(data.error));
            };
            w.onerror = () => {
                w.terminate();
                console.warn('parse worker failed to run, parsing on the main thread');
                Promise.resolve(deps.fallback(code, options)).then(resolve, reject);
            };
            w.postMessage(code);
        });
    };
}
