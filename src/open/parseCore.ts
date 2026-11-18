import { BlueprintData, fromStr } from '@/blueprint/parser';

/** Worker 与主线程之间的消息；不依赖 Worker 全局，便于单测 */
export interface SerializedError {
    /** 还原时用于保持 mapParseError 依赖的类型判断（RangeError / TypeError / 字符串） */
    type: 'range' | 'type' | 'string' | 'error';
    name: string;
    message: string;
}

export type WorkerOut =
    | { type: 'progress'; done: number; total: number }
    | { type: 'done'; data: BlueprintData }
    | { type: 'error'; error: SerializedError };

export function serializeError(e: unknown): SerializedError {
    if (typeof e === 'string')
        return { type: 'string', name: 'string', message: e };
    const err = e as Error;
    const type = e instanceof RangeError ? 'range' : e instanceof TypeError ? 'type' : 'error';
    return { type, name: err?.name ?? 'Error', message: err?.message ?? String(e) };
}

export function deserializeError(s: SerializedError): unknown {
    switch (s.type) {
        case 'string': return s.message;
        case 'range': return new RangeError(s.message);
        case 'type': return new TypeError(s.message);
        default: {
            const e = new Error(s.message);
            e.name = s.name;
            return e;
        }
    }
}

/** Worker 里执行的解析：进度与结果/错误都通过 post 发出 */
export function runParse(code: string, post: (m: WorkerOut) => void): void {
    try {
        const data = fromStr(code, { onProgress: (done, total) => post({ type: 'progress', done, total }) });
        post({ type: 'done', data });
    } catch (e) {
        post({ type: 'error', error: serializeError(e) });
    }
}
